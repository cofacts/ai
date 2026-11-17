"""Verifier recovery uses fake SDK failures; no model or web requests are sent."""

import asyncio
import json
from collections.abc import AsyncGenerator
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import httpx
import pytest
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.invocation_context import InvocationContext
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.sessions import InMemorySessionService
from google.adk.sessions.state import State
from google.adk.tools.agent_tool import AgentTool
from google.adk.tools.tool_context import ToolContext
from google.genai.errors import APIError
from google.genai import types
from pydantic import Field

from cofacts_ai import verifier_recovery as recovery
from cofacts_ai.writer_citations import attach_citation


def api_error(code: int, message: str = "Request failed") -> APIError:
    return APIError(code, {"error": {"code": code, "message": message}})


def context(invocation_id: str = "turn-1", state: dict | None = None) -> ToolContext:
    return cast(
        ToolContext,
        SimpleNamespace(
            state=State(state if state is not None else {}, {}),
            invocation_id=invocation_id,
            function_call_id="verifier-call-1",
            _invocation_context=SimpleNamespace(invocation_id=invocation_id),
        ),
    )


def payload(response) -> dict:
    return json.loads(response) if isinstance(response, str) else response


def report(urls: list[str], claim: str = "Exact claim.") -> dict:
    return {
        "content": "Read sources: " + ", ".join(urls),
        "sources": [{"title": "Source", "url": url} for url in urls],
        "findings": [
            {
                "claim": claim,
                "source_url": url,
                "status": "supported",
                "quote": "Observed passage",
            }
            for url in urls
        ],
    }


@pytest.fixture
def verifier():
    return recovery.VerifierTool(agent=LlmAgent(name="verifier", model="unused"))


@pytest.mark.parametrize(
    ("error", "category"),
    [
        (
            api_error(
                400,
                "The input token count (1049000) exceeds the maximum number of "
                "tokens allowed (1048576).",
            ),
            "token_limit",
        ),
        (api_error(400, "Request contains an invalid argument."), "invalid_argument"),
        (api_error(400, "Invalid token in request field"), "invalid_argument"),
        (
            api_error(400, "Authentication token exceeds maximum length"),
            "invalid_argument",
        ),
        (
            api_error(400, "The maxOutputTokens value must be smaller than 65536"),
            "invalid_argument",
        ),
        (
            APIError(
                400,
                {
                    "error": {
                        "message": "Request contains an invalid argument.",
                        "details": "Source text: input token count exceeds maximum allowed",
                    }
                },
            ),
            "invalid_argument",
        ),
        (api_error(400, "No such object: example/image/original"), "missing_source"),
        (api_error(404, "Object not found"), "missing_source"),
        (
            api_error(
                404,
                "Publisher Model projects/example/locations/global/publishers/google/"
                "models/gemini-preview was not found",
            ),
            "permanent",
        ),
        (api_error(429), "transient"),
        (api_error(500), "transient"),
        (api_error(502), "transient"),
        (api_error(503), "transient"),
        (api_error(504), "transient"),
        (httpx.ReadTimeout("Read timed out"), "transient"),
        (TimeoutError(), "transient"),
        (api_error(401), "permanent"),
        (api_error(403), "permanent"),
        (api_error(501), "permanent"),
        (ValueError("400 INVALID_ARGUMENT"), "permanent"),
    ],
)
def test_classifies_sdk_failures_without_guessing_token_limits(error, category):
    assert recovery.classify_error(error) == category


async def test_token_limit_splits_eight_sources_and_keeps_every_success(
    monkeypatch, verifier
):
    urls = [f"https://example.test/source-{i}" for i in range(8)]
    claim = "主張：這個數字是 123，而不是 456。"
    calls = []

    async def run(*, args, tool_context):
        request = args["request"]
        included = [url for url in urls if url in request]
        calls.append(included)
        assert claim in request
        if len(included) > 3:
            raise api_error(400, "Input token count exceeds the maximum tokens allowed")
        return json.dumps(report(included, claim))

    monkeypatch.setattr(AgentTool, "run_async", AsyncMock(side_effect=run))
    result = payload(
        await verifier.run_async(
            args={"request": claim + "\n" + "\n".join(urls)}, tool_context=context()
        )
    )
    assert [len(batch) for batch in calls] == [8, 3, 3, 2]
    assert [source["url"] for source in result["sources"]] == urls
    assert [finding["source_url"] for finding in result["findings"]] == urls
    assert all(url in result["content"] for url in urls)


async def test_general_400_isolates_sources_and_stops_at_singletons(
    monkeypatch, verifier
):
    urls = [f"https://example.test/source-{i}" for i in range(4)]
    calls = []

    async def run(*, args, tool_context):
        calls.append(tuple(url for url in urls if url in args["request"]))
        raise api_error(400, "Request contains an invalid argument.")

    monkeypatch.setattr(AgentTool, "run_async", AsyncMock(side_effect=run))
    ctx = context()
    args = {"request": "Verify the claim against:\n" + "\n".join(urls)}
    result = payload(await verifier.run_async(args=args, tool_context=ctx))
    assert len(calls) == 7
    assert sorted(map(len, calls)) == [1, 1, 1, 1, 2, 2, 4]
    assert len(set(calls)) == len(calls)
    assert "error" in result
    assert result["error"] == "invalid_argument"
    assert "cite_as" not in attach_citation(verifier, result, ctx)
    assert payload(await verifier.run_async(args=args, tool_context=ctx)) == result
    assert len(calls) == 7


async def test_partial_failure_never_becomes_a_source_or_supported_finding(
    monkeypatch, verifier
):
    good = "https://example.test/good"
    bad = "https://example.test/bad"
    calls = []

    async def run(*, args, tool_context):
        request = args["request"]
        calls.append(request)
        if bad in request:
            raise api_error(400, "Request contains an invalid argument.")
        return report([good])

    monkeypatch.setattr(AgentTool, "run_async", AsyncMock(side_effect=run))
    result = payload(
        await verifier.run_async(
            args={"request": f"Exact claim.\n{bad}\n{good}"}, tool_context=context()
        )
    )
    assert len(calls) == 3
    assert result["sources"] == report([good])["sources"]
    assert result["findings"] == report([good])["findings"]
    assert "UNVERIFIED" in result["content"]
    assert "error" not in result
    assert bad in result["content"]


@pytest.mark.parametrize(
    "message",
    [
        "Request contains an invalid argument.",
        "Input token count exceeds the maximum tokens allowed",
    ],
)
async def test_single_source_failure_is_not_retried(monkeypatch, verifier, message):
    run = AsyncMock(side_effect=api_error(400, message))
    monkeypatch.setattr(AgentTool, "run_async", run)
    result = payload(
        await verifier.run_async(
            args={"request": "Check https://example.test/large-page"},
            tool_context=context(),
        )
    )
    assert run.await_count == 1
    assert "error" in result


async def test_unidentifiable_input_is_not_sliced_or_retried(monkeypatch, verifier):
    run = AsyncMock(side_effect=api_error(400, "Request contains an invalid argument."))
    monkeypatch.setattr(AgentTool, "run_async", run)
    result = payload(
        await verifier.run_async(
            args={"request": "Verify the cited sources and claims above."},
            tool_context=context(),
        )
    )
    assert run.await_count == 1
    assert "error" in result


async def test_missing_image_is_not_retried_as_https(monkeypatch, verifier):
    gs = "gs://cofacts-media-collection/production/image/example/original"
    https = (
        "https://storage.googleapis.com/cofacts-media-collection/"
        "production/image/example/original?X-Goog-Signature=dummy"
    )
    run = AsyncMock(side_effect=api_error(404, "No such object"))
    monkeypatch.setattr(AgentTool, "run_async", run)
    ctx = context()
    first = payload(
        await verifier.run_async(args={"request": f"Read {gs}"}, tool_context=ctx)
    )
    second = payload(
        await verifier.run_async(args={"request": f"Read {https}"}, tool_context=ctx)
    )
    assert "error" in first and "error" in second
    assert run.await_count == 1


async def test_alternative_page_does_not_claim_missing_image_was_read(
    monkeypatch, verifier
):
    image = "gs://cofacts-media-collection/production/image/example/original"
    page = "https://example.test/alternative"
    calls = []

    async def run(*, args, tool_context):
        request = args["request"]
        calls.append(request)
        if image in request:
            raise api_error(400, "No such object: " + image)
        return report([page])

    monkeypatch.setattr(AgentTool, "run_async", AsyncMock(side_effect=run))
    result = payload(
        await verifier.run_async(
            args={"request": f"Exact claim.\n{image}\n{page}"}, tool_context=context()
        )
    )
    assert len(calls) <= 3
    assert result["sources"] == report([page])["sources"]
    assert result["findings"] == report([page])["findings"]
    assert image in result["content"]
    assert "UNVERIFIED" in result["content"]


async def test_later_web_only_call_keeps_original_missing_image_unverified(
    monkeypatch, verifier
):
    image = "gs://cofacts-media-collection/production/image/example/original"
    page = "https://example.test/alternative"
    run = AsyncMock(side_effect=[api_error(404, "No such object"), report([page])])
    monkeypatch.setattr(AgentTool, "run_async", run)
    ctx = context()
    missing = payload(
        await verifier.run_async(
            args={"request": f"Read the image {image}"}, tool_context=ctx
        )
    )
    assert missing["error"] == "missing_source"
    result = payload(
        await verifier.run_async(
            args={"request": f"Exact claim.\n{page}"}, tool_context=ctx
        )
    )
    assert run.await_count == 2
    assert image not in run.await_args_list[1].kwargs["args"]["request"]
    assert image in result["content"]
    assert "UNVERIFIED" in result["content"]
    assert result["sources"] == report([page])["sources"]
    assert result["findings"] == report([page])["findings"]


async def test_cached_page_keeps_image_failure_discovered_after_its_first_call(
    monkeypatch, verifier
):
    image = "gs://cofacts-media-collection/production/image/example/original"
    page = "https://example.test/alternative"
    run = AsyncMock(side_effect=[report([page]), api_error(404, "No such object")])
    monkeypatch.setattr(AgentTool, "run_async", run)
    ctx = context()
    page_args = {"request": f"Exact claim.\n{page}"}
    await verifier.run_async(args=page_args, tool_context=ctx)
    await verifier.run_async(args={"request": f"Read {image}"}, tool_context=ctx)
    result = payload(await verifier.run_async(args=page_args, tool_context=ctx))
    assert run.await_count == 2
    assert image in result["content"]
    assert "UNVERIFIED" in result["content"]
    assert result["sources"] == report([page])["sources"]
    assert result["findings"] == report([page])["findings"]


@pytest.mark.parametrize("code", [429, 500, 502, 503, 504])
async def test_transient_failure_has_two_backoffs_then_stops(
    monkeypatch, verifier, code
):
    run = AsyncMock(side_effect=api_error(code))
    sleep = AsyncMock()
    monkeypatch.setattr(AgentTool, "run_async", run)
    monkeypatch.setattr(recovery.asyncio, "sleep", sleep)
    result = payload(
        await verifier.run_async(
            args={"request": "Check https://example.test/page"}, tool_context=context()
        )
    )
    assert run.await_count == 3
    assert [call.args[0] for call in sleep.await_args_list] == [1, 2]
    assert "error" in result


async def test_transient_success_does_not_repeat_successful_call(monkeypatch, verifier):
    expected = report(["https://example.test/page"])
    run = AsyncMock(side_effect=[api_error(503), expected])
    sleep = AsyncMock()
    monkeypatch.setattr(AgentTool, "run_async", run)
    monkeypatch.setattr(recovery.asyncio, "sleep", sleep)
    result = payload(
        await verifier.run_async(
            args={"request": "Check https://example.test/page"}, tool_context=context()
        )
    )
    assert result == expected
    assert run.await_count == 2
    sleep.assert_awaited_once_with(1)


async def test_permanent_errors_and_cancellation_are_not_retried(monkeypatch, verifier):
    run = AsyncMock(side_effect=api_error(403))
    monkeypatch.setattr(AgentTool, "run_async", run)
    result = payload(
        await verifier.run_async(
            args={"request": "Check source"}, tool_context=context()
        )
    )
    assert "error" in result
    assert run.await_count == 1
    run.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await verifier.run_async(
            args={"request": "Other source"}, tool_context=context()
        )
    assert run.await_count == 2


async def test_attempt_budget_is_shared_across_calls_and_resets_next_turn(
    monkeypatch, verifier
):
    monkeypatch.setattr(recovery, "MAX_ATTEMPTS", 2)
    run = AsyncMock(side_effect=api_error(400, "Request contains an invalid argument."))
    monkeypatch.setattr(AgentTool, "run_async", run)
    shared = {}
    for i in range(3):
        await verifier.run_async(
            args={"request": f"Check https://example.test/source-{i}"},
            tool_context=context(state=shared),
        )
    assert run.await_count == 2
    await verifier.run_async(
        args={"request": "Check https://example.test/source-new"},
        tool_context=context(invocation_id="turn-2", state=shared),
    )
    assert run.await_count == 3


async def test_parallel_calls_share_the_attempt_budget(monkeypatch, verifier):
    monkeypatch.setattr(recovery, "MAX_ATTEMPTS", 1)
    entered = asyncio.Event()
    finish = asyncio.Event()

    async def run(*, args, tool_context):
        entered.set()
        await finish.wait()
        return report(["https://example.test/first"])

    mock = AsyncMock(side_effect=run)
    monkeypatch.setattr(AgentTool, "run_async", mock)
    shared = {}
    first = asyncio.create_task(
        verifier.run_async(
            args={"request": "Check https://example.test/first"},
            tool_context=context(state=shared),
        )
    )
    try:
        await asyncio.wait_for(entered.wait(), timeout=1)
        second = payload(
            await verifier.run_async(
                args={"request": "Check https://example.test/second"},
                tool_context=context(state=shared),
            )
        )
        assert "error" in second
        assert mock.await_count == 1
    finally:
        finish.set()
        await first


async def test_overall_deadline_cancels_hanging_call_without_retry(
    monkeypatch, verifier
):
    monkeypatch.setattr(recovery, "MAX_SECONDS", 0.01)
    cancelled = asyncio.Event()

    async def run(*, args, tool_context):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    mock = AsyncMock(side_effect=run)
    monkeypatch.setattr(AgentTool, "run_async", mock)
    result = payload(
        await asyncio.wait_for(
            verifier.run_async(
                args={"request": "Check https://example.test/slow"},
                tool_context=context(),
            ),
            timeout=1,
        )
    )
    assert "error" in result
    assert cancelled.is_set()
    assert mock.await_count == 1


def test_verifier_disables_sdk_http_retries_only_for_its_own_model():
    from cofacts_ai.agent import ai_verifier, ai_writer

    config = ai_verifier.generate_content_config
    assert config is not None
    assert config.http_options is not None
    assert config.http_options.retry_options is not None
    assert config.http_options.retry_options.attempts == 1
    assert ai_writer.generate_content_config is not None
    assert ai_writer.generate_content_config.http_options is None


def test_child_session_can_make_only_one_model_request():
    callback = cast(CallbackContext, SimpleNamespace(state=State({}, {})))
    request = LlmRequest()
    recovery.limit_verifier_model_calls(callback, request)
    with pytest.raises(RuntimeError, match="model-call limit"):
        recovery.limit_verifier_model_calls(callback, request)
    fresh_child = cast(CallbackContext, SimpleNamespace(state=State({}, {})))
    recovery.limit_verifier_model_calls(fresh_child, request)


@pytest.mark.parametrize(
    "response",
    [
        None,
        "",
        "   ",
        {
            "error": "failed",
            "sources": report(["https://example.test/page"])["sources"],
        },
        {"success": False, **report(["https://example.test/page"])},
    ],
)
async def test_empty_or_failed_tool_payload_never_becomes_evidence(
    monkeypatch, verifier, response
):
    run = AsyncMock(return_value=response)
    monkeypatch.setattr(AgentTool, "run_async", run)
    result = payload(
        await verifier.run_async(
            args={"request": "Check https://example.test/page"}, tool_context=context()
        )
    )
    assert run.await_count == 1
    assert "error" in result
    assert "sources" not in result and "findings" not in result


@pytest.mark.parametrize(
    ("field", "value"),
    [("sources", None), ("sources", "invalid"), ("findings", None), ("findings", {})],
)
async def test_malformed_batch_payload_preserves_other_successes(
    monkeypatch, verifier, field, value
):
    good = "https://example.test/good"
    bad = "https://example.test/malformed"
    malformed = {**report([bad]), field: value}
    run = AsyncMock(
        side_effect=[api_error(400, "Invalid argument"), report([good]), malformed]
    )
    monkeypatch.setattr(AgentTool, "run_async", run)
    result = payload(
        await verifier.run_async(
            args={"request": f"Exact claim.\n{good}\n{bad}"}, tool_context=context()
        )
    )
    assert run.await_count == 3
    assert result["sources"] == report([good])["sources"]
    assert result["findings"] == report([good])["findings"]
    assert bad in result["content"]
    assert "UNVERIFIED" in result["content"]


async def test_successful_subset_cannot_smuggle_failed_source_evidence(
    monkeypatch, verifier
):
    good = "https://example.test/good"
    bad = "https://example.test/bad"

    async def run(*, args, tool_context):
        if bad in args["request"]:
            raise api_error(400, "Request contains an invalid argument.")
        return report([good, bad])

    mock = AsyncMock(side_effect=run)
    monkeypatch.setattr(AgentTool, "run_async", mock)
    result = payload(
        await verifier.run_async(
            args={"request": f"Exact claim.\n{bad}\n{good}"}, tool_context=context()
        )
    )
    assert mock.await_count == 3
    assert result["sources"] == report([good])["sources"]
    assert result["findings"] == report([good])["findings"]


async def test_batching_preserves_chinese_claims_adjacent_to_urls(
    monkeypatch, verifier
):
    first = "https://a.test/x"
    second = "https://b.test/y"
    calls = []

    async def run(*, args, tool_context):
        request = args["request"]
        calls.append(request)
        urls = [url for url in (first, second) if url in request]
        if len(urls) == 2:
            raise api_error(400, "Request contains an invalid argument.")
        return report(urls)

    monkeypatch.setattr(AgentTool, "run_async", AsyncMock(side_effect=run))
    result = payload(
        await verifier.run_async(
            args={"request": f"{first}，主張甲成立。\n{second}；主張乙不成立。"},
            tool_context=context(),
        )
    )
    assert len(calls) == 3
    assert all("，主張甲成立。" in request for request in calls)
    assert all("；主張乙不成立。" in request for request in calls)
    assert [source["url"] for source in result["sources"]] == [first, second]


async def test_batching_keeps_balanced_parentheses_in_source_urls(
    monkeypatch, verifier
):
    urls = ["https://example.test/wiki/Foo_(bar)", "https://example.test/other"]
    calls = []

    async def run(*, args, tool_context):
        included = [url for url in urls if url in args["request"]]
        calls.append(included)
        if len(included) == 2:
            raise api_error(400, "Input token count exceeds the maximum tokens allowed")
        return report(included)

    monkeypatch.setattr(AgentTool, "run_async", AsyncMock(side_effect=run))
    result = payload(
        await verifier.run_async(
            args={"request": "Exact claim.\n" + "\n".join(urls)},
            tool_context=context(),
        )
    )
    assert [len(batch) for batch in calls] == [2, 1, 1]
    assert result["sources"] == report(urls)["sources"]
    assert result["findings"] == report(urls)["findings"]


async def test_missing_model_endpoint_is_not_split_into_source_retries(
    monkeypatch, verifier
):
    run = AsyncMock(
        side_effect=api_error(
            404,
            "Publisher Model projects/example/locations/global/publishers/google/"
            "models/gemini-preview was not found",
        )
    )
    monkeypatch.setattr(AgentTool, "run_async", run)
    result = payload(
        await verifier.run_async(
            args={
                "request": "Check https://example.test/first and https://example.test/second"
            },
            tool_context=context(),
        )
    )
    assert result["error"] == "permanent"
    assert run.await_count == 1


async def test_ambiguous_non_ascii_source_boundaries_are_not_split(
    monkeypatch, verifier
):
    run = AsyncMock(side_effect=api_error(400, "Request contains an invalid argument."))
    monkeypatch.setattr(AgentTool, "run_async", run)
    result = payload(
        await verifier.run_async(
            args={
                "request": "https://example.test/新聞主張甲成立\nhttps://example.test/other"
            },
            tool_context=context(),
        )
    )
    assert result["error"] == "invalid_argument"
    assert run.await_count == 1


class ScriptedVerifierModel(BaseLlm):
    model: str = "gemini-3-flash-preview"
    responses: list[LlmResponse | Exception]
    requests: list[LlmRequest] = Field(default_factory=list)

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request.model_copy(deep=True))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        yield response


async def test_real_agent_tool_and_callbacks_keep_batches_isolated_and_citable():
    from cofacts_ai.agent import after_tool, ai_verifier, ai_writer

    installed_tool = next(
        tool for tool in ai_writer.tools if isinstance(tool, recovery.VerifierTool)
    )
    assert installed_tool.agent is ai_verifier
    good = "https://example.test/good"
    bad = "https://example.test/bad"
    model = ScriptedVerifierModel(
        responses=[
            api_error(400, "Request contains an invalid argument."),
            api_error(400, "Request contains an invalid argument."),
            LlmResponse(
                content=types.Content(
                    role="model",
                    parts=[types.Part(text="The source reports the exact claim.")],
                ),
                grounding_metadata=types.GroundingMetadata(
                    grounding_chunks=[
                        types.GroundingChunk(
                            web=types.GroundingChunkWeb(title="Source", uri=good)
                        )
                    ]
                ),
            ),
            api_error(403),
        ]
    )
    child_sessions = []

    def observe_child(callback_context: CallbackContext, llm_request: LlmRequest):
        child_sessions.append(callback_context.session.id)

    callbacks = ai_verifier.before_model_callback
    assert isinstance(callbacks, list)
    child = ai_verifier.clone(
        update={"model": model, "before_model_callback": [*callbacks, observe_child]}
    )
    tool = recovery.VerifierTool(agent=child)
    sessions = InMemorySessionService()
    session = await sessions.create_session(app_name="test_app", user_id="test_user")
    ctx = ToolContext(
        InvocationContext(
            agent=ai_writer,
            session=session,
            session_service=sessions,
            invocation_id="test-invocation",
        ),
        function_call_id="recovery-success",
    )
    args = {"request": f"Exact claim.\n{bad}\n{good}"}
    result = await tool.run_async(args=args, tool_context=ctx)
    cited = await after_tool(
        tool=tool, args=args, tool_context=ctx, tool_response=result
    )
    assert cited is not None
    assert cited["cite_as"].startswith("[^verifier-")
    assert "The source reports the exact claim." in cited["content"]
    assert not cited.get("findings")
    assert cited["sources"] == report([good])["sources"]
    assert "UNVERIFIED" in cited["content"]

    ctx.function_call_id = "recovery-failure"
    failure_args = {"request": "Check https://example.test/forbidden"}
    failure = await tool.run_async(args=failure_args, tool_context=ctx)
    rejected = await after_tool(
        tool=tool, args=failure_args, tool_context=ctx, tool_response=failure
    )
    assert rejected is not None and "error" in rejected
    assert "cite_as" not in rejected
    assert len(child_sessions) == len(set(child_sessions)) == len(model.requests) == 4
    for request in model.requests:
        assert len(request.contents) == 1
        assert request.contents[0].role == "user"
        assert request.config is not None
        assert request.config.http_options is not None
        assert request.config.http_options.retry_options is not None
        assert request.config.http_options.retry_options.attempts == 1


async def test_recovery_preserves_the_existing_prose_response_shape(
    monkeypatch, verifier
):
    good = "https://example.test/good"
    bad = "https://example.test/bad"
    run = AsyncMock(
        side_effect=[
            api_error(400),
            api_error(400),
            {"content": "Source report", "sources": [{"title": "Good", "url": good}]},
        ]
    )
    monkeypatch.setattr(AgentTool, "run_async", run)
    result = await verifier.run_async(
        args={"request": f"Exact claim.\n{bad}\n{good}"}, tool_context=context()
    )
    assert result["sources"] == [{"title": "Good", "url": good}]
    assert "UNVERIFIED" in result["content"]
    assert set(result) == {"content", "sources"}
