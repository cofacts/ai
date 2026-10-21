"""Unit tests for `inject_cofacts_media_filedata`, ai_verifier's before-model callback.

It turns media URIs the writer forwards in plain text into FileData parts so
Gemini perceives the media instead of guessing. Besides Cofacts media, it
accepts chat uploads — but only in `GCS_ARTIFACT_BUCKET`: the Vertex AI service
agent can read every bucket in the project, so any other gs:// URI must stay
text.
"""

from typing import cast

import pytest
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

from cofacts_ai.media_filedata import inject_cofacts_media_filedata

BUCKET = "cofacts-ai-artifacts"
UPLOAD_URI = (
    "gs://cofacts-ai-artifacts/cofacts_ai/user-1/session-1/"
    "user-upload-Pasted image 1.png/0"
)


@pytest.fixture(autouse=True)
def artifact_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GCS_ARTIFACT_BUCKET", BUCKET)


def run(text: str) -> list[genai_types.FileData]:
    content = genai_types.Content(role="user", parts=[genai_types.Part(text=text)])
    inject_cofacts_media_filedata(
        cast(CallbackContext, None), LlmRequest(contents=[content])
    )
    return [part.file_data for part in content.parts or [] if part.file_data]


def test_writer_placeholder_upload_with_spaces_is_attached():
    # The text ai_writer sees for a pasted image, forwarded to the verifier.
    [file_data] = run(
        f'請描述這張圖 [Attached media "user-upload-Pasted image 1.png" (image/png) '
        f"at {UPLOAD_URI}; you cannot view it.]"
    )
    assert file_data.file_uri == UPLOAD_URI
    assert file_data.mime_type == "image/png"


@pytest.mark.parametrize(
    "text",
    [
        UPLOAD_URI,
        f"see {UPLOAD_URI}.",
        f"see `{UPLOAD_URI}` please",
        f"({UPLOAD_URI})",
        f"請看{UPLOAD_URI}，謝謝",
        f"{UPLOAD_URI}\nnext line",
    ],
)
def test_upload_uri_ends_at_version(text: str):
    [file_data] = run(text)
    assert file_data.file_uri == UPLOAD_URI


def test_digit_filename_is_not_cut_at_its_first_segment():
    uri = f"gs://{BUCKET}/cofacts_ai/u/s/2024.pdf/3"
    [file_data] = run(f"check {uri}")
    assert file_data.file_uri == uri
    assert file_data.mime_type == "application/pdf"


def test_mime_type_follows_filename():
    uri = f"gs://{BUCKET}/cofacts_ai/u/s/user-upload-clip.mp4/1"
    [file_data] = run(uri)
    assert file_data.mime_type == "video/mp4"


def test_non_media_upload_is_skipped():
    assert run(f"gs://{BUCKET}/cofacts_ai/u/s/user-upload-notes.txt/0") == []


def test_other_bucket_is_ignored():
    assert run("gs://cofacts-db-backup/cofacts_ai/u/s/dump.png/0") == []


def test_bucket_name_prefix_does_not_match_other_bucket():
    assert run(f"gs://{BUCKET}-backup/cofacts_ai/u/s/a.png/0") == []


def test_https_form_of_artifact_bucket_is_ignored():
    assert run(f"https://storage.googleapis.com/{BUCKET}/cofacts_ai/u/s/a.png/0") == []


def test_unset_bucket_ignores_uploads(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("GCS_ARTIFACT_BUCKET")
    assert run(UPLOAD_URI) == []


@pytest.mark.parametrize("dots", ["..", "%2e%2e", "%2E."])
def test_dot_dot_segment_is_rejected(dots: str):
    assert run(f"gs://{BUCKET}/cofacts_ai/{dots}/other/a.png/0") == []


def test_repeated_upload_is_attached_once():
    assert len(run(f"{UPLOAD_URI} and again {UPLOAD_URI}")) == 1


def test_upload_already_attached_is_not_duplicated():
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
    inject_cofacts_media_filedata(
        cast(CallbackContext, None), LlmRequest(contents=[content])
    )
    assert len([p for p in content.parts or [] if p.file_data]) == 1


def test_cofacts_media_collection_is_unchanged():
    [file_data] = run(
        "watch gs://cofacts-media-collection/production/video/abc/original."
    )
    assert file_data.file_uri == (
        "gs://cofacts-media-collection/production/video/abc/original"
    )
    assert file_data.mime_type == "video/mp4"


def test_cofacts_media_and_upload_in_one_request():
    files = run(
        f"gs://cofacts-media-collection/production/image/abc/original and {UPLOAD_URI}"
    )
    assert [(f.file_uri, f.mime_type) for f in files] == [
        ("gs://cofacts-media-collection/production/image/abc/original", "image/webp"),
        (UPLOAD_URI, "image/png"),
    ]
