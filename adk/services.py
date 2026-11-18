"""Custom ADK services, loaded by ADK itself.

``get_fast_api_app`` (used by ``main.py``, ``adk web`` and ``adk api_server``)
imports ``services.py`` from the agents directory before it builds the session
service. ADK only logs a warning if this import fails, so
``cofacts_ai/tests/test_session_service.py`` builds the app the same way and
checks a PATCH goes through ``CofactsSessionService``.
"""

from cofacts_ai.session_service import register_session_services

register_session_services()
