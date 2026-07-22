"""Unit tests for ai_writer's callbacks: `after_tool`,
`handle_writer_tool_error`, and `expand_writer_symbols`.

`after_tool` post-processes investigator/verifier/proofreader responses --
most importantly the empty/None/whitespace timeout-error protection, since a
real server-side timeout is probabilistic and can't be reproduced
deterministically over the network. `handle_writer_tool_error` converts
any exception a writer tool raises into a structured error dict.
`expand_writer_symbols` expands `[[message]]`/`[[draft]]`/`[[draft:vN]]`
symbols in a sub-agent call's `request` argument by reading the writer's own
event history (cofacts/ai#117), since each investigator/verifier/proofreader
AgentTool call is a fresh, stateless single-message session that cannot see
anything the writer didn't put directly in `request`. All three are
exercised purely through mocked tool/tool_context/tool_response inputs.
"""

import json
from types import SimpleNamespace
from typing import Optional, cast
from unittest.mock import AsyncMock

from google.adk.agents.callback_context import CallbackContext
from google.adk.tools.base_tool import BaseTool

from cofacts_ai.agent_names import (
    AI_INVESTIGATOR_NAME,
    AI_PROOFREADER_DPP_NAME,
    AI_PROOFREADER_KMT_NAME,
    AI_PROOFREADER_NAMES,
    AI_PROOFREADER_TPP_NAME,
    AI_VERIFIER_NAME,
)
from cofacts_ai.agent import after_tool, expand_writer_symbols, handle_writer_tool_error


def make_tool(name: str) -> BaseTool:
    """Fake BaseTool -- after_tool/handle_writer_tool_error only read .name."""
    return cast(BaseTool, SimpleNamespace(name=name))


def make_tool_context(function_call_id: Optional[str] = "fc-1") -> CallbackContext:
    """Fake CallbackContext.

    after_tool only touches tool_context.function_call_id (plain attribute
    read) and `await tool_context.save_artifact(...)`. function_call_id is
    set explicitly because AsyncMock auto-vivifies attribute access as more
    AsyncMock instances, which are always truthy.
    """
    ctx = AsyncMock()
    ctx.function_call_id = function_call_id
    return cast(CallbackContext, ctx)


def make_fn_call_event(name: str, args: dict) -> SimpleNamespace:
    """Fake ADK Event bearing one function_call part.

    expand_writer_symbols only reads event.content.parts[*].function_call
    (.name, .args), so a SimpleNamespace stand-in avoids coupling the test to
    google.genai's pydantic models.
    """
    part = SimpleNamespace(
        function_call=SimpleNamespace(name=name, args=args),
        function_response=None,
    )
    return SimpleNamespace(content=SimpleNamespace(parts=[part]))


def make_fn_response_event(name: str, response: dict) -> SimpleNamespace:
    """Fake ADK Event bearing one function_response part."""
    part = SimpleNamespace(
        function_call=None,
        function_response=SimpleNamespace(name=name, response=response),
    )
    return SimpleNamespace(content=SimpleNamespace(parts=[part]))


def make_symbol_tool_context(events: list) -> CallbackContext:
    """Fake ToolContext exposing only the public `.session.events` path
    expand_writer_symbols reads (ReadonlyContext.session, verified public in
    ADK 1.26.0 -- Context(ReadonlyContext) inherits it)."""
    return cast(
        CallbackContext, SimpleNamespace(session=SimpleNamespace(events=events))
    )


INVESTIGATOR_TIMEOUT_ERROR = {
    "error": "timeout",
    "message": f"[SYSTEM] {AI_INVESTIGATOR_NAME.capitalize()} returned empty. Possibly timeout. Retry with simpler/fewer queries.",
}

VERIFIER_TIMEOUT_ERROR = {
    "error": "timeout",
    "message": f"[SYSTEM] {AI_VERIFIER_NAME.capitalize()} returned empty. Possibly timeout. Retry with fewer URLs or claims.",
}


class TestAfterToolInvestigator:
    async def test_empty_string_returns_timeout_error(self):
        result = await after_tool(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response="",
        )
        assert result == INVESTIGATOR_TIMEOUT_ERROR

    async def test_whitespace_only_returns_timeout_error(self):
        result = await after_tool(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response="   \n\t",
        )
        assert result == INVESTIGATOR_TIMEOUT_ERROR

    async def test_none_returns_timeout_error(self):
        result = await after_tool(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response=None,
        )
        assert result == INVESTIGATOR_TIMEOUT_ERROR

    async def test_valid_json_dict_without_widget_html(self):
        tool_context = make_tool_context()
        payload = json.dumps({"content": "x", "sources": []})

        result = await after_tool(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=tool_context,
            tool_response=payload,
        )

        assert result == {"content": "x", "sources": []}
        cast(AsyncMock, tool_context.save_artifact).assert_not_awaited()

    async def test_valid_json_with_widget_html_saves_artifact_and_strips_it(self):
        tool_context = make_tool_context(function_call_id="fc-42")
        payload = json.dumps(
            {
                "content": "x",
                "sources": [],
                "_search_widget_html": "<div>widget</div>",
            }
        )

        result = await after_tool(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=tool_context,
            tool_response=payload,
        )

        assert result == {"content": "x", "sources": []}
        save_artifact = cast(AsyncMock, tool_context.save_artifact)
        save_artifact.assert_awaited_once()
        _, kwargs = save_artifact.call_args
        assert kwargs["filename"] == "search-widget-fc-42.html"
        assert kwargs["artifact"].inline_data.mime_type == "text/html"
        assert kwargs["artifact"].inline_data.data == b"<div>widget</div>"

    async def test_widget_html_present_but_no_function_call_id_skips_artifact_save(
        self,
    ):
        tool_context = make_tool_context(function_call_id=None)
        payload = json.dumps(
            {
                "content": "x",
                "sources": [],
                "_search_widget_html": "<div>widget</div>",
            }
        )

        result = await after_tool(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=tool_context,
            tool_response=payload,
        )

        assert result == {"content": "x", "sources": []}
        cast(AsyncMock, tool_context.save_artifact).assert_not_awaited()

    async def test_json_parse_failure_nonempty_garbage_passthrough(self):
        result = await after_tool(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response="not json {{",
        )
        assert result == "not json {{"

    async def test_valid_json_but_not_a_dict_passthrough(self):
        result = await after_tool(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response="[1, 2, 3]",
        )
        assert result == "[1, 2, 3]"

    async def test_non_string_non_none_response_passthrough(self):
        already_a_dict = {"already": "a dict"}
        result = await after_tool(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response=already_a_dict,
        )
        assert result is already_a_dict


class TestAfterToolVerifier:
    async def test_empty_string_returns_timeout_error(self):
        result = await after_tool(
            tool=make_tool(AI_VERIFIER_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response="",
        )
        assert result == VERIFIER_TIMEOUT_ERROR

    async def test_whitespace_only_returns_timeout_error(self):
        result = await after_tool(
            tool=make_tool(AI_VERIFIER_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response="  \n",
        )
        assert result == VERIFIER_TIMEOUT_ERROR

    async def test_none_returns_timeout_error(self):
        result = await after_tool(
            tool=make_tool(AI_VERIFIER_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response=None,
        )
        assert result == VERIFIER_TIMEOUT_ERROR

    async def test_valid_json_returns_parsed_dict(self):
        payload = json.dumps({"content": "c", "sources": [{"title": "t", "url": "u"}]})
        result = await after_tool(
            tool=make_tool(AI_VERIFIER_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response=payload,
        )
        assert result == {"content": "c", "sources": [{"title": "t", "url": "u"}]}

    async def test_invalid_json_returns_none(self):
        result = await after_tool(
            tool=make_tool(AI_VERIFIER_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response="{not valid json",
        )
        assert result is None

    async def test_non_string_response_returns_none(self):
        result = await after_tool(
            tool=make_tool(AI_VERIFIER_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response=[1, 2, 3],
        )
        assert result is None


class TestAfterToolProofreader:
    async def test_empty_string_returns_timeout_error_for_every_proofreader(self):
        for name in AI_PROOFREADER_NAMES:
            result = await after_tool(
                tool=make_tool(name),
                args={},
                tool_context=make_tool_context(),
                tool_response="",
            )
            assert result == {
                "error": "timeout",
                "message": f"[SYSTEM] {name} returned empty. Possibly a dropped call or timeout. Retry this proofreader.",
            }

    async def test_whitespace_only_returns_timeout_error(self):
        result = await after_tool(
            tool=make_tool(AI_PROOFREADER_KMT_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response="  \n\t",
        )
        assert result == {
            "error": "timeout",
            "message": f"[SYSTEM] {AI_PROOFREADER_KMT_NAME} returned empty. Possibly a dropped call or timeout. Retry this proofreader.",
        }

    async def test_none_returns_timeout_error(self):
        result = await after_tool(
            tool=make_tool(AI_PROOFREADER_KMT_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response=None,
        )
        assert result == {
            "error": "timeout",
            "message": f"[SYSTEM] {AI_PROOFREADER_KMT_NAME} returned empty. Possibly a dropped call or timeout. Retry this proofreader.",
        }

    async def test_nonempty_plain_text_passthrough_without_json_parsing(self):
        # Proofreaders return plain prose, not JSON -- must not be run through
        # json.loads (unlike investigator/verifier).
        result = await after_tool(
            tool=make_tool(AI_PROOFREADER_DPP_NAME),
            args={},
            tool_context=make_tool_context(),
            tool_response="這則訊息對民進黨支持者來說可能引發質疑 {not json",
        )
        assert result is None  # None = passthrough, keep original tool_response

    async def test_nonempty_response_does_not_save_artifact(self):
        tool_context = make_tool_context()
        await after_tool(
            tool=make_tool(AI_PROOFREADER_TPP_NAME),
            args={},
            tool_context=tool_context,
            tool_response="some proofreader feedback",
        )
        cast(AsyncMock, tool_context.save_artifact).assert_not_awaited()


class TestAfterToolDispatch:
    async def test_unrelated_tool_name_returns_none_immediately(self):
        tool_context = make_tool_context()
        result = await after_tool(
            tool=make_tool("search_cofacts_database"),
            args={},
            tool_context=tool_context,
            tool_response=json.dumps({"content": "x"}),
        )
        assert result is None
        cast(AsyncMock, tool_context.save_artifact).assert_not_awaited()


class TestHandleWriterToolError:
    def test_formats_generic_exception(self):
        result = handle_writer_tool_error(
            tool=make_tool(AI_INVESTIGATOR_NAME),
            args={},
            tool_context=None,
            error=ValueError("boom"),
        )
        assert result == {
            "error": "ValueError",
            "message": (
                f"[SYSTEM] Tool '{AI_INVESTIGATOR_NAME}' failed with ValueError: boom. "
                "Please note this failure and continue with available information."
            ),
        }

    def test_uses_actual_exception_type_name(self):
        result = handle_writer_tool_error(
            tool=make_tool(AI_VERIFIER_NAME),
            args={},
            tool_context=None,
            error=RuntimeError("oops"),
        )
        assert result == {
            "error": "RuntimeError",
            "message": (
                f"[SYSTEM] Tool '{AI_VERIFIER_NAME}' failed with RuntimeError: oops. "
                "Please note this failure and continue with available information."
            ),
        }


class TestExpandWriterSymbols:
    def test_unrelated_tool_name_is_skipped_even_with_symbols_present(self):
        args = {"request": "please review [[draft]]"}
        result = expand_writer_symbols(
            make_tool("search_cofacts_database"), args, make_symbol_tool_context([])
        )
        assert result is None
        assert args["request"] == "please review [[draft]]"

    def test_no_symbols_leaves_request_untouched(self):
        args = {"request": "plain request with no symbols"}
        result = expand_writer_symbols(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_symbol_tool_context([])
        )
        assert result is None
        assert args["request"] == "plain request with no symbols"

    def test_non_string_request_is_ignored(self):
        args = {"request": None}
        result = expand_writer_symbols(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_symbol_tool_context([])
        )
        assert result is None
        assert args["request"] is None

    def test_draft_symbol_expands_to_latest_proposal(self):
        events = [
            make_fn_call_event(
                "draft_factcheck_response",
                {
                    "text": "draft v1",
                    "classification": "RUMOR",
                    "references": "https://x",
                },
            ),
            make_fn_call_event(
                "draft_factcheck_response",
                {
                    "text": "draft v2",
                    "classification": "RUMOR",
                    "references": "https://x",
                },
            ),
        ]
        args = {"request": "Review this: [[draft]]"}
        result = expand_writer_symbols(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_symbol_tool_context(events)
        )
        assert result is None
        assert args["request"] == "Review this: draft v2"

    def test_versioned_draft_symbol_selects_specific_proposal(self):
        events = [
            make_fn_call_event("draft_factcheck_response", {"text": "draft v1"}),
            make_fn_call_event("draft_factcheck_response", {"text": "draft v2"}),
        ]
        args = {"request": "Review [[draft:v1]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_DPP_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "Review draft v1"

    def test_rejected_proposal_still_resolves_from_function_call_args(self):
        # A rejected proposal (failed claim_sources/verification gate) never
        # gets a successful function_response, but its function_call args --
        # the text the writer actually proposed -- are still in the event
        # history, so proofreaders can review pre-verification prose too.
        events = [
            make_fn_call_event(
                "draft_factcheck_response", {"text": "rejected draft text"}
            )
        ]
        args = {"request": "[[draft]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_TPP_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "rejected draft text"

    def test_missing_draft_symbol_yields_explicit_marker_not_silent_drop(self):
        args = {"request": "Review [[draft]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_symbol_tool_context([])
        )
        # Marker text deliberately echoes the unresolved symbol for diagnostic
        # clarity (e.g. "...to resolve [[draft]]"), so it isn't literally
        # absent -- but the symbol is no longer left bare/unexplained.
        assert args["request"] != "Review [[draft]]"
        assert "SYSTEM" in args["request"]

    def test_out_of_range_version_yields_explicit_marker(self):
        events = [make_fn_call_event("draft_factcheck_response", {"text": "only one"})]
        args = {"request": "[[draft:v5]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_TPP_NAME), args, make_symbol_tool_context(events)
        )
        assert "SYSTEM" in args["request"]
        assert "only one" not in args["request"]

    def test_message_symbol_expands_from_article_tool_response(self):
        events = [
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article": {"text": "the suspicious message"}},
            )
        ]
        args = {"request": "[[message]] -- what do you think?"}
        expand_writer_symbols(
            make_tool(AI_INVESTIGATOR_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "the suspicious message -- what do you think?"

    def test_message_symbol_missing_yields_explicit_marker(self):
        args = {"request": "[[message]]"}
        expand_writer_symbols(
            make_tool(AI_VERIFIER_NAME), args, make_symbol_tool_context([])
        )
        assert args["request"] != "[[message]]"
        assert "SYSTEM" in args["request"]

    def test_both_symbols_expand_in_one_request(self):
        events = [
            make_fn_response_event(
                "get_single_cofacts_article", {"article": {"text": "original message"}}
            ),
            make_fn_call_event("draft_factcheck_response", {"text": "the draft"}),
        ]
        args = {"request": "[[message]] / [[draft]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_DPP_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "original message / the draft"

    def test_applies_to_investigator_and_verifier_too(self):
        events = [make_fn_call_event("draft_factcheck_response", {"text": "the draft"})]
        for name in (AI_INVESTIGATOR_NAME, AI_VERIFIER_NAME):
            args = {"request": "[[draft]]"}
            expand_writer_symbols(
                make_tool(name), args, make_symbol_tool_context(events)
            )
            assert args["request"] == "the draft"
