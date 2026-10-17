"""Unit tests for `prepare_writer_request`, ai_writer's before-model callback.

It must leave a request that ADK's Anthropic adapter can convert: media parts
become text, Gemini thought parts are dropped, Claude's own thinking is kept so
it round-trips back to Claude, and tool results reach Claude whole.
"""

import json
from typing import Any, cast

from anthropic import types as anthropic_types
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.anthropic_llm import (
    _content_to_message_param,
    _ToolUseIdSanitizer,
    content_block_to_part,
)
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

from cofacts_ai.writer_request import prepare_writer_request

CALLBACK_CONTEXT = cast(CallbackContext, None)


def run(contents: list[genai_types.Content]) -> list[genai_types.Content]:
    llm_request = LlmRequest(contents=contents)
    prepare_writer_request(CALLBACK_CONTEXT, llm_request)
    return llm_request.contents


def claude_thought() -> genai_types.Part:
    return content_block_to_part(
        anthropic_types.ThinkingBlock(
            type="thinking", thinking="Plan the reply.", signature="RXVzaWduYXR1cmU="
        )
    )


def test_file_data_becomes_text():
    [content] = run(
        [
            genai_types.Content(
                role="user",
                parts=[
                    genai_types.Part(text='[Uploaded Artifact: "chart.png"]'),
                    genai_types.Part(
                        file_data=genai_types.FileData(
                            file_uri="gs://bucket/app/user/session/chart.png/0",
                            mime_type="image/png",
                            display_name="chart.png",
                        )
                    ),
                ],
            )
        ]
    )
    assert content.parts is not None
    assert [p.file_data for p in content.parts] == [None, None]
    assert content.parts[1].text == (
        '[Attached media "chart.png" (image/png) at '
        "gs://bucket/app/user/session/chart.png/0; you cannot view it.]"
    )


def test_inline_data_becomes_text():
    [content] = run(
        [
            genai_types.Content(
                role="user",
                parts=[
                    genai_types.Part(
                        inline_data=genai_types.Blob(
                            data=b"\x00", mime_type="video/mp4", display_name="a.mp4"
                        )
                    )
                ],
            )
        ]
    )
    assert content.parts is not None
    assert content.parts[0].inline_data is None
    assert content.parts[0].text == (
        '[Attached media "a.mp4" (video/mp4); you cannot view it.]'
    )


def test_gemini_thoughts_are_dropped_and_claude_thoughts_kept():
    gemini_summary = genai_types.Part(text="Gemini summary", thought=True)
    gemini_signed = genai_types.Part(
        text="Gemini signed", thought=True, thought_signature=b"\x8f\x00\xff\x10"
    )
    # Gemini signs function calls; those parts are not thoughts and must stay.
    gemini_call = genai_types.Part(
        function_call=genai_types.FunctionCall(name="verifier", args={}),
        thought_signature=b"\x8f\x00\xff\x10",
    )
    claude = claude_thought()
    [gemini_turn, claude_turn] = run(
        [
            genai_types.Content(
                role="model", parts=[gemini_summary, gemini_signed, gemini_call]
            ),
            genai_types.Content(
                role="model", parts=[claude, genai_types.Part(text="Draft")]
            ),
        ]
    )
    assert gemini_turn.parts == [gemini_call]
    assert claude_turn.parts == [claude, genai_types.Part(text="Draft")]


def test_untouched_contents_keep_their_parts():
    content = genai_types.Content(role="user", parts=[genai_types.Part(text="hi")])
    parts = content.parts
    run([content])
    assert content.parts is parts


def test_result_converts_to_claude_messages():
    """The point of the callback: nothing left that the adapter raises on."""
    contents = run(
        [
            genai_types.Content(
                role="user",
                parts=[
                    genai_types.Part(
                        file_data=genai_types.FileData(
                            file_uri="gs://bucket/x.webp", mime_type="image/webp"
                        )
                    )
                ],
            ),
            genai_types.Content(
                role="model",
                parts=[
                    genai_types.Part(text="Gemini summary", thought=True),
                    claude_thought(),
                    genai_types.Part(text="Draft"),
                ],
            ),
        ]
    )
    sanitizer = _ToolUseIdSanitizer()
    user, model = [
        cast(list[dict[str, Any]], _content_to_message_param(c, sanitizer)["content"])
        for c in contents
    ]
    assert [b["type"] for b in user] == ["text"]
    assert [b["type"] for b in model] == ["thinking", "text"]
    assert model[0]["signature"] == "RXVzaWduYXR1cmU="


def test_function_response_reaches_claude_whole_and_unescaped():
    """The adapter would send only `content` and drop `sources` / `cite_as`."""
    response = {
        "content": "圖片顯示 X",
        "sources": [{"title": "來源", "url": "https://example.org/a"}],
        "cite_as": "[^verifier-abc123]",
    }
    [content] = run(
        [
            genai_types.Content(
                role="user",
                parts=[
                    genai_types.Part(
                        function_response=genai_types.FunctionResponse(
                            id="toolu_1", name="verifier", response=response
                        )
                    )
                ],
            )
        ]
    )
    [block] = cast(
        list[dict[str, Any]],
        _content_to_message_param(content, _ToolUseIdSanitizer())["content"],
    )
    assert block["type"] == "tool_result"
    assert block["tool_use_id"] == "toolu_1"
    assert json.loads(block["content"]) == response
    assert "圖片顯示" in block["content"]


def test_thought_with_function_call_is_kept():
    part = genai_types.Part(
        thought=True,
        function_call=genai_types.FunctionCall(id="c1", name="verifier", args={}),
    )
    [content] = run([genai_types.Content(role="model", parts=[part])])
    assert content.parts == [part]
