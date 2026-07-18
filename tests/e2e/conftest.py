import os
import pytest
from playwright.sync_api import sync_playwright

AUTH_STATE = "tests/e2e/auth/auth_state.json"


@pytest.fixture(scope="module")
def page():
    if not os.path.exists(AUTH_STATE):
        pytest.skip(f"Auth state not found at {AUTH_STATE}. Run 'pnpm test:e2e:login' first.")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(storage_state=AUTH_STATE)
        pg = context.new_page()
        yield pg
        browser.close()
