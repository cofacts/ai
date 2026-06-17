"""
E2E test: chat stream with ADK Agent response
Generated skeleton — replace with Webwright-crafted output.

Run:
    pytest tests/e2e/generated_scripts/test_chat_stream.py
"""
import pytest
from playwright.sync_api import Page

BASE_URL = "http://localhost:3000"
RUMOR = "喝冰水會中風"
RESPONSE_TIMEOUT = 30_000  # 30 s — ADK/Vertex AI streaming can be slow


def test_chat_stream_no_crash(page: Page):
    page.goto(BASE_URL)

    chat_input = page.get_by_role("textbox")
    chat_input.fill(RUMOR)
    chat_input.press("Enter")

    # Wait for the assistant message to appear, then for loading to finish
    page.wait_for_selector("[data-testid='assistant-message']", timeout=RESPONSE_TIMEOUT)
    page.wait_for_selector("[data-testid='assistant-message']:not(.loading)", timeout=RESPONSE_TIMEOUT)

    assert page.locator("[data-testid='error-banner']").count() == 0
