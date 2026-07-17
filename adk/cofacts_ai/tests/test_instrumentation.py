"""Unit tests for `TextExtractionSpanProcessor`, `_move_processor_first`, and
`_parts_text`.

The processor rewrites input.value/output.value from serialized JSON to plain
text at span end (#14). The processor tests drive a real SDK TracerProvider in
the production registration order (exporting processor first, rewrite second,
then _move_processor_first) and assert on attributes snapshotted at export()
time, the way OTLP serialization reads them -- on_end only receives a
ReadableSpan snapshot, so a set_attribute-based implementation raises
AttributeError, and a reference-holding exporter would hide ordering bugs.
`_parts_text` and the fallback paths are exercised directly without a provider.
"""

import json
from collections.abc import Mapping
from types import MappingProxyType, SimpleNamespace
from typing import Any, cast

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    SimpleSpanProcessor,
    SpanExporter,
    SpanExportResult,
)

from cofacts_ai.instrumentation import (
    TextExtractionSpanProcessor,
    _move_processor_first,
    _parts_text,
)

JSON_MIME = "application/json"

INVOCATION_INPUT = json.dumps(
    {
        "user_id": "u1",
        "session_id": "s1",
        "new_message": {"role": "user", "parts": [{"text": "請查證這則訊息"}]},
    },
    ensure_ascii=False,
)

FINAL_EVENT_OUTPUT = json.dumps(
    {
        "content": {"role": "model", "parts": [{"text": "查證結果如下"}]},
        "author": "writer",
        "id": "ev-1",
    },
    ensure_ascii=False,
)


class SnapshotExporter(SpanExporter):
    """Copies attributes at export() time, like OTLP serialization does.

    InMemorySpanExporter holds the span by reference, so a mutation AFTER
    export would still be visible when a test reads the attributes back. The
    snapshot makes every test genuinely sensitive to processor order.
    """

    def __init__(self) -> None:
        self.snapshots: list[dict] = []

    def export(self, spans) -> SpanExportResult:
        self.snapshots.extend(dict(span.attributes or {}) for span in spans)
        return SpanExportResult.SUCCESS


def run_span(attributes: dict, reorder: bool = True) -> Mapping[str, Any]:
    """Ends one span carrying `attributes`; returns attributes as exported.

    Replicates production registration order: the exporting processor is
    registered first (Langfuse's is added inside get_client(), before ours),
    then the rewrite processor, then _move_processor_first. SimpleSpanProcessor
    exports synchronously at on_end, so with reorder=False the export
    deterministically happens before the rewrite.
    """
    provider = TracerProvider()
    exporter = SnapshotExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    processor = TextExtractionSpanProcessor()
    provider.add_span_processor(processor)
    if reorder:
        _move_processor_first(provider, processor)
    tracer = provider.get_tracer("test")
    with tracer.start_as_current_span("span", attributes=attributes):
        pass
    (snapshot,) = exporter.snapshots
    return snapshot


class TestTextExtractionSpanProcessor:
    def test_input_value_rewritten_to_plain_text(self):
        attrs = run_span(
            {"input.value": INVOCATION_INPUT, "input.mime_type": JSON_MIME}
        )
        assert attrs["input.value"] == "請查證這則訊息"
        assert attrs["input.mime_type"] == "text/plain"

    def test_output_value_rewritten_from_final_event(self):
        attrs = run_span(
            {"output.value": FINAL_EVENT_OUTPUT, "output.mime_type": JSON_MIME}
        )
        assert attrs["output.value"] == "查證結果如下"
        assert attrs["output.mime_type"] == "text/plain"

    def test_non_json_value_untouched(self):
        attrs = run_span({"input.value": "not json", "input.mime_type": JSON_MIME})
        assert attrs["input.value"] == "not json"
        assert attrs["input.mime_type"] == JSON_MIME

    def test_json_without_parts_untouched(self):
        payload = json.dumps({"error": "timeout", "message": "tool failed"})
        attrs = run_span({"output.value": payload, "output.mime_type": JSON_MIME})
        assert attrs["output.value"] == payload
        assert attrs["output.mime_type"] == JSON_MIME

    def test_span_without_input_output_is_ignored(self):
        attrs = run_span({"session.id": "s1"})
        assert attrs["session.id"] == "s1"

    def test_mutation_failure_does_not_raise(self):
        # A future SDK could hand on_end a read-only mapping; the rewrite must
        # log and swallow the failure, never break span end.
        span = SimpleNamespace(
            _attributes=MappingProxyType(
                {"input.value": INVOCATION_INPUT, "input.mime_type": JSON_MIME}
            )
        )
        TextExtractionSpanProcessor().on_end(span)
        assert span._attributes["input.value"] == INVOCATION_INPUT


class TestMoveProcessorFirst:
    def test_without_reorder_export_wins_the_race(self):
        # Documents why the reorder exists: with the production registration
        # order and a synchronous exporter, export runs before the rewrite.
        attrs = run_span(
            {"input.value": INVOCATION_INPUT, "input.mime_type": JSON_MIME},
            reorder=False,
        )
        assert attrs["input.value"] == INVOCATION_INPUT

    def test_reorder_makes_rewrite_run_before_export(self):
        attrs = run_span(
            {"input.value": INVOCATION_INPUT, "input.mime_type": JSON_MIME},
            reorder=True,
        )
        assert attrs["input.value"] == "請查證這則訊息"

    def test_unexpected_provider_internals_do_not_raise(self):
        # If the SDK renames its private fields or makes them read-only, the
        # reorder logs and degrades to the unreordered behavior instead of
        # failing setup. Covers both the missing-field and the frozen-setter
        # paths.
        processor = TextExtractionSpanProcessor()

        missing_fields = cast(TracerProvider, SimpleNamespace())
        _move_processor_first(missing_fields, processor)

        class FrozenMulti:
            @property
            def _span_processors(self):
                return (processor,)

        frozen = cast(
            TracerProvider, SimpleNamespace(_active_span_processor=FrozenMulti())
        )
        _move_processor_first(frozen, processor)
        assert frozen._active_span_processor._span_processors == (processor,)


class TestPartsText:
    def test_joins_multiple_text_parts(self):
        data = {"content": {"parts": [{"text": "第一段"}, {"text": "第二段"}]}}
        assert _parts_text(data) == "第一段\n第二段"

    def test_skips_thought_parts(self):
        data = {
            "content": {
                "parts": [{"text": "內部思考", "thought": True}, {"text": "回覆"}]
            }
        }
        assert _parts_text(data) == "回覆"

    def test_image_only_parts_yield_none(self):
        data = {
            "new_message": {
                "parts": [{"inline_data": {"mime_type": "image/webp", "data": "…"}}]
            }
        }
        assert _parts_text(data) is None

    def test_prefers_new_message_over_missing_content(self):
        data = {"new_message": {"parts": [{"text": "使用者輸入"}]}}
        assert _parts_text(data) == "使用者輸入"
