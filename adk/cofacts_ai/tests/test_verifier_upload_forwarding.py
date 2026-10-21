"""A chat upload reaches the verifier through a real AgentTool call.

`inject_cofacts_media_filedata` attaches an upload only if its gs:// URI is the
canonical URI of an artifact it can look up — and it looks up through the
verifier's own callback context. That works only because AgentTool gives the
child runner ADK's ForwardingArtifactService, which answers for the *calling*
(writer) session rather than the child's fresh one. This test runs the real
chain offline to prove it: an upload saved by SaveFilesAsArtifactsPlugin, the
writer's text placeholder from `prepare_writer_request`, the URI forwarded in an
AgentTool `request`, and the real `ai_verifier` (fake model) receiving FileData.

InMemoryArtifactService reports memory:// canonical URIs, so
`GcsLikeArtifactService` rewrites them into GcsArtifactService's
`gs://<bucket>/<app>/<user>/<session>/<filename>/<version>` form from the ids
each lookup is made with — the session id in the URI is the session the lookup
was actually answered for.
"""

import re
from typing import Any, AsyncGenerator, Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.llm_agent import LlmAgent
from google.adk.apps.app import App
from google.adk.artifacts.base_artifact_service import ArtifactVersion
from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.plugins.save_files_as_artifacts_plugin import (
    SaveFilesAsArtifactsPlugin,
)
from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.adk.tools.agent_tool import AgentTool
from google.genai import types

from cofacts_ai.agent import AI_VERIFIER_NAME, ai_verifier
from cofacts_ai.writer_request import prepare_writer_request

BUCKET = "cofacts-ai-artifacts"
APP = "cofacts_ai"
USER = "user-1"
UPLOAD_NAME = "user-upload-Pasted image 1.png"


class GcsLikeArtifactService(InMemoryArtifactService):
    """InMemoryArtifactService reporting GcsArtifactService-style gs:// URIs."""

    lookups: list[Optional[str]] = []

    def _gcs(
        self, info: ArtifactVersion, user_id: str, session_id: Optional[str], name: str
    ) -> ArtifactVersion:
        info.canonical_uri = (
            f"gs://{BUCKET}/{APP}/{user_id}/{session_id}/{name}/{info.version}"
        )
        return info

    async def list_artifact_keys(self, *, app_name, user_id, session_id=None):
        self.lookups.append(session_id)
        return await super().list_artifact_keys(
            app_name=app_name, user_id=user_id, session_id=session_id
        )

    async def get_artifact_version(
        self, *, app_name, user_id, filename, session_id=None, version=None
    ):
        self.lookups.append(session_id)
        info = await super().get_artifact_version(
            app_name=app_name,
            user_id=user_id,
            filename=filename,
            session_id=session_id,
            version=version,
        )
        return info and self._gcs(info, user_id, session_id, filename)


def text_of(request: LlmRequest) -> str:
    return "\n".join(p.text for c in request.contents for p in c.parts or [] if p.text)


class FakeWriter(BaseLlm):
    """Forwards the upload URI from its placeholder to the verifier, then ends."""

    other_uris: list[str] = []

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        last = llm_request.contents[-1].parts or []
        if any(p.function_response for p in last):
            yield LlmResponse(content=types.ModelContent("done"))
            return
        # prepare_writer_request's placeholder for the uploaded image.
        match = re.search(
            r" at (gs://.+?); you cannot view it\.\]", text_of(llm_request)
        )
        assert match, text_of(llm_request)
        others = " ".join(self.other_uris)
        call = types.FunctionCall(
            name=AI_VERIFIER_NAME,
            args={"request": f"請描述這張圖：{match.group(1)}。不要看 {others}"},
        )
        yield LlmResponse(content=types.ModelContent([types.Part(function_call=call)]))


class RecordingVerifier(BaseLlm):
    requests: list[LlmRequest] = []

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        self.requests.append(llm_request.model_copy(deep=True))
        yield LlmResponse(content=types.ModelContent("an image"))


async def test_verifier_attaches_the_calling_sessions_upload():
    verifier_sessions: list[str] = []

    def record_session(callback_context: CallbackContext, llm_request: Any) -> None:
        verifier_sessions.append(callback_context.session.id)

    verifier_model = RecordingVerifier(model="gemini-3-flash-preview", requests=[])
    callbacks = ai_verifier.before_model_callback
    assert isinstance(callbacks, list)
    verifier = ai_verifier.model_copy(
        update={
            "model": verifier_model,
            "before_model_callback": [*callbacks, record_session],
        }
    )
    other_uris = [
        # Same upload name in another session of the same user.
        f"gs://{BUCKET}/{APP}/{USER}/other-session/{UPLOAD_NAME}/0",
        # Another bucket.
        f"gs://cofacts-db-backup/{APP}/{USER}/x/{UPLOAD_NAME}/0",
    ]
    writer = LlmAgent(
        name="writer",
        model=FakeWriter(model="fake-writer", other_uris=other_uris),
        before_model_callback=prepare_writer_request,
        tools=[AgentTool(agent=verifier)],
    )
    artifacts = GcsLikeArtifactService(lookups=[])
    runner = Runner(
        app=App(name=APP, root_agent=writer, plugins=[SaveFilesAsArtifactsPlugin()]),
        session_service=InMemorySessionService(),
        artifact_service=artifacts,
    )
    session = await runner.session_service.create_session(app_name=APP, user_id=USER)
    # The other session really holds an upload of the same name: it must
    # still not be attached, because the lookup is scoped to the caller.
    await artifacts.save_artifact(
        app_name=APP,
        user_id=USER,
        session_id="other-session",
        filename=UPLOAD_NAME,
        artifact=types.Part.from_bytes(data=b"other", mime_type="image/png"),
    )

    upload = types.Part(
        inline_data=types.Blob(
            data=b"\x89PNG", mime_type="image/png", display_name=UPLOAD_NAME
        )
    )
    async for _ in runner.run_async(
        user_id=USER,
        session_id=session.id,
        new_message=types.UserContent([types.Part(text="這是真的嗎？"), upload]),
    ):
        pass

    upload_uri = f"gs://{BUCKET}/{APP}/{USER}/{session.id}/{UPLOAD_NAME}/0"
    [request] = verifier_model.requests
    assert upload_uri in text_of(request)
    assert all(uri in text_of(request) for uri in other_uris)
    file_data = [
        (p.file_data.file_uri, p.file_data.mime_type)
        for c in request.contents
        for p in c.parts or []
        if p.file_data
    ]
    assert file_data == [(upload_uri, "image/png")]

    # The verifier ran in its own child session, yet every artifact lookup —
    # including the callback's — was answered for the writer's session.
    [verifier_session] = verifier_sessions
    assert verifier_session != session.id
    assert set(artifacts.lookups) == {session.id}
