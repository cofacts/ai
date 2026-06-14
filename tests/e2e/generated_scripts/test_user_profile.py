"""
E2E test: user profile page renders correctly
Generated skeleton — replace with Webwright-crafted output.

Run:
    pytest tests/e2e/generated_scripts/test_user_profile.py
"""
import pytest
from playwright.sync_api import sync_playwright, Page

AUTH_STATE = "tests/e2e/auth/auth_state.json"
BASE_URL = "http://localhost:3000"


@pytest.fixture(scope="module")
def page():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(storage_state=AUTH_STATE)
        pg = context.new_page()
        yield pg
        browser.close()


def test_user_profile_displays_name(page: Page):
    page.goto(f"{BASE_URL}/profile")

    # Profile page should show the logged-in user's display name
    page.wait_for_selector("[data-testid='user-display-name']", timeout=10_000)
    name_text = page.locator("[data-testid='user-display-name']").inner_text()
    assert name_text.strip() != ""
