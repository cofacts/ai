"""Unit tests for `inject_youtube_filedata`.

The before-model callback appends a FileData part so Gemini can watch a
YouTube video found in user messages. Two Vertex AI constraints drive the
regression tests here: fileData with an empty mimeType is rejected
(400 INVALID_ARGUMENT), and only one YouTube URL is supported per request —
so at most one FileData is injected and a [SYSTEM] notice lists any URLs
that were not loaded.
"""

from typing import cast

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

from cofacts_ai.agent import inject_youtube_filedata


def make_request(*contents: genai_types.Content) -> LlmRequest:
    return LlmRequest(contents=list(contents))


def user_text(text: str) -> genai_types.Content:
    return genai_types.Content(role="user", parts=[genai_types.Part(text=text)])


def file_data_parts(content: genai_types.Content) -> list[genai_types.FileData]:
    return [part.file_data for part in content.parts or [] if part.file_data]


def system_notices(content: genai_types.Content) -> list[str]:
    return [
        part.text
        for part in content.parts or []
        if part.text and part.text.startswith("[SYSTEM]")
    ]


class TestInjectYoutubeFiledata:
    def test_shorts_url_appends_filedata_with_mime_type(self):
        url = "https://youtube.com/shorts/uLOZXNhN4sY?si=lWk1QGHkASEvVXlo"
        request = make_request(user_text(f"請查核 {url} 這則影片"))

        inject_youtube_filedata(cast(CallbackContext, None), request)

        [file_data] = file_data_parts(request.contents[0])
        assert file_data.file_uri == url
        assert file_data.mime_type == "video/webm"

    def test_single_url_adds_no_system_notice(self):
        request = make_request(user_text("https://youtu.be/abc123"))

        inject_youtube_filedata(cast(CallbackContext, None), request)

        assert len(file_data_parts(request.contents[0])) == 1
        assert system_notices(request.contents[0]) == []

    def test_multiple_urls_in_one_message_injects_first_and_notes_rest(self):
        request = make_request(
            user_text(
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ "
                "and https://youtu.be/abc123"
            )
        )

        inject_youtube_filedata(cast(CallbackContext, None), request)

        [file_data] = file_data_parts(request.contents[0])
        assert file_data.file_uri == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        [notice] = system_notices(request.contents[0])
        assert "https://youtu.be/abc123" in notice

    def test_urls_across_messages_injects_latest_and_notes_earlier(self):
        request = make_request(
            user_text("https://youtu.be/earlier"),
            user_text("https://youtu.be/latest"),
        )

        inject_youtube_filedata(cast(CallbackContext, None), request)

        assert file_data_parts(request.contents[0]) == []
        [file_data] = file_data_parts(request.contents[1])
        assert file_data.file_uri == "https://youtu.be/latest"
        [notice] = system_notices(request.contents[1])
        assert "https://youtu.be/earlier" in notice
        assert "https://youtu.be/latest" in notice

    def test_duplicate_urls_injected_once_on_latest_message(self):
        url = "https://youtube.com/shorts/uLOZXNhN4sY"
        request = make_request(user_text(url), user_text(url))

        inject_youtube_filedata(cast(CallbackContext, None), request)

        assert file_data_parts(request.contents[0]) == []
        [file_data] = file_data_parts(request.contents[1])
        assert file_data.file_uri == url
        assert system_notices(request.contents[1]) == []

    def test_model_role_content_is_ignored(self):
        request = make_request(
            genai_types.Content(
                role="model",
                parts=[genai_types.Part(text="https://youtu.be/abc123")],
            )
        )

        inject_youtube_filedata(cast(CallbackContext, None), request)

        assert file_data_parts(request.contents[0]) == []

    def test_text_without_youtube_url_is_untouched(self):
        request = make_request(user_text("https://cofacts.tw/article/1xspprmokh0z6"))

        inject_youtube_filedata(cast(CallbackContext, None), request)

        assert file_data_parts(request.contents[0]) == []
        assert len(request.contents[0].parts) == 1
