from contextvars import ContextVar
from typing import Optional

# Populated by the FastAPI middleware in main.py for each /run_sse request.
# Tools read this directly instead of going through session state.
cofacts_token_var: ContextVar[Optional[str]] = ContextVar("cofacts_token", default=None)
