"""
E2E test: chat stream with ADK Agent response
Generated skeleton — replace with Webwright-crafted output.

Run:
    pytest tests/e2e/generated_scripts/test_chat_stream.py
"""
import json
import pytest
from playwright.sync_api import sync_playwright, Page

AUTH_STATE = "tests/e2e/auth/auth_state.json"
BASE_URL = "http://localhost:3000"
RUMOR = "喝冰水會中風"
RESPONSE_TIMEOUT = 30_000  # 30 s — ADK/Vertex AI streaming can be slow


@pytest.fixture(scope="module")
def page():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(storage_state=AUTH_STATE)
        pg = context.new_page()
        yield pg
        browser.close()


def test_chat_stream_no_crash(page: Page):
    page.goto(BASE_URL)

    # Type rumor into the chat input
    chat_input = page.get_by_role("textbox")
    chat_input.fill(RUMOR)
    chat_input.press("Enter")

    # Wait for the ADK structured response to finish rendering
    # The assistant message container should appear and stop showing a loading state
    page.wait_for_selector("[data-testid='assistant-message']", timeout=RESPONSE_TIMEOUT)

    # Assert no error banner is visible
    assert page.locator("[data-testid='error-banner']").count() == 0
