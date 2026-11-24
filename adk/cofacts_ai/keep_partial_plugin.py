"""Keep the text a stopped run had streamed so far.

While a model streams, ADK yields ``partial`` events and stores none of them;
only the finished response is appended to the session. When the client stops
the run (or its connection drops), ADK seals the invocation with an
``INVOCATION_ABORTED`` event, so the message that was streaming when the run
stopped would be gone from history although the user had already read part
of it.

This plugin remembers the text of the partial events since the last stored
one and, when the abort event comes through ``on_event_callback`` (which runs
before ADK appends it), puts that text on it. History then shows the answer
cut where the run stopped, and the model sees on the next turn where it was
interrupted. The event keeps its ``error_code``, so ADK still reads it as an
abort.

An abort that answers dangling function calls already has content (the
function responses); it is left alone. A process that is killed runs no code
at all, so its text is not kept.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from google.adk.agents.invocation_context import InvocationContext
from google.adk.events.event import Event
from google.adk.plugins.base_plugin import BasePlugin
from google.genai import types

INVOCATION_ABORTED = "INVOCATION_ABORTED"


@dataclass
class _Streaming:
    author: str
    texts: list[str] = field(default_factory=list)


class KeepPartialOnAbortPlugin(BasePlugin):
    def __init__(self) -> None:
        super().__init__(name="keep_partial_on_abort")
        # invocation id -> the message streaming in it right now
        self._streaming: dict[str, _Streaming] = {}

    async def on_event_callback(
        self, *, invocation_context: InvocationContext, event: Event
    ) -> Event | None:
        invocation_id = event.invocation_id
        if event.error_code == INVOCATION_ABORTED:
            streaming = self._streaming.pop(invocation_id, None)
            if event.content or not streaming or not streaming.texts:
                return None
            # ADK merges only the fields set here onto the abort event.
            return Event(
                author=streaming.author,
                content=types.Content(
                    role="model",
                    parts=[types.Part(text="".join(streaming.texts))],
                ),
            )

        if event.partial:
            texts = [
                part.text
                for part in (event.content.parts or [] if event.content else [])
                if part.text and not part.thought
            ]
            if texts:
                streaming = self._streaming.get(invocation_id)
                if streaming is None or streaming.author != event.author:
                    streaming = _Streaming(author=event.author)
                    self._streaming[invocation_id] = streaming
                streaming.texts.extend(texts)
        else:
            # A stored event: whatever was streaming is in history now.
            self._streaming.pop(invocation_id, None)
        return None

    async def after_run_callback(
        self, *, invocation_context: InvocationContext
    ) -> None:
        self._streaming.pop(invocation_context.invocation_id, None)

    async def on_run_error_callback(
        self, *, invocation_context: InvocationContext, error: Exception
    ) -> None:
        self._streaming.pop(invocation_context.invocation_id, None)
