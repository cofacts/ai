"""
E2E test: user profile page renders correctly
Generated skeleton — replace with Webwright-crafted output.

Run:
    pytest tests/e2e/generated_scripts/test_user_profile.py
"""
from playwright.sync_api import Page

BASE_URL = "http://localhost:3000"


def test_user_profile_displays_name(page: Page):
    page.goto(f"{BASE_URL}/profile")

    page.wait_for_selector("[data-testid='user-display-name']", timeout=10_000)
    name_text = page.locator("[data-testid='user-display-name']").inner_text()
    assert name_text.strip() != ""
