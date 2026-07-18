"""Unit tests for ai_writer's callbacks: `after_tool` and
`handle_writer_tool_error`.

`after_tool` post-processes investigator/verifier responses -- most
importantly the empty/None/whitespace timeout-error protection, since a
real server-side timeout is probabilistic and can't be reproduced
deterministically over the network. `handle_writer_tool_error` converts
any exception a writer tool raises into a structured error dict. Both are
exercised purely through mocked tool/tool_context/tool_response inputs.
"""

import json
from types import SimpleNamespace
from typing import Optional, cast
from unittest.mock import AsyncMock

from google.adk.agents.callback_context import CallbackContext
from google.adk.tools.base_tool import BaseTool

from cofacts_ai.agent_names import AI_INVESTIGATOR_NAME, AI_VERIFIER_NAME
from cofacts_ai.agent import after_tool, handle_writer_tool_error


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
