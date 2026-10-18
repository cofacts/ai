"""Run current production prompts in a bounded, frozen-evidence environment.

This evaluates source judgment and drafting, NOT search or end-to-end routing.
Remote search/media tools, title generation and tracing plugins are excluded.
"""

import asyncio
import json
import os
import time
from typing import Any

from .data import Case, case_digest, digest
from .judge import Response


async def generate(case: Case, timeout: int = 180) -> Response:
    from google.adk.artifacts import InMemoryArtifactService
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    from cofacts_ai.agent import ai_verifier, ai_writer
    from cofacts_ai.tools import draft_factcheck_response

    original = ai_verifier if case.target == "verifier" else ai_writer
    base: dict[str, Any] = dict(
        case_id=case.id,
        case_sha256=case_digest(case),
        model=original.model
        if isinstance(original.model, str)
        else original.model.model,
        mode="candidate",
        instruction_sha256=digest(str(original.instruction)),
    )
    if case.target == "verifier" and (
        not case.sources or any(not s.captured for s in case.sources)
    ):
        return Response(**base, output="", error="Missing source snapshots")
    if (
        isinstance(original.model, str)
        and os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() not in ("true", "1")
        and not (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
    ):
        return Response(
            **base,
            output="",
            error="Gemini configuration missing: configure cofacts_ai/.env as described in README.md",
        )

    async def read_captured_source(url: str) -> dict:
        """Read the captured text of an exact source URL; no network requests."""
        for source in case.sources:
            if source.url == url:
                return source.model_dump()
        return {"error": "Source not captured", "url": url}

    agent = original.clone(
        update={
            "tools": [read_captured_source]
            if case.target == "verifier"
            else [draft_factcheck_response],
            "after_agent_callback": None,
            # The current media callbacks could attach files found in recorded
            # conversation text. This harness intentionally accepts text only.
            "before_model_callback": None,
        }
    )
    data = {
        "request": case.request,
        "conversation_prefix": [t.model_dump() for t in case.conversation],
        "captured_tool_results": [e.model_dump() for e in case.evidence],
        "available_source_urls": [s.url for s in case.sources],
    }
    task = (
        "This is a frozen-source judgment task. Use read_captured_source to read the supplied URLs. "
        "Snapshots marked excerpt are incomplete; absence from an excerpt is not contradiction. "
        "No live web or media retrieval is available. Judge the supplied claims against captured evidence.\n"
        if case.target == "verifier"
        else "Continue the drafting stage using the captured conversation and tool reports below. "
        "Research and verification have already been supplied. Preserve the user's effective constraints. "
        "Only draft_factcheck_response is available in this isolated drafting evaluation. "
        "Produce your draft using that tool; do not invent missing research.\n"
    )
    sessions = InMemorySessionService()
    session = await sessions.create_session(app_name="cofacts_eval", user_id="eval")
    runner = Runner(
        agent=agent,
        app_name="cofacts_eval",
        session_service=sessions,
        artifact_service=InMemoryArtifactService(),
    )
    outputs = []
    calls = {}
    draft = None

    async def consume():
        nonlocal draft
        from google.adk.agents.run_config import RunConfig

        async for event in runner.run_async(
            user_id="eval",
            session_id=session.id,
            new_message=types.Content(
                role="user",
                parts=[types.Part(text=task + json.dumps(data, ensure_ascii=False))],
            ),
            run_config=RunConfig(max_llm_calls=6),
        ):
            if event.error_code:
                raise RuntimeError(f"model error: {event.error_code}")
            for part in (event.content.parts or []) if event.content else []:
                if part.text and not part.thought:
                    outputs.append(part.text)
                if (
                    part.function_call
                    and part.function_call.name == "draft_factcheck_response"
                ):
                    calls[part.function_call.id] = dict(part.function_call.args or {})
                if (
                    part.function_response
                    and part.function_response.name == "draft_factcheck_response"
                ):
                    if (part.function_response.response or {}).get("success") is True:
                        draft = calls.get(part.function_response.id)

    started = time.monotonic()
    try:
        await asyncio.wait_for(consume(), timeout=timeout)
        return Response(**base, output="\n".join(outputs), draft=draft)
    except Exception as error:
        return Response(
            **base,
            output="\n".join(outputs),
            draft=draft,
            error=f"{type(error).__name__} after {time.monotonic() - started:.1f}s",
        )
    finally:
        await runner.close()
