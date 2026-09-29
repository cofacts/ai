"""Unit tests for `generate_session_title` and `_normalize_title`.

`generate_session_title` runs as an after_agent_callback on ai_receptionist
(the root): on the first turn only, it asks an LLM for a concise title and
writes it to session state, replacing the placeholder the frontend sets at
session creation. That placeholder is why "first turn" is decided by counting
user events rather than by looking at the title already in state. The
genai client is mocked so the tests are deterministic and make no network
calls; the session/event objects are SimpleNamespace fakes since the callback
only reads plain attributes. `_normalize_title` is exercised directly for the
matched-pair quote stripping, which regressed once before (unmatched CJK
quotes were mangled).
"""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, patch

from google.adk.agents.callback_context import CallbackContext

from cofacts_ai.agent_names import AI_RECEPTIONIST_NAME, AI_WRITER_NAME
from cofacts_ai.session_title import _normalize_title, generate_session_title


def make_content(text: str) -> SimpleNamespace:
    return SimpleNamespace(
        parts=[SimpleNamespace(text=text, thought=False)] if text else []
    )


def make_event(author: str, text: str) -> SimpleNamespace:
    return SimpleNamespace(author=author, content=make_content(text))


def make_context(
    events: list[SimpleNamespace],
    user_text: str = "",
    title: str = "placeholder",
) -> CallbackContext:
    """Fake CallbackContext -- generate_session_title only reads
    session.events, user_content, and mutates state like a dict."""
    return cast(
        CallbackContext,
        SimpleNamespace(
            session=SimpleNamespace(events=events),
            user_content=make_content(user_text),
            state={"title": title},
        ),
    )


def make_client(generate_content: AsyncMock) -> SimpleNamespace:
    """Fake genai client exposing only aio.models.generate_content."""
    return SimpleNamespace(
        aio=SimpleNamespace(
            models=SimpleNamespace(generate_content=generate_content),
        )
    )


class TestGenerateSessionTitle:
    async def test_first_turn_sets_normalized_title(self):
        generate_content = AsyncMock(
            return_value=SimpleNamespace(text=' "台電停電查證"\n ')
        )
        client = make_client(generate_content)
        context = make_context(
            [
                make_event("user", "請查證台電停電傳言"),
                make_event(AI_WRITER_NAME, "這則訊息需要比對台電公告。"),
            ],
            user_text="請查證台電停電傳言",
            title="請查證台電停電傳言",
        )

        with patch("cofacts_ai.session_title._get_client", return_value=client):
            await generate_session_title(context)

        assert context.state["title"] == "台電停電查證"
        generate_content.assert_awaited_once()

    async def test_titles_a_turn_the_receptionist_handled_alone(self):
        # Not every first turn reaches the writer: a support-desk question, or a
        # reporting flow still waiting for the user to pick a message, ends at
        # the receptionist. Those sessions still need a title.
        generate_content = AsyncMock(return_value=SimpleNamespace(text="退貨爭議諮詢"))
        client = make_client(generate_content)
        context = make_context(
            [
                make_event("user", "我要退貨"),
                make_event(AI_RECEPTIONIST_NAME, "這裡不是賣家喔，建議你撥打 1950。"),
            ],
            user_text="我要退貨",
            title="我要退貨",
        )

        with patch("cofacts_ai.session_title._get_client", return_value=client):
            await generate_session_title(context)

        assert context.state["title"] == "退貨爭議諮詢"
        # The receptionist's own reply is what the title is built from.
        call = generate_content.await_args
        assert call is not None
        assert "這裡不是賣家喔" in call.kwargs["contents"]

    async def test_placeholder_title_does_not_block_generation(self):
        # The frontend always seeds state["title"] with the user's truncated
        # first message, so a truthy title says nothing about whether a real one
        # was generated. Guarding on it would disable this callback entirely.
        generate_content = AsyncMock(return_value=SimpleNamespace(text="台電停電查證"))
        client = make_client(generate_content)
        context = make_context(
            [
                make_event("user", "請查證台電停電傳言"),
                make_event(AI_WRITER_NAME, "查證結果"),
            ],
            user_text="請查證台電停電傳言",
            title="請查證台電停電傳言",
        )

        with patch("cofacts_ai.session_title._get_client", return_value=client):
            await generate_session_title(context)

        assert context.state["title"] == "台電停電查證"

    async def test_second_turn_does_not_call_llm(self):
        context = make_context(
            [
                make_event("user", "第一則訊息"),
                make_event(AI_WRITER_NAME, "第一回覆"),
                make_event("user", "第二則訊息"),
            ],
            user_text="第二則訊息",
            title="使用者改過的標題",
        )

        with patch("cofacts_ai.session_title._get_client") as get_client:
            await generate_session_title(context)

        assert context.state["title"] == "使用者改過的標題"
        get_client.assert_not_called()

    async def test_llm_error_leaves_title_unchanged(self):
        generate_content = AsyncMock(side_effect=RuntimeError("boom"))
        client = make_client(generate_content)
        context = make_context(
            [
                make_event("user", "請查證"),
                make_event(AI_WRITER_NAME, "查證結果"),
            ],
            user_text="請查證",
            title="請查證",
        )

        with (
            patch("cofacts_ai.session_title._get_client", return_value=client),
            patch("cofacts_ai.session_title.logger.exception") as log_error,
        ):
            await generate_session_title(context)

        assert context.state["title"] == "請查證"
        log_error.assert_called_once()

    async def test_whitespace_title_is_not_written(self):
        generate_content = AsyncMock(return_value=SimpleNamespace(text="\n  \t"))
        client = make_client(generate_content)
        context = make_context(
            [
                make_event("user", "請查證"),
                make_event(AI_WRITER_NAME, "查證結果"),
            ],
            user_text="請查證",
            title="請查證",
        )

        with patch("cofacts_ai.session_title._get_client", return_value=client):
            await generate_session_title(context)

        assert context.state["title"] == "請查證"


class TestNormalizeTitle:
    def test_strips_a_matched_wrapping_quote_pair(self):
        assert _normalize_title(' "台電停電查證"\n ') == "台電停電查證"
        assert _normalize_title("「台電停電查證」") == "台電停電查證"

    def test_keeps_quotes_that_belong_to_the_title(self):
        # An unmatched edge quote is part of the content, not a wrapper: it must survive.
        assert _normalize_title("他說「這是假的」") == "他說「這是假的」"
        assert _normalize_title("台電停電傳言：「假的」") == "台電停電傳言：「假的」"
        assert _normalize_title("「台電停電」是假的") == "「台電停電」是假的"

    def test_collapses_whitespace_and_truncates(self):
        assert _normalize_title("  台電   停電  ") == "台電 停電"
        assert len(_normalize_title("字" * 80)) == 60
