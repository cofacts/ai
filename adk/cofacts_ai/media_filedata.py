"""
Cofacts media utilities for Gemini on Vertex AI.

Converts Cofacts article media URLs (signed GCS HTTPS) to ``gs://`` URIs and
injects them as ``FileData`` parts so Gemini can perceive the media directly.
On Vertex AI ``file_data.file_uri`` accepts ``gs://`` URIs natively (and HTTP
URLs are capped at ~15MB, which our media exceeds), so we hand Gemini the
``gs://`` form and let the runtime service account read the bucket — no signed
URLs and no on-demand re-signing required.

Chat uploads are injected too: the writer forwards the ``gs://`` URI ADK gave a
pasted file, and the verifier attaches it only if it is the canonical URI of an
upload in the calling chat session (looked up through the artifact service).
"""

import logging
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

# Artifact-name prefix the frontend gives chat uploads (UPLOAD_FILENAME_PREFIX
# in src/lib/adk.ts); no other artifact of the session is ever attached.
_UPLOAD_ARTIFACT_PREFIX = "user-upload-"

# MIME types Gemini can perceive as FileData; uploads of any other type are skipped.
_UPLOAD_MIME_PREFIXES = ("image/", "video/", "audio/", "application/pdf")


def _mentions(text: str, uri: str) -> bool:
    """Whether ``text`` contains ``uri`` verbatim, not as the start of a longer
    version number (``.../a.png/1`` must not match ``.../a.png/10``)."""
    return re.search(re.escape(uri) + r"(?!\d)", text) is not None


async def _session_uploads(
    callback_context: CallbackContext, texts: list[str]
) -> list[tuple[str, str]]:
    """``(canonical_uri, mime_type)`` of every version of the calling session's
    media uploads whose name appears in ``texts``.

    Under AgentTool the verifier runs with ADK's ForwardingArtifactService,
    which answers these lookups for the calling (writer) session, so this is the
    chat's own uploads. Attachment is scoped to them: a ``gs://`` string naming
    another session's or bucket's object matches nothing here and is never
    attached. Only artifacts are read; no state is written.
    """
    if not any("gs://" in text for text in texts):
        return []
    uploads = []
    for key in await callback_context.list_artifacts():
        # Cheap pre-filter: an upload's canonical URI contains its name, so an
        # upload the text never names needs no version lookups.
        if not key.startswith(_UPLOAD_ARTIFACT_PREFIX) or not any(
            key in text for text in texts
        ):
            continue
        latest = await callback_context.get_artifact_version(key)
        if latest is None:
            continue
        # Every version, so an older ``/0`` URI still matches after a re-upload
        # of the same name.
        for version in range(latest.version + 1):
            info = (
                latest
                if version == latest.version
                else await callback_context.get_artifact_version(key, version)
            )
            if info is None:
                continue
            mime_type = info.mime_type
            # Vertex reads gs:// only; a local in-memory store gives memory://.
            if (
                info.canonical_uri.startswith("gs://")
                and mime_type
                and mime_type.startswith(_UPLOAD_MIME_PREFIXES)
            ):
                uploads.append((info.canonical_uri, mime_type))
    return uploads


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


async def inject_cofacts_media_filedata(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    """Before-model callback for ai_verifier.

    The writer delegates media-watching by passing the verifier a Cofacts media
    URL in a plain-text instruction. url_context cannot read a raw storage object,
    so without this the verifier never actually sees the media. Here we detect the
    Cofacts media URL in the message text and append it as a ``gs://`` FileData
    Part so Gemini (on Vertex) can watch/inspect it directly — mirroring
    inject_youtube_filedata for YouTube URLs. A chat upload's ``gs://`` URI is
    attached the same way when it is the canonical URI of one of the calling
    session's uploads (see ``_session_uploads``).
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
        user_contents = [
            (content, [part.text for part in content.parts if part.text])
            for content in llm_request.contents
            if content.role == "user" and content.parts
        ]
        try:
            uploads = await _session_uploads(
                callback_context,
                [text for _, texts in user_contents for text in texts],
            )
        except Exception:
            # E.g. no artifact service, or GCS unavailable: attach no uploads;
            # the verifier's "No media, no description" rule covers the rest.
            logger.exception("Chat upload lookup failed; not attaching uploads")
            uploads = []
        for content, texts in user_contents:
            parts = content.parts or []
            urls = []
            for text in texts:
                urls.extend(_COFACTS_MEDIA_URL_RE.findall(text))
            for url in urls:
                url = url.rstrip(_URL_TRAILING_PUNCT)
                gs_uri = url if url.startswith("gs://") else signed_url_to_gs(url)
                if not gs_uri or gs_uri in seen:
                    continue
                seen.add(gs_uri)
                parts.append(
                    genai_types.Part(
                        file_data=genai_types.FileData(
                            file_uri=gs_uri,
                            mime_type=_mime_for_media_uri(gs_uri),
                        )
                    )
                )
            for uri, mime_type in uploads:
                if uri in seen or not any(_mentions(text, uri) for text in texts):
                    continue
                seen.add(uri)
                parts.append(
                    genai_types.Part(
                        file_data=genai_types.FileData(
                            file_uri=uri, mime_type=mime_type
                        )
                    )
                )
    except Exception:
        logger.exception(
            "inject_cofacts_media_filedata failed; skipping media injection"
        )
    return None
