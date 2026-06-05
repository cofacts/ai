"""
GCS attachment signing utilities for Cofacts AI.

Handles re-signing expired GCS signed URLs and injecting article attachments
as FileData parts into LLM requests so Gemini can perceive media directly.
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse

import google.auth
import google.auth.transport.requests
from google.cloud import storage
from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

_ARTICLE_TYPE_MIME = {
    "IMAGE": "image/webp",
    "VIDEO": "video/mp4",
    "AUDIO": "audio/mpeg",
}

# Re-sign a stored attachment URL when it expires within this many minutes, and
# mint the replacement to live this long. Fresh URLs straight from rumors-api are
# well within the margin, so re-signing only kicks in for URLs replayed from an
# older conversation's history (a reopened session, a slow multi-turn run).
_RESIGN_MARGIN_MINUTES = 5
_RESIGN_TTL_MINUTES = 60

# OAuth scopes for reading the Cofacts media bucket and signing object URLs.
_GCS_SCOPES = [
    "https://www.googleapis.com/auth/devstorage.read_only",
    "https://www.googleapis.com/auth/cloud-platform",
]

_gcs_credentials = None
_gcs_credentials_lock = asyncio.Lock()


async def _get_gcs_credentials():
    """Application Default Credentials with GCS scope, refreshed on demand.

    Works both on Cloud Run (runtime service account via the metadata server) and
    in docker-compose/local (service-account JSON via GOOGLE_APPLICATION_CREDENTIALS,
    which also carries the private key needed to sign URLs offline). google.auth and
    credential refresh do blocking network I/O, so they run in a worker thread; the
    lock serializes init/refresh of the shared credentials object.
    """
    global _gcs_credentials
    async with _gcs_credentials_lock:
        if _gcs_credentials is None:

            def _load_creds():
                creds, _ = google.auth.default(scopes=_GCS_SCOPES)
                return creds

            _gcs_credentials = await asyncio.to_thread(_load_creds)
        if not _gcs_credentials.valid:
            await asyncio.to_thread(
                _gcs_credentials.refresh, google.auth.transport.requests.Request()
            )
    return _gcs_credentials


def _parse_gcs_https_url(url: str) -> Optional[tuple[str, str]]:
    """Return (bucket, blob) from a GCS HTTPS URL, or None if unrecognized.

    Handles both path-style (storage.googleapis.com/<bucket>/<object>) and
    virtual-hosted style (<bucket>.storage.googleapis.com/<object>).
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


def _signed_url_expiry(url: str) -> Optional[datetime]:
    """Return the UTC expiry of a GCS signed URL, or None if it is not signed.

    Supports V4 (X-Goog-Date + X-Goog-Expires seconds) and the legacy V2 form
    (Expires = absolute unix timestamp).
    """
    q = parse_qs(urlparse(url).query)
    if "X-Goog-Date" in q and "X-Goog-Expires" in q:
        try:
            start = datetime.strptime(q["X-Goog-Date"][0], "%Y%m%dT%H%M%SZ").replace(
                tzinfo=timezone.utc
            )
            return start + timedelta(seconds=int(q["X-Goog-Expires"][0]))
        except (ValueError, KeyError):
            return None
    if "Expires" in q:
        try:
            return datetime.fromtimestamp(int(q["Expires"][0]), tz=timezone.utc)
        except (ValueError, KeyError):
            return None
    return None


async def _resign_gcs_blob(bucket_name: str, blob_name: str) -> Optional[str]:
    """Mint a fresh V4 signed GET URL for a GCS object using GCS credentials."""
    creds = await _get_gcs_credentials()

    def _sign() -> str:
        project = getattr(creds, "project_id", None) or os.environ.get(
            "GOOGLE_CLOUD_PROJECT"
        )
        client = storage.Client(credentials=creds, project=project)
        blob = client.bucket(bucket_name).blob(blob_name)
        return blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=_RESIGN_TTL_MINUTES),
            method="GET",
        )

    return await asyncio.to_thread(_sign)


async def _refresh_attachment_url(url: str) -> str:
    """Return a still-valid signed URL for the attachment.

    If the stored URL is unsigned/unrecognized or still valid beyond the margin,
    it is returned unchanged. If it is expired (or about to), re-sign it using the
    bucket and blob extracted from the URL. On any signing failure, fall back to the original URL
    (best effort) so the turn never crashes.
    """
    expiry = _signed_url_expiry(url)
    if expiry is None:
        return url
    if expiry - datetime.now(timezone.utc) > timedelta(minutes=_RESIGN_MARGIN_MINUTES):
        return url
    bucket_blob = _parse_gcs_https_url(url)
    if not bucket_blob:
        return url
    try:
        fresh = await _resign_gcs_blob(*bucket_blob)
    except Exception:
        logger.exception("Failed to re-sign expired attachment URL; using original")
        return url
    return fresh or url


async def inject_article_attachment(
    callback_context: CallbackContext,
    llm_request: LlmRequest,
) -> None:
    """Inject media file_data into the content alongside the get_single_cofacts_article FunctionResponse.

    Appends a Part(file_data=...) sibling carrying the article's signed GCS HTTPS
    attachmentUrl so Gemini can perceive the media directly. FunctionResponse.parts
    is a Python SDK-only field not transmitted to the model; the file_data must live
    at the content.parts level to be seen by the LLM.

    The attachmentUrl stored in history can expire (reopened session, long run), so
    it is re-signed on demand before injection — see _refresh_attachment_url.
    """
    for content in llm_request.contents:
        if content.role != "user":
            continue

        if any(p.file_data for p in content.parts or []):
            continue

        article_fr = None
        for part in content.parts or []:
            fr = part.function_response
            if fr and fr.name == "get_single_cofacts_article":
                article_fr = fr
                break

        if article_fr is None:
            continue

        article = (article_fr.response or {}).get("article") or {}
        article_type = article.get("articleType")
        attachment_url = article.get("attachmentUrl")
        if not attachment_url or article_type not in _ARTICLE_TYPE_MIME:
            continue
        attachment_url = await _refresh_attachment_url(attachment_url)
        content.parts = list(content.parts) + [
            genai_types.Part(
                file_data=genai_types.FileData(
                    file_uri=attachment_url,
                    # Coarse MIME type derived from articleType enum; the actual
                    # subtype (e.g. image/jpeg vs image/webp) may differ, but
                    # Gemini is permissive enough to handle the mismatch.
                    mime_type=_ARTICLE_TYPE_MIME[article_type],
                )
            )
        ]
