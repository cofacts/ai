from collections.abc import AsyncGenerator

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types
from pydantic import Field

from cofacts_ai import agent as production
from cofacts_eval.runtime import generate


class ScriptedModel(BaseLlm):
    model: str = "scripted-test-model"
    responses: list[LlmResponse]
    requests: list[LlmRequest] = Field(default_factory=list)

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request.model_copy(deep=True))
        yield self.responses.pop(0)


def response(*parts):
    return LlmResponse(content=types.Content(role="model", parts=list(parts)))


def call(name, args):
    return types.Part(function_call=types.FunctionCall(name=name, args=args))


async def test_writer_uses_production_validation_and_last_accepted_draft(
    monkeypatch, writer_case
):
    good = writer_case.recorded_draft
    bad = {**good, "classification": "INVALID"}
    model = ScriptedModel(
        responses=[
            response(call("draft_factcheck_response", bad)),
            response(call("draft_factcheck_response", good)),
            response(types.Part(text="已完成")),
        ]
    )
    original_tools = production.ai_writer.tools
    monkeypatch.setattr(production.ai_writer, "model", model)
    result = await generate(writer_case)
    assert result.error is None
    assert result.draft == good and result.output == "已完成"
    assert len(model.requests) == 3
    assert set(model.requests[0].tools_dict) == {"draft_factcheck_response"}
    assert "Invalid classification" in model.requests[1].model_dump_json()
    assert production.ai_writer.tools is original_tools
    assert production.ai_writer.after_agent_callback is not None
    assert result.instruction_sha256


async def test_verifier_reads_frozen_source_without_reference_answer(
    monkeypatch, verifier_case
):
    verifier_case.recorded_output = "DO_NOT_LEAK_REFERENCE_ANSWER"
    model = ScriptedModel(
        responses=[
            response(
                call("read_captured_source", {"url": "https://example.org/source"})
            ),
            response(types.Part(text="共 12 件，來源支持。")),
        ]
    )
    monkeypatch.setattr(production.ai_verifier, "model", model)
    result = await generate(verifier_case)
    assert result.error is None and "12" in result.output
    assert set(model.requests[0].tools_dict) == {"read_captured_source"}
    assert "範例館藏共 12 件。" in model.requests[1].model_dump_json()
    assert "DO_NOT_LEAK_REFERENCE_ANSWER" not in model.requests[0].model_dump_json()


async def test_runtime_failure_is_explicit_without_provider_details(
    monkeypatch, verifier_case
):
    model = ScriptedModel(
        responses=[
            LlmResponse(
                error_code="TEST_ERROR", error_message="private provider details"
            )
        ]
    )
    monkeypatch.setattr(production.ai_verifier, "model", model)
    result = await generate(verifier_case)
    assert result.error and "RuntimeError" in result.error
    assert "private provider details" not in result.model_dump_json()


async def test_missing_gemini_configuration_fails_before_client_creation(
    monkeypatch, verifier_case
):
    for name in ("GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    result = await generate(verifier_case)
    assert result.error and "Gemini configuration missing" in result.error
    assert result.output == ""
