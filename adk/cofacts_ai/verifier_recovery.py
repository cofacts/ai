"""Bounded recovery for the verifier's stateless AgentTool calls only."""

import asyncio
import hashlib
import json
import re
import time
from collections import deque
from typing import Any

import httpx
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.tools.agent_tool import AgentTool
from google.adk.tools.tool_context import ToolContext
from google.genai.errors import APIError

from .media_filedata import signed_url_to_gs

MAX_ATTEMPTS = 12
MAX_SECONDS = 240
MAX_BATCH_ATTEMPTS = 3
_BUDGET_KEY = "temp:verifier_recovery"
_URL_RE = re.compile(r"(?:https?://|gs://)[^\s<>\"'`\\，。；：！？、「」『』【】（）]+")
_TRAILING = ".,;:!?，。；：！？、」』】）"
_BRACKETS = (("(", ")"), ("[", "]"), ("{", "}"))
_TOKEN_LIMIT_RE = re.compile(
    r"(?:(?:input|context|prompt)\s+(?:token\s+count|tokens?|length).{0,100}"
    r"(?:exceed|too (?:large|long)|maximum|limit)|"
    r"(?:exceed|too many).{0,80}\btokens?\b|"
    r"(?:token limit|context window).{0,60}exceed|"
    r"number of tokens.{0,60}larger than.{0,20}max)",
    re.I,
)


def classify_error(error: Exception) -> str:
    """Classify SDK status, using message text only for explicit 400 subtypes."""
    code = error.code if isinstance(error, APIError) else None
    if isinstance(error, httpx.HTTPStatusError):
        code = error.response.status_code
    message = (
        (error.message or "").lower()
        if isinstance(error, APIError)
        else str(error).lower()
    )
    if code in (400, 404) and "no such object" in message:
        return "missing_source"
    if code == 404:
        if re.search(r"\bmodel\b|/models/|\bendpoint\b", message):
            return "permanent"
        return (
            "missing_source"
            if re.search(r"\b(object|file|image|media|url|uri)\b|gs://", message)
            else "permanent"
        )
    if code == 400:
        return "token_limit" if _TOKEN_LIMIT_RE.search(message) else "invalid_argument"
    if code in (408, 429, 500, 502, 503, 504) or isinstance(
        error, (TimeoutError, httpx.TimeoutException, httpx.ConnectError)
    ):
        return "transient"
    return "permanent"


def verifier_failure(kind: str) -> dict:
    # Never echo SDK messages: they can include signed URLs or private content.
    reasons = {
        "token_limit": "The server explicitly reported a token limit, including fetched page/media content.",
        "invalid_argument": "The server rejected the input (400); the cause is not established as a token limit.",
        "missing_source": "A source could not be retrieved (404 / No such object). Changing gs:// to HTTPS for the same object does not recover it. Other sources do not establish that the original image/media was retrieved.",
        "transient": "Temporary service failure; bounded retries are exhausted.",
        "budget_exhausted": "The shared verifier attempt/time budget is exhausted.",
        "empty_response": "The verifier returned no readable result.",
        "permanent": "The verifier failed with a non-retryable error.",
    }
    return {
        "error": kind,
        "message": (
            f"[SYSTEM] UNVERIFIED: {reasons[kind]} "
            "Recovery is complete; do not resend this request or repeat failed sources. "
            "Report affected claims as 尚未查核, not as confirmed or refuted."
        ),
    }


def _failure_block(sources: list[str], kind: str) -> str:
    return f"[Unverified batch: {', '.join(sources) or 'request'}]\n{verifier_failure(kind)['message']}"


def limit_verifier_model_calls(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    """One model request per fresh child session, so the tool budget is real."""
    key = "temp:verifier_model_called"
    if callback_context.state.get(key):
        raise RuntimeError("Verifier model-call limit reached")
    callback_context.state[key] = True


def _url(match: re.Match) -> str:
    url = match.group().rstrip(_TRAILING)
    for opening, closing in _BRACKETS:
        while url.endswith(closing) and url.count(closing) > url.count(opening):
            url = url[:-1]
    return url


def _identity(url: str) -> str:
    return signed_url_to_gs(url) or url


def _sources(request: str) -> list[str]:
    return list(dict.fromkeys(_identity(_url(m)) for m in _URL_RE.finditer(request)))


def _batch_request(request: str, sources: list[str]) -> str:
    """Remove only literal URLs; never guess claim boundaries or rewrite claims."""

    def replace(match: re.Match) -> str:
        url = _url(match)
        if _identity(url) in sources:
            return match.group()
        return "[source excluded from this batch]" + match.group()[len(url) :]

    return (
        _URL_RE.sub(replace, request)
        + "\n[SYSTEM] This is a source subset. Check the requested claims only against "
        "the remaining URLs. Excluded sources have NOT been checked."
    )


def _payload(result: Any) -> dict | None:
    if isinstance(result, str):
        if not result.strip():
            return None
        try:
            result = json.loads(result)
        except ValueError:
            return {"content": result, "sources": []}
    if (
        not isinstance(result, dict)
        or "error" in result
        or result.get("success") is False
    ):
        return None
    if any(
        key in result and not isinstance(result[key], list)
        for key in ("sources", "findings")
    ):
        return None
    content = result.get("content", result.get("result"))
    if not isinstance(content, str) or not content.strip():
        return None
    return {**result, "content": content}


class VerifierTool(AgentTool):
    """Same request/citation contract, with recovery contained inside one tool call."""

    async def run_async(
        self, *, args: dict[str, Any], tool_context: ToolContext
    ) -> Any:
        request = args.get("request")
        if not isinstance(request, str) or not request.strip():
            return verifier_failure("invalid_argument")

        invocation_id = tool_context.invocation_id
        budget: dict[str, Any] | None = tool_context.state.get(_BUDGET_KEY)
        if budget is None or budget["invocation_id"] != invocation_id:
            budget = {
                "invocation_id": invocation_id,
                "attempts": 0,
                "deadline": time.monotonic() + MAX_SECONDS,
                "missing": [],
                "completed": {},
            }
            tool_context.state[_BUDGET_KEY] = budget
        # State's shared mutable value keeps parallel writer calls on one budget.
        cache_key = hashlib.sha256(request.encode()).hexdigest()
        if cache_key in budget["completed"]:
            cached = budget["completed"][cache_key]
            missing = [url for url in budget["missing"] if url not in cached["missing"]]
            if missing:
                response = cached["response"]
                field = "message" if "error" in response else "content"
                cached["response"] = {
                    **response,
                    field: response[field]
                    + "\n\n"
                    + _failure_block(missing, "missing_source"),
                }
                cached["missing"] = list(budget["missing"])
            return cached["response"]

        sources = _sources(request)
        pending = deque([sources])
        successes: list[tuple[list[str], dict]] = []
        failures: list[tuple[list[str], str]] = []
        previous_missing = [url for url in budget["missing"] if url not in sources]
        if previous_missing:
            # Alternative pages cannot retroactively establish that an image was loaded.
            failures.append((previous_missing, "missing_source"))
        while pending:
            batch = pending.popleft()
            missing = [url for url in batch if url in budget["missing"]]
            if missing:
                failures.append((missing, "missing_source"))
                batch = [url for url in batch if url not in missing]
                if not batch:
                    continue
            batch_request = (
                request if batch == sources else _batch_request(request, batch)
            )
            kind = "budget_exhausted"
            succeeded = False
            for attempt in range(MAX_BATCH_ATTEMPTS):
                remaining = budget["deadline"] - time.monotonic()
                if budget["attempts"] >= MAX_ATTEMPTS or remaining <= 0:
                    kind = "budget_exhausted"
                    break
                budget["attempts"] += 1
                deadline = asyncio.timeout(remaining)
                try:
                    async with deadline:
                        result = await super().run_async(
                            args={"request": batch_request}, tool_context=tool_context
                        )
                    payload = _payload(result)
                    if payload is not None:
                        successes.append((batch, payload))
                        succeeded = True
                        break
                    kind = "empty_response"
                except Exception as error:
                    # CancelledError is a BaseException and must propagate.
                    kind = (
                        "budget_exhausted"
                        if deadline.expired()
                        else classify_error(error)
                    )
                if kind != "transient" or attempt == MAX_BATCH_ATTEMPTS - 1:
                    break
                delay = 2**attempt
                if (
                    budget["attempts"] >= MAX_ATTEMPTS
                    or time.monotonic() + delay >= budget["deadline"]
                ):
                    kind = "budget_exhausted"
                    break
                await asyncio.sleep(delay)
            if succeeded:
                continue
            if (
                kind in ("token_limit", "invalid_argument", "missing_source")
                and len(batch) > 1
                # Glued prose or unbalanced brackets have no safe URL/claim boundary.
                and all(
                    url.isascii()
                    and all(url.count(a) == url.count(b) for a, b in _BRACKETS)
                    for url in batch
                )
            ):
                # Fetched pages count as tokens; prompt character counts cannot predict this.
                size = (
                    min(3, (len(batch) + 1) // 2)
                    if kind == "token_limit"
                    else (len(batch) + 1) // 2
                )
                pending.extendleft(
                    reversed([batch[i : i + size] for i in range(0, len(batch), size)])
                )
            else:
                failures.append((batch, kind))
                if kind == "missing_source":
                    budget["missing"].extend(batch)

        response: dict[str, Any]
        if not successes:
            kinds = list(dict.fromkeys(kind for _, kind in failures))
            response = verifier_failure(kinds[-1])
            response["message"] = "\n".join(
                _failure_block(batch, kind) for batch, kind in failures
            )
        elif len(successes) == 1 and not failures and successes[0][0] == sources:
            response = successes[0][1]
        else:
            content = []
            response = {"content": "", "sources": []}
            if any("findings" in payload for _, payload in successes):
                response["findings"] = []
            for batch, payload in successes:
                content.append(
                    f"[Completed batch: {', '.join(batch)}]\n{payload['content']}"
                )
                # A successful subset must never authorize an excluded/failed source.
                observed = [
                    source
                    for source in payload.get("sources", [])
                    if isinstance(source, dict)
                    and isinstance(source.get("url"), str)
                    and _identity(source["url"]) in batch
                ]
                response["sources"].extend(observed)
                if "findings" in response:
                    response["findings"].extend(
                        finding
                        for finding in payload.get("findings", [])
                        if isinstance(finding, dict)
                        and finding.get("source_url")
                        in {source["url"] for source in observed}
                    )
            for batch, kind in failures:
                content.append(_failure_block(batch, kind))
            response["content"] = "\n\n".join(content)
        budget["completed"][cache_key] = {
            "response": response,
            "missing": list(budget["missing"]),
        }
        return response
