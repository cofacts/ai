import asyncio
import logging

from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

TITLE_STATE_KEY = "title"
TITLE_MODEL = "gemini-3.1-flash-lite"
MAX_TITLE_LENGTH = 60
PROMPT_TEXT_LIMIT = 4000
TITLE_TIMEOUT_SECONDS = 10

# Reuse a single genai client across sessions instead of constructing one (and
# re-resolving ADC) on every first turn. Lazily initialized so importing this
# module needs no credentials.
_client = None


def _get_client():
    global _client
    if _client is None:
        _client = genai.Client()
    return _client


async def generate_session_title(callback_context) -> None:
    """Generates a session title after the first writer turn."""
    if _count_user_events(callback_context.session.events) != 1:
        return None

    user_text = _content_text(callback_context.user_content)
    result_text = _last_writer_text(callback_context.session.events)
    if not user_text and not result_text:
        return None

    try:
        raw_title = await asyncio.wait_for(
            _generate_title(user_text, result_text),
            timeout=TITLE_TIMEOUT_SECONDS,
        )
    except Exception:
        logger.exception("Failed to generate session title")
        return None

    title = _normalize_title(raw_title)
    if title:
        callback_context.state[TITLE_STATE_KEY] = title
    return None


def _count_user_events(events) -> int:
    return sum(1 for event in events if event.author == "user")


def _last_writer_text(events) -> str:
    for event in reversed(events):
        if event.author != "writer":
            continue
        text = _content_text(event.content)
        if text:
            return text
    return ""


def _content_text(content) -> str:
    if not content or not content.parts:
        return ""
    texts = []
    for part in content.parts:
        text = getattr(part, "text", None)
        if isinstance(text, str) and not getattr(part, "thought", False):
            texts.append(text)
    return "".join(texts).strip()


async def _generate_title(user_text: str, result_text: str) -> str:
    response = await _get_client().aio.models.generate_content(
        model=TITLE_MODEL,
        contents=_build_prompt(user_text, result_text),
        config=genai_types.GenerateContentConfig(
            thinking_config=genai_types.ThinkingConfig(
                thinking_level=genai_types.ThinkingLevel.MINIMAL
            ),
            max_output_tokens=128,
        ),
    )
    return response.text or ""


def _build_prompt(user_text: str, result_text: str) -> str:
    prompt = (
        "Return ONLY a concise, meaningful session title in the same language "
        "as the content. Use Traditional Chinese when the content is "
        "Traditional Chinese. Keep it under 60 characters. Do not include "
        "quotes or explanations.\n\n"
        f"User's first message:\n{_truncate_prompt_text(user_text)}"
    )
    if result_text:
        prompt += (
            "\n\nWriter's first result:\n"
            f"{_truncate_prompt_text(result_text)}"
        )
    return prompt


def _truncate_prompt_text(text: str) -> str:
    if len(text) <= PROMPT_TEXT_LIMIT:
        return text
    return text[:PROMPT_TEXT_LIMIT].rstrip()


# Quote characters the model sometimes wraps the whole title in. Stripped only as a
# matched pair, so a title that legitimately contains a quote (\u4ed6\u8aaa\u300c\u9019\u662f\u5047\u7684\u300d) keeps it.
_QUOTE_PAIRS = {
    '"': '"',
    "'": "'",
    "`": "`",
    "\u201c": "\u201d",
    "\u2018": "\u2019",
    "\u300c": "\u300d",
    "\u300e": "\u300f",
}


def _strip_wrapping_quotes(title: str) -> str:
    while len(title) >= 2:
        closing = _QUOTE_PAIRS.get(title[0])
        if closing is None or not title.endswith(closing):
            break
        title = title[1:-1].strip()
    return title


def _normalize_title(title: str) -> str:
    title = " ".join(title.split()).strip()
    title = _strip_wrapping_quotes(title)
    if len(title) > MAX_TITLE_LENGTH:
        title = title[:MAX_TITLE_LENGTH].rstrip()
    return title
