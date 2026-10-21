"""Unit tests for `inject_cofacts_media_filedata`, ai_verifier's before-model callback.

It turns media URIs the writer forwards in plain text into FileData parts so
Gemini perceives the media instead of guessing. Besides Cofacts media, it
attaches chat uploads — but only a URI that is the canonical URI of one of the
calling session's own `user-upload-` artifacts, as the artifact service reports
it. Any other gs:// string stays text.

`test_verifier_round_trip.py` pins the basic case end to end, through a real
AgentTool: an upload with spaces in its name, forwarded by its gs:// URI, is
attached with its stored mime type, next to Cofacts media, while the same name
in another chat session and the same path in another bucket are not. The tests
here cover what that one request does not construct.
"""

from typing import Optional, cast

from google.adk.agents.callback_context import CallbackContext
from google.adk.artifacts.base_artifact_service import ArtifactVersion
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

from cofacts_ai.media_filedata import inject_cofacts_media_filedata

SESSION_PREFIX = "gs://cofacts-ai-artifacts/cofacts_ai/user-1/session-1"
UPLOAD_NAME = "user-upload-Pasted image 1.png"
UPLOAD_URI = f"{SESSION_PREFIX}/{UPLOAD_NAME}/0"


def version(name: str, number: int, mime_type: Optional[str]) -> ArtifactVersion:
    return ArtifactVersion(
        version=number,
        canonical_uri=f"{SESSION_PREFIX}/{name}/{number}",
        mime_type=mime_type,
    )


class FakeArtifactContext:
    """The two Context artifact methods the callback uses, over a fixed session."""

    def __init__(self, *versions: ArtifactVersion, error: Optional[Exception] = None):
        self.artifacts: dict[str, list[ArtifactVersion]] = {}
        for v in versions:
            name = v.canonical_uri.rsplit("/", 2)[-2]
            self.artifacts.setdefault(name, []).append(v)
        self.error = error
        self.calls: list[tuple[str, ...]] = []

    async def list_artifacts(self) -> list[str]:
        self.calls.append(("list_artifacts",))
        if self.error:
            raise self.error
        return list(self.artifacts)

    async def get_artifact_version(
        self, filename: str, version: Optional[int] = None
    ) -> Optional[ArtifactVersion]:
        self.calls.append(("get_artifact_version", filename, str(version)))
        versions = self.artifacts.get(filename) or []
        if version is None:
            return versions[-1] if versions else None
        return versions[version] if 0 <= version < len(versions) else None


def png_upload() -> FakeArtifactContext:
    return FakeArtifactContext(version(UPLOAD_NAME, 0, "image/png"))


async def run(
    text: str, ctx: Optional[FakeArtifactContext] = None
) -> list[genai_types.FileData]:
    content = genai_types.Content(role="user", parts=[genai_types.Part(text=text)])
    await inject_cofacts_media_filedata(
        cast(CallbackContext, ctx or png_upload()), LlmRequest(contents=[content])
    )
    return [part.file_data for part in content.parts or [] if part.file_data]


async def test_mime_type_comes_from_the_artifact_not_the_name():
    # An extension-less paste still gets the MIME type it was uploaded with.
    ctx = FakeArtifactContext(version("user-upload-clip", 0, "video/mp4"))
    [file_data] = await run(f"watch {SESSION_PREFIX}/user-upload-clip/0", ctx)
    assert file_data.mime_type == "video/mp4"


async def test_uri_not_in_session_is_ignored():
    texts = [
        # Same name, another session of the same user.
        f"gs://cofacts-ai-artifacts/cofacts_ai/user-1/session-2/{UPLOAD_NAME}/0",
        # Same path, another bucket.
        f"gs://cofacts-db-backup/cofacts_ai/user-1/session-1/{UPLOAD_NAME}/0",
        # A version this session does not have.
        f"{SESSION_PREFIX}/{UPLOAD_NAME}/1",
    ]
    for text in texts:
        assert await run(text) == [], text


async def test_non_media_upload_is_skipped():
    ctx = FakeArtifactContext(
        version("user-upload-notes.txt", 0, "text/plain"),
        version("user-upload-data.json", 0, "application/json"),
        version("user-upload-unknown", 0, None),
    )
    text = " ".join(
        f"{SESSION_PREFIX}/{name}/0"
        for name in [
            "user-upload-notes.txt",
            "user-upload-data.json",
            "user-upload-unknown",
        ]
    )
    assert await run(text, ctx) == []


async def test_artifact_without_upload_prefix_is_skipped():
    ctx = FakeArtifactContext(version("draft.png", 0, "image/png"))
    assert await run(f"{SESSION_PREFIX}/draft.png/0", ctx) == []
    assert ("get_artifact_version", "draft.png", "None") not in ctx.calls


async def test_no_lookups_for_uploads_the_text_does_not_name():
    ctx = FakeArtifactContext(
        version(UPLOAD_NAME, 0, "image/png"),
        version("user-upload-b.png", 0, "image/png"),
    )
    # No gs:// URI at all: not even a listing.
    assert await run(f"請描述 {UPLOAD_NAME}", ctx) == []
    assert ctx.calls == []
    # One upload named: no version lookups for the other.
    await run(UPLOAD_URI, ctx)
    assert [c for c in ctx.calls if "user-upload-b.png" in c] == []


async def test_older_version_matches_and_version_prefix_does_not():
    ctx = FakeArtifactContext(
        *[version(UPLOAD_NAME, n, "image/png") for n in range(11)]
    )
    files = await run(
        f"{SESSION_PREFIX}/{UPLOAD_NAME}/0 and /10: {SESSION_PREFIX}/{UPLOAD_NAME}/10",
        ctx,
    )
    assert [f.file_uri for f in files] == [
        f"{SESSION_PREFIX}/{UPLOAD_NAME}/0",
        f"{SESSION_PREFIX}/{UPLOAD_NAME}/10",
    ]


async def test_upload_is_attached_once():
    # Named twice.
    assert len(await run(f"{UPLOAD_URI} and again {UPLOAD_URI}")) == 1
    # Already attached, e.g. by an earlier callback.
    content = genai_types.Content(
        role="user",
        parts=[
            genai_types.Part(text=UPLOAD_URI),
            genai_types.Part(
                file_data=genai_types.FileData(
                    file_uri=UPLOAD_URI, mime_type="image/png"
                )
            ),
        ],
    )
    await inject_cofacts_media_filedata(
        cast(CallbackContext, png_upload()), LlmRequest(contents=[content])
    )
    assert len([p for p in content.parts or [] if p.file_data]) == 1


async def test_lookup_failure_skips_uploads_but_keeps_cofacts_media():
    # E.g. no artifact service: Context raises ValueError.
    ctx = FakeArtifactContext(error=ValueError("Artifact service is not initialized."))
    files = await run(
        f"gs://cofacts-media-collection/production/image/abc/original and {UPLOAD_URI}",
        ctx,
    )
    assert [f.file_uri for f in files] == [
        "gs://cofacts-media-collection/production/image/abc/original"
    ]
