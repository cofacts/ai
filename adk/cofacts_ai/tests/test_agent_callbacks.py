import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from cofacts_ai.agent import after_tool, handle_writer_tool_error


def make_tool(name):
    """Fake BaseTool -- after_tool/handle_writer_tool_error only read .name."""
    return SimpleNamespace(name=name)


def make_tool_context(function_call_id="fc-1"):
    """Fake CallbackContext.

    after_tool only touches tool_context.function_call_id (plain attribute
    read) and `await tool_context.save_artifact(...)`. function_call_id is
    set explicitly because AsyncMock auto-vivifies attribute access as more
    AsyncMock instances, which are always truthy.
    """
    ctx = AsyncMock()
    ctx.function_call_id = function_call_id
    return ctx


INVESTIGATOR_TIMEOUT_ERROR = {
    "error": "timeout",
    "message": "[SYSTEM] Investigator returned empty. Possibly timeout. Retry with simpler/fewer queries.",
}

VERIFIER_TIMEOUT_ERROR = {
    "error": "timeout",
    "message": "[SYSTEM] Verifier returned empty. Possibly timeout. Retry with fewer URLs or claims.",
}


# ---- investigator branch ----


async def test_investigator_empty_string_returns_timeout_error():
    result = await after_tool(
        tool=make_tool("investigator"),
        args={},
        tool_context=make_tool_context(),
        tool_response="",
    )
    assert result == INVESTIGATOR_TIMEOUT_ERROR


async def test_investigator_whitespace_only_returns_timeout_error():
    result = await after_tool(
        tool=make_tool("investigator"),
        args={},
        tool_context=make_tool_context(),
        tool_response="   \n\t",
    )
    assert result == INVESTIGATOR_TIMEOUT_ERROR


async def test_investigator_none_returns_timeout_error():
    result = await after_tool(
        tool=make_tool("investigator"),
        args={},
        tool_context=make_tool_context(),
        tool_response=None,
    )
    assert result == INVESTIGATOR_TIMEOUT_ERROR


async def test_investigator_valid_json_dict_without_widget_html():
    tool_context = make_tool_context()
    payload = json.dumps({"content": "x", "sources": []})

    result = await after_tool(
        tool=make_tool("investigator"),
        args={},
        tool_context=tool_context,
        tool_response=payload,
    )

    assert result == {"content": "x", "sources": []}
    tool_context.save_artifact.assert_not_awaited()


async def test_investigator_valid_json_with_widget_html_saves_artifact_and_strips_it():
    tool_context = make_tool_context(function_call_id="fc-42")
    payload = json.dumps(
        {
            "content": "x",
            "sources": [],
            "_search_widget_html": "<div>widget</div>",
        }
    )

    result = await after_tool(
        tool=make_tool("investigator"),
        args={},
        tool_context=tool_context,
        tool_response=payload,
    )

    assert result == {"content": "x", "sources": []}
    tool_context.save_artifact.assert_awaited_once()
    _, kwargs = tool_context.save_artifact.call_args
    assert kwargs["filename"] == "search-widget-fc-42.html"
    assert kwargs["artifact"].inline_data.mime_type == "text/html"
    assert kwargs["artifact"].inline_data.data == b"<div>widget</div>"


async def test_investigator_widget_html_present_but_no_function_call_id_skips_artifact_save():
    tool_context = make_tool_context(function_call_id=None)
    payload = json.dumps(
        {
            "content": "x",
            "sources": [],
            "_search_widget_html": "<div>widget</div>",
        }
    )

    result = await after_tool(
        tool=make_tool("investigator"),
        args={},
        tool_context=tool_context,
        tool_response=payload,
    )

    assert result == {"content": "x", "sources": []}
    tool_context.save_artifact.assert_not_awaited()


async def test_investigator_json_parse_failure_nonempty_garbage_passthrough():
    result = await after_tool(
        tool=make_tool("investigator"),
        args={},
        tool_context=make_tool_context(),
        tool_response="not json {{",
    )
    assert result == "not json {{"


async def test_investigator_valid_json_but_not_a_dict_passthrough():
    result = await after_tool(
        tool=make_tool("investigator"),
        args={},
        tool_context=make_tool_context(),
        tool_response="[1, 2, 3]",
    )
    assert result == "[1, 2, 3]"


async def test_investigator_non_string_non_none_response_passthrough():
    already_a_dict = {"already": "a dict"}
    result = await after_tool(
        tool=make_tool("investigator"),
        args={},
        tool_context=make_tool_context(),
        tool_response=already_a_dict,
    )
    assert result is already_a_dict


# ---- verifier branch ----


async def test_verifier_empty_string_returns_timeout_error():
    result = await after_tool(
        tool=make_tool("verifier"),
        args={},
        tool_context=make_tool_context(),
        tool_response="",
    )
    assert result == VERIFIER_TIMEOUT_ERROR


async def test_verifier_whitespace_only_returns_timeout_error():
    result = await after_tool(
        tool=make_tool("verifier"),
        args={},
        tool_context=make_tool_context(),
        tool_response="  \n",
    )
    assert result == VERIFIER_TIMEOUT_ERROR


async def test_verifier_none_returns_none():
    # Unlike investigator, verifier's `None` hits the top
    # `if not isinstance(tool_response, str): return None` guard, not the
    # timeout dict.
    result = await after_tool(
        tool=make_tool("verifier"),
        args={},
        tool_context=make_tool_context(),
        tool_response=None,
    )
    assert result is None


async def test_verifier_valid_json_returns_parsed_dict():
    payload = json.dumps({"content": "c", "sources": [{"title": "t", "url": "u"}]})
    result = await after_tool(
        tool=make_tool("verifier"),
        args={},
        tool_context=make_tool_context(),
        tool_response=payload,
    )
    assert result == {"content": "c", "sources": [{"title": "t", "url": "u"}]}


async def test_verifier_invalid_json_returns_none():
    result = await after_tool(
        tool=make_tool("verifier"),
        args={},
        tool_context=make_tool_context(),
        tool_response="{not valid json",
    )
    assert result is None


async def test_verifier_non_string_response_returns_none():
    result = await after_tool(
        tool=make_tool("verifier"),
        args={},
        tool_context=make_tool_context(),
        tool_response=[1, 2, 3],
    )
    assert result is None


# ---- tool-name dispatch ----


async def test_unrelated_tool_name_returns_none_immediately():
    tool_context = make_tool_context()
    result = await after_tool(
        tool=make_tool("search_cofacts_database"),
        args={},
        tool_context=tool_context,
        tool_response=json.dumps({"content": "x"}),
    )
    assert result is None
    tool_context.save_artifact.assert_not_awaited()


# ---- handle_writer_tool_error (sync) ----


def test_handle_writer_tool_error_formats_generic_exception():
    result = handle_writer_tool_error(
        tool=make_tool("investigator"),
        args={},
        tool_context=None,
        error=ValueError("boom"),
    )
    assert result == {
        "error": "ValueError",
        "message": (
            "[SYSTEM] Tool 'investigator' failed with ValueError: boom. "
            "Please note this failure and continue with available information."
        ),
    }


def test_handle_writer_tool_error_uses_actual_exception_type_name():
    result = handle_writer_tool_error(
        tool=make_tool("verifier"),
        args={},
        tool_context=None,
        error=RuntimeError("oops"),
    )
    assert result == {
        "error": "RuntimeError",
        "message": (
            "[SYSTEM] Tool 'verifier' failed with RuntimeError: oops. "
            "Please note this failure and continue with available information."
        ),
    }
