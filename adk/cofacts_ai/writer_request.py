"""
Before-model callback that keeps ai_writer's request sendable to Claude.

ai_writer runs on Claude (Haiku) through ADK's Anthropic adapter, which cannot
carry three kinds of part that a session can still hold as they are:

* ``file_data`` parts — user uploads that ``SaveFilesAsArtifactsPlugin`` turns
  into ``gs://`` references, and anything else stored as a file reference. The
  adapter raises ``NotImplementedError`` on them, and since the part stays in
  history, every later turn of the session would fail the same way. Inline media
  is converted too: the writer is text-only by design (its media is perceived by
  the verifier, see the writer instruction), so it should not see an image just
  because an upload happened to stay inline.
* Thought parts written by Gemini, from sessions that started before the writer
  moved to Claude. The adapter would replay them as Claude ``thinking`` blocks,
  which Claude rejects without a valid Claude signature. A Gemini thought part
  can also carry a function call; the adapter checks the thought fields first,
  so it would never emit that call and its response would be orphaned. Such a
  part keeps the call and loses only its thought fields.
* Function responses. When a response dict has a string ``content``, the
  adapter sends Claude only that string and drops every other key — for
  investigator/verifier results that is ``sources``, ``cite_as`` and
  ``cite_hint``, which the writer needs to cite anything. Other responses are
  serialized with ``json.dumps``' default ASCII escaping, which turns every
  Chinese character into a ``\\uXXXX`` sequence. So every response is
  serialized here, whole and unescaped, into the one shape the adapter passes
  through verbatim: ``{"content": "<JSON>"}``.

The rewrite is deterministic and only depends on the stored history, so every
request sends the same prefix — Claude invalidates its own thinking blocks when
an earlier turn changes between requests.

The same stable prefix is what makes prompt caching pay off, so this callback
also turns it on for the writer alone. ``App(context_cache_config=...)`` would
apply to every agent, and the Gemini sub-agents would then create server-side
cache resources for single-request sessions that are never reused. The adapter
reads ``llm_request.cache_config`` after this callback; ADK's default
``ttl_seconds`` (1800) maps to Claude's 5-minute cache, which every hit renews,
so a whole fact-check turn stays cached at the cheaper 1.25x write rate.
"""

import json
from typing import Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.context_cache_config import ContextCacheConfig
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types


def _media_placeholder(part: genai_types.Part) -> Optional[genai_types.Part]:
    """Returns a text stand-in for a media part, or None if it is not media."""
    if part.file_data:
        label = part.file_data.display_name or part.file_data.file_uri or "file"
        mime_type = part.file_data.mime_type or "unknown type"
        uri = part.file_data.file_uri
        where = f" at {uri}" if uri and uri != label else ""
    elif part.inline_data:
        label = part.inline_data.display_name or "file"
        mime_type = part.inline_data.mime_type or "unknown type"
        where = ""
    else:
        return None
    return genai_types.Part(
        text=f'[Attached media "{label}" ({mime_type}){where}; you cannot view it.]'
    )


def _serialized_function_response(part: genai_types.Part) -> genai_types.Part:
    """Returns the function response part with its dict serialized whole."""
    fr = part.function_response
    assert fr is not None
    content = json.dumps(fr.response or {}, ensure_ascii=False, default=str)
    return part.model_copy(
        update={
            "function_response": fr.model_copy(
                update={"response": {"content": content}}
            )
        }
    )


def _is_claude_thought(part: genai_types.Part) -> bool:
    """Whether a thought part carries a signature Claude can verify.

    The Anthropic adapter stores Claude's signature as the UTF-8 bytes of an
    ASCII string; Gemini's thought signatures are opaque binary, and Gemini
    thought summaries often carry none at all.
    """
    signature = part.thought_signature
    if not signature:
        return False
    try:
        signature.decode("ascii")
    except UnicodeDecodeError:
        return False
    return True


def prepare_writer_request(
    callback_context: CallbackContext,
    llm_request: LlmRequest,
) -> None:
    """Before-model callback for ai_writer. See the module docstring."""
    if llm_request.cache_config is None:
        llm_request.cache_config = ContextCacheConfig()
    for content in llm_request.contents:
        if not content.parts:
            continue
        new_parts = []
        changed = False
        for part in content.parts:
            if part.thought and not _is_claude_thought(part):
                changed = True
                # Dropping a call would orphan its response, so the call stays
                # and only the thought goes.
                if part.function_call:
                    new_parts.append(
                        part.model_copy(
                            update={
                                "thought": None,
                                "thought_signature": None,
                                "text": None,
                            }
                        )
                    )
                continue
            placeholder = _media_placeholder(part)
            if placeholder:
                new_parts.append(placeholder)
                changed = True
                continue
            if part.function_response:
                new_parts.append(_serialized_function_response(part))
                changed = True
                continue
            new_parts.append(part)
        if changed:
            content.parts = new_parts
    return None
