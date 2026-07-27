"""Unit tests for `expand_writer_symbols` (cofacts/ai#117).

Each investigator/verifier/proofreader AgentTool call is a fresh, stateless
single-message session that sees nothing the writer didn't put directly in
`request`, so the writer references content by symbol -- `[[message]]`,
`[[message:<articleId>]]`, `[[draft]]`, `[[draft:vN]]` -- and this callback
expands them from the writer's own event history before dispatch.

Exercised purely through mocked tool/args/tool_context inputs: the fakes
expose only `.name` and the public `.session.events` path the callback reads.
"""

from types import SimpleNamespace
from typing import cast

from google.adk.agents.callback_context import CallbackContext
from google.adk.tools.base_tool import BaseTool

from cofacts_ai.agent_names import (
    AI_INVESTIGATOR_NAME,
    AI_PROOFREADER_DPP_NAME,
    AI_PROOFREADER_KMT_NAME,
    AI_PROOFREADER_TPP_NAME,
    AI_VERIFIER_NAME,
)
from cofacts_ai.writer_symbols import expand_writer_symbols


def make_tool(name: str) -> BaseTool:
    """Fake BaseTool -- expand_writer_symbols only reads .name."""
    return cast(BaseTool, SimpleNamespace(name=name))


def make_fn_call_event(name: str, args: dict) -> SimpleNamespace:
    """Fake ADK Event bearing one function_call part.

    expand_writer_symbols only reads event.content.parts[*].function_call
    (.name, .args), so a SimpleNamespace stand-in avoids coupling the test to
    google.genai's pydantic models.
    """
    part = SimpleNamespace(
        function_call=SimpleNamespace(name=name, args=args),
        function_response=None,
    )
    return SimpleNamespace(content=SimpleNamespace(parts=[part]))


def make_fn_response_event(name: str, response: dict) -> SimpleNamespace:
    """Fake ADK Event bearing one function_response part."""
    part = SimpleNamespace(
        function_call=None,
        function_response=SimpleNamespace(name=name, response=response),
    )
    return SimpleNamespace(content=SimpleNamespace(parts=[part]))


def make_symbol_tool_context(events: list) -> CallbackContext:
    """Fake ToolContext exposing only the public `.session.events` path
    expand_writer_symbols reads (ReadonlyContext.session, verified public in
    ADK 1.26.0 -- Context(ReadonlyContext) inherits it)."""
    return cast(
        CallbackContext, SimpleNamespace(session=SimpleNamespace(events=events))
    )


class TestExpandWriterSymbols:
    def test_unrelated_tool_name_is_skipped_even_with_symbols_present(self):
        args = {"request": "please review [[draft]]"}
        result = expand_writer_symbols(
            make_tool("search_cofacts_database"), args, make_symbol_tool_context([])
        )
        assert result is None
        assert args["request"] == "please review [[draft]]"

    def test_no_symbols_leaves_request_untouched(self):
        args = {"request": "plain request with no symbols"}
        result = expand_writer_symbols(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_symbol_tool_context([])
        )
        assert result is None
        assert args["request"] == "plain request with no symbols"

    def test_non_string_request_is_ignored(self):
        args = {"request": None}
        result = expand_writer_symbols(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_symbol_tool_context([])
        )
        assert result is None
        assert args["request"] is None

    def test_draft_symbol_expands_to_latest_proposal(self):
        events = [
            make_fn_call_event(
                "draft_factcheck_response",
                {
                    "text": "draft v1",
                    "classification": "RUMOR",
                    "references": "https://x",
                },
            ),
            make_fn_call_event(
                "draft_factcheck_response",
                {
                    "text": "draft v2",
                    "classification": "RUMOR",
                    "references": "https://x",
                },
            ),
        ]
        args = {"request": "Review this: [[draft]]"}
        result = expand_writer_symbols(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_symbol_tool_context(events)
        )
        assert result is None
        assert args["request"] == "Review this: draft v2"

    def test_versioned_draft_symbol_selects_specific_proposal(self):
        events = [
            make_fn_call_event("draft_factcheck_response", {"text": "draft v1"}),
            make_fn_call_event("draft_factcheck_response", {"text": "draft v2"}),
        ]
        args = {"request": "Review [[draft:v1]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_DPP_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "Review draft v1"

    def test_rejected_proposal_still_resolves_from_function_call_args(self):
        # A rejected proposal (failed claim_sources/verification gate) never
        # gets a successful function_response, but its function_call args --
        # the text the writer actually proposed -- are still in the event
        # history, so proofreaders can review pre-verification prose too.
        events = [
            make_fn_call_event(
                "draft_factcheck_response", {"text": "rejected draft text"}
            )
        ]
        args = {"request": "[[draft]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_TPP_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "rejected draft text"

    def test_missing_draft_symbol_yields_explicit_marker_not_silent_drop(self):
        args = {"request": "Review [[draft]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_symbol_tool_context([])
        )
        # Marker text deliberately echoes the unresolved symbol for diagnostic
        # clarity (e.g. "...to resolve [[draft]]"), so it isn't literally
        # absent -- but the symbol is no longer left bare/unexplained.
        assert args["request"] != "Review [[draft]]"
        assert "SYSTEM" in args["request"]

    def test_out_of_range_version_yields_explicit_marker(self):
        events = [make_fn_call_event("draft_factcheck_response", {"text": "only one"})]
        args = {"request": "[[draft:v5]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_TPP_NAME), args, make_symbol_tool_context(events)
        )
        assert "SYSTEM" in args["request"]
        assert "only one" not in args["request"]

    def test_message_symbol_expands_from_article_tool_response(self):
        events = [
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-1", "article": {"text": "the suspicious message"}},
            )
        ]
        args = {"request": "[[message]] -- what do you think?"}
        expand_writer_symbols(
            make_tool(AI_INVESTIGATOR_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "the suspicious message -- what do you think?"

    def test_message_symbol_without_article_id_still_resolves(self):
        # Defensive: real responses always carry article_id, but a shape change
        # must not silently break the most common symbol.
        events = [
            make_fn_response_event(
                "get_single_cofacts_article", {"article": {"text": "no id here"}}
            )
        ]
        args = {"request": "[[message]]"}
        expand_writer_symbols(
            make_tool(AI_INVESTIGATOR_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "no id here"

    def test_bare_message_resolves_to_most_recently_fetched_article(self):
        # A conversation can move on to a second suspicious message; bare
        # [[message]] must follow the user, not pin to the first article.
        events = [
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-1", "article": {"text": "first message"}},
            ),
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-2", "article": {"text": "second message"}},
            ),
        ]
        args = {"request": "[[message]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "second message"

    def test_message_symbol_can_address_a_specific_article_by_id(self):
        events = [
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-1", "article": {"text": "first message"}},
            ),
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-2", "article": {"text": "second message"}},
            ),
        ]
        args = {"request": "compare [[message:art-1]] with [[message:art-2]]"}
        expand_writer_symbols(
            make_tool(AI_VERIFIER_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "compare first message with second message"

    def test_refetching_an_article_makes_it_the_most_recent(self):
        events = [
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-1", "article": {"text": "first message"}},
            ),
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-2", "article": {"text": "second message"}},
            ),
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-1", "article": {"text": "first message"}},
            ),
        ]
        args = {"request": "[[message]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_DPP_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "first message"

    def test_unknown_article_id_yields_marker_listing_available_ids(self):
        events = [
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-1", "article": {"text": "first message"}},
            )
        ]
        args = {"request": "[[message:art-9]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_TPP_NAME), args, make_symbol_tool_context(events)
        )
        assert "SYSTEM" in args["request"]
        assert "art-1" in args["request"]  # tells the writer what it can use
        assert "first message" not in args["request"]

    def test_article_fetch_error_response_is_ignored(self):
        # {"error": ..., "article_id": ...} has no article/text -- must not
        # become a resolvable message.
        events = [
            make_fn_response_event(
                "get_single_cofacts_article",
                {"article_id": "art-1", "error": "Article not found"},
            )
        ]
        args = {"request": "[[message]]"}
        expand_writer_symbols(
            make_tool(AI_VERIFIER_NAME), args, make_symbol_tool_context(events)
        )
        assert "SYSTEM" in args["request"]

    def test_message_symbol_missing_yields_explicit_marker(self):
        args = {"request": "[[message]]"}
        expand_writer_symbols(
            make_tool(AI_VERIFIER_NAME), args, make_symbol_tool_context([])
        )
        assert args["request"] != "[[message]]"
        assert "SYSTEM" in args["request"]

    def test_both_symbols_expand_in_one_request(self):
        events = [
            make_fn_response_event(
                "get_single_cofacts_article", {"article": {"text": "original message"}}
            ),
            make_fn_call_event("draft_factcheck_response", {"text": "the draft"}),
        ]
        args = {"request": "[[message]] / [[draft]]"}
        expand_writer_symbols(
            make_tool(AI_PROOFREADER_DPP_NAME), args, make_symbol_tool_context(events)
        )
        assert args["request"] == "original message / the draft"

    def test_applies_to_investigator_and_verifier_too(self):
        events = [make_fn_call_event("draft_factcheck_response", {"text": "the draft"})]
        for name in (AI_INVESTIGATOR_NAME, AI_VERIFIER_NAME):
            args = {"request": "[[draft]]"}
            expand_writer_symbols(
                make_tool(name), args, make_symbol_tool_context(events)
            )
            assert args["request"] == "the draft"
