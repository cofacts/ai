"""Unit tests for `prepare_writer_request`, ai_writer's before-model callback.

It must leave a request that ADK's Anthropic adapter can convert: media parts
become text, Gemini thought parts are dropped, Claude's own thinking is kept so
it round-trips back to Claude, and tool results reach Claude whole.
"""

import asyncio
import json
from types import SimpleNamespace
from typing import Any, cast

from anthropic import types as anthropic_types
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.context_cache_config import ContextCacheConfig
from google.adk.models.anthropic_llm import (
    AnthropicLlm,
    _content_to_message_param,
    _ToolUseIdSanitizer,
    content_block_to_part,
)
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types
from pydantic import TypeAdapter

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
        '[Attached file "chart.png" (image/png); you cannot view it. '
        "To inspect it, call verifier and include this exact URI in your "
        "request: gs://bucket/app/user/session/chart.png/0]"
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


def test_streamed_claude_thought_keeps_its_signature():
    """The writer streams (SSE), and Claude sends the signature as its own delta.

    The thought must come out of the adapter signed and survive this callback,
    or every later request of the turn loses Claude's reasoning.
    """
    events = [
        TypeAdapter(anthropic_types.RawMessageStreamEvent).validate_python(e)
        for e in [
            {
                "type": "message_start",
                "message": {
                    "id": "msg_1",
                    "type": "message",
                    "role": "assistant",
                    "model": "claude-haiku-5-5",
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 10, "output_tokens": 1},
                },
            },
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "thinking", "thinking": "", "signature": ""},
            },
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "thinking_delta", "thinking": "Plan the reply."},
            },
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "signature_delta", "signature": "RXVzaWduYXR1cmU="},
            },
            {"type": "content_block_stop", "index": 0},
            {
                "type": "content_block_start",
                "index": 1,
                "content_block": {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "verifier",
                    "input": {},
                },
            },
            {
                "type": "content_block_delta",
                "index": 1,
                "delta": {
                    "type": "input_json_delta",
                    "partial_json": '{"request": "x"}',
                },
            },
            {"type": "content_block_stop", "index": 1},
            {
                "type": "message_delta",
                "delta": {"stop_reason": "tool_use", "stop_sequence": None},
                "usage": {"output_tokens": 5},
            },
            {"type": "message_stop"},
        ]
    ]

    async def stream():
        for event in events:
            yield event

    async def create(**_):
        return stream()

    async def final_content() -> genai_types.Content:
        llm = AnthropicLlm(model="claude-haiku-5-5")
        llm.__dict__["_anthropic_client"] = SimpleNamespace(
            messages=SimpleNamespace(create=create)
        )
        request = LlmRequest(
            contents=[
                genai_types.Content(role="user", parts=[genai_types.Part(text="hi")])
            ]
        )
        responses = [r async for r in llm.generate_content_async(request, stream=True)]
        assert responses[-1].partial is False
        assert responses[-1].content is not None
        return responses[-1].content

    [content] = run([asyncio.run(final_content())])
    [thinking, tool_use] = cast(
        list[dict[str, Any]],
        _content_to_message_param(content, _ToolUseIdSanitizer())["content"],
    )
    assert thinking == {
        "type": "thinking",
        "thinking": "Plan the reply.",
        "signature": "RXVzaWduYXR1cmU=",
    }
    assert tool_use["type"] == "tool_use"


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


def test_gemini_thought_with_function_call_keeps_only_the_call():
    """The adapter checks the thought fields before the call.

    Left as they are, a Gemini part's binary signature raises
    `UnicodeDecodeError`. Covers a non-ASCII and a missing signature; an ASCII
    signature reads as Claude's own and is kept as a thought.
    """
    call = genai_types.FunctionCall(id="c1", name="verifier", args={"request": "x"})
    contents = run(
        [
            genai_types.Content(
                role="model",
                parts=[
                    genai_types.Part(
                        thought=True,
                        thought_signature=b"\x8f\x00\xff\x10",
                        function_call=call,
                    ),
                    genai_types.Part(thought=True, function_call=call),
                ],
            ),
            genai_types.Content(
                role="user",
                parts=[
                    genai_types.Part(
                        function_response=genai_types.FunctionResponse(
                            id="c1", name="verifier", response={"content": "ok"}
                        )
                    )
                ],
            ),
        ]
    )
    assert contents[0].parts == [genai_types.Part(function_call=call)] * 2
    sanitizer = _ToolUseIdSanitizer()
    model, user = [
        cast(list[dict[str, Any]], _content_to_message_param(c, sanitizer)["content"])
        for c in contents
    ]
    assert [b["type"] for b in model] == ["tool_use", "tool_use"]
    assert model[0]["name"] == "verifier"
    assert model[0]["input"] == {"request": "x"}
    assert [b["type"] for b in user] == ["tool_result"]
    assert user[0]["tool_use_id"] == model[0]["id"]


def test_empty_claude_thought_is_kept_as_redacted_thinking():
    """Claude accepts the signature as `redacted_thinking` data (checked live)."""
    part = content_block_to_part(
        anthropic_types.ThinkingBlock(
            type="thinking", thinking="", signature="RXVzaWduYXR1cmU="
        )
    )
    [content] = run([genai_types.Content(role="model", parts=[part])])
    assert content.parts == [part]
    [block] = cast(
        list[dict[str, Any]],
        _content_to_message_param(content, _ToolUseIdSanitizer())["content"],
    )
    assert block == {"type": "redacted_thinking", "data": "RXVzaWduYXR1cmU="}


def test_turns_on_prompt_caching_for_the_writer_only():
    llm_request = LlmRequest(contents=[])
    prepare_writer_request(CALLBACK_CONTEXT, llm_request)
    # ADK's default lifetime, which the adapter maps to Claude's 5-minute cache.
    assert llm_request.cache_config == ContextCacheConfig()

    app_wide = ContextCacheConfig(ttl_seconds=3600)
    llm_request = LlmRequest(contents=[], cache_config=app_wide)
    prepare_writer_request(CALLBACK_CONTEXT, llm_request)
    assert llm_request.cache_config is app_wide
