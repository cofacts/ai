"""
Cofacts media utilities for Gemini on Vertex AI.

Converts Cofacts article media URLs (signed GCS HTTPS) to ``gs://`` URIs and
injects them as ``FileData`` parts so Gemini can perceive the media directly.
On Vertex AI ``file_data.file_uri`` accepts ``gs://`` URIs natively (and HTTP
URLs are capped at ~15MB, which our media exceeds), so we hand Gemini the
``gs://`` form and let the runtime service account read the bucket — no signed
URLs and no on-demand re-signing required.

Chat uploads are injected the same way: the writer forwards the ``gs://`` URI
ADK gave a pasted file in ``GCS_ARTIFACT_BUCKET``. Only that bucket is
accepted — the Vertex AI service agent can read every bucket in the project,
so any other ``gs://`` URI in the text must not become FileData.
"""

import logging
import mimetypes
import os
import re
from typing import Optional
from urllib.parse import unquote, urlparse

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

_ARTICLE_TYPE_MIME = {
    "IMAGE": "image/webp",
    "VIDEO": "video/mp4",
    "AUDIO": "audio/mpeg",
}

# Matches a Cofacts media reference in free text — a gs:// URI or a GCS HTTPS
# URL (signed or not) for the cofacts-media-collection bucket. Used to spot the
# media URL the writer forwards to the verifier in a plain-text instruction.
_COFACTS_MEDIA_URL_RE = re.compile(
    r"gs://cofacts-media-collection/[^\s\"'<>]+"
    r"|https?://(?:storage\.googleapis\.com/cofacts-media-collection"
    r"|cofacts-media-collection\.storage\.googleapis\.com)/[^\s\"'<>]+"
)

# Punctuation that commonly trails a URL in prose (sentence end, wrapping
# parens/quotes) and is not part of the URL itself. Stripped from matches —
# a gs:// path has no query string to absorb a stray char.
_URL_TRAILING_PUNCT = ".,;:!?)]}>\"'"

# MIME types Gemini can perceive as FileData; uploads of any other type are skipped.
_UPLOAD_MIME_PREFIXES = ("image/", "video/", "audio/", "application/pdf")


def _artifact_uri_re(bucket: str) -> re.Pattern[str]:
    """Matches an ADK artifact URI ``gs://<bucket>/.../<filename>/<version>``.

    Upload names contain spaces (``user-upload-Pasted image 1.png``), so the
    match runs non-greedily up to the first ``/<digits>`` that ends the URI:
    followed by whitespace, end of text or CJK punctuation, optionally after
    ASCII punctuation (``/0;``, ``/0).``). ``/2024.png/0`` does not end at
    ``/2024`` because ``.`` is not followed by one of those.
    """
    return re.compile(
        rf"gs://{re.escape(bucket)}/(?:[^\s\"'<>`]| )+?/\d+"
        r"(?=[.,;:!?)\]}>*`\"']*(?:\s|$|[\u3000-\u303f\uff00-\uffef]))"
    )


def _upload_mime_type(gs_uri: str) -> Optional[str]:
    """Guess an upload's MIME type from its filename, the segment before
    ``/<version>``; None if Gemini cannot perceive that type."""
    mime_type, _ = mimetypes.guess_type(gs_uri.rsplit("/", 2)[-2])
    if mime_type and mime_type.startswith(_UPLOAD_MIME_PREFIXES):
        return mime_type
    return None


def _parse_gcs_https_url(url: str) -> Optional[tuple[str, str]]:
    """Return (bucket, blob) from a GCS HTTPS URL, or None if unrecognized.

    Handles both path-style (storage.googleapis.com/<bucket>/<object>) and
    virtual-hosted style (<bucket>.storage.googleapis.com/<object>). The query
    string (e.g. a V4 signature) is ignored, so signed URLs convert cleanly.
    """
    parsed = urlparse(url)
    host = parsed.hostname or ""
    path = unquote(parsed.path).lstrip("/")
    if host == "storage.googleapis.com":
        bucket, _, blob = path.partition("/")
        return (bucket, blob) if bucket and blob else None
    if host.endswith(".storage.googleapis.com"):
        bucket = host[: -len(".storage.googleapis.com")]
        return (bucket, path) if bucket and path else None
    return None


def signed_url_to_gs(url: str) -> Optional[str]:
    """Convert a GCS HTTPS URL (signed or not) to a ``gs://`` URI.

    Returns None if the URL is not a recognized GCS HTTPS URL — including when it
    is already a ``gs://`` URI — so callers can fall back to the original value.
    """
    parsed = _parse_gcs_https_url(url)
    if not parsed:
        return None
    bucket, blob = parsed
    return f"gs://{bucket}/{blob}"


def _mime_for_media_uri(uri: str) -> str:
    """Infer a coarse MIME type from a Cofacts media path (.../video|image|audio/...).

    Cofacts objects live under a type segment, e.g.
    gs://cofacts-media-collection/production/video/<id>/original. The verifier
    only sees the URL (not the articleType), so we read the type from the path
    and default to video when it cannot be determined.
    """
    path = urlparse(uri).path.lower()
    if "/image/" in path:
        return _ARTICLE_TYPE_MIME["IMAGE"]
    if "/audio/" in path:
        return _ARTICLE_TYPE_MIME["AUDIO"]
    return _ARTICLE_TYPE_MIME["VIDEO"]


def inject_cofacts_media_filedata(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    """Before-model callback for ai_verifier.

    The writer delegates media-watching by passing the verifier a Cofacts media
    URL in a plain-text instruction. url_context cannot read a raw storage object,
    so without this the verifier never actually sees the media. Here we detect the
    Cofacts media URL in the message text and append it as a ``gs://`` FileData
    Part so Gemini (on Vertex) can watch/inspect it directly — mirroring
    inject_youtube_filedata for YouTube URLs. A chat upload's ``gs://`` URI in
    ``GCS_ARTIFACT_BUCKET`` is attached the same way.
    """
    try:
        # Seed with media already attached anywhere in the request so we never
        # inject a duplicate FileData for the same object.
        seen = {
            p.file_data.file_uri
            for content in llm_request.contents
            for p in content.parts or []
            if p.file_data and p.file_data.file_uri
        }
        bucket = os.environ.get("GCS_ARTIFACT_BUCKET")
        upload_re = _artifact_uri_re(bucket) if bucket else None
        for content in llm_request.contents:
            if content.role != "user" or not content.parts:
                continue
            urls = []
            uploads = []
            for part in content.parts:
                if part.text:
                    urls.extend(_COFACTS_MEDIA_URL_RE.findall(part.text))
                    if upload_re:
                        uploads.extend(upload_re.findall(part.text))
            for url in urls:
                url = url.rstrip(_URL_TRAILING_PUNCT)
                gs_uri = url if url.startswith("gs://") else signed_url_to_gs(url)
                if not gs_uri or gs_uri in seen:
                    continue
                seen.add(gs_uri)
                content.parts.append(
                    genai_types.Part(
                        file_data=genai_types.FileData(
                            file_uri=gs_uri,
                            mime_type=_mime_for_media_uri(gs_uri),
                        )
                    )
                )
            for gs_uri in uploads:
                mime_type = _upload_mime_type(gs_uri)
                if (
                    not mime_type
                    or gs_uri in seen
                    or ".." in unquote(gs_uri).split("/")
                ):
                    continue
                seen.add(gs_uri)
                content.parts.append(
                    genai_types.Part(
                        file_data=genai_types.FileData(
                            file_uri=gs_uri, mime_type=mime_type
                        )
                    )
                )
    except Exception:
        logger.exception(
            "inject_cofacts_media_filedata failed; skipping media injection"
        )
    return None
