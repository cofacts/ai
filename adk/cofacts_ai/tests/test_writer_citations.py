"""Unit tests for `attach_citation` / `resolve_citations` (cofacts/ai#117).

Each investigator/verifier/proofreader AgentTool call is a fresh, stateless
single-message session that sees nothing the writer didn't put directly in
`request`. So every tool result is stamped with a footnote id (`cite_as`), and
writing `[^that-id]` in a sub-agent's `request` hoists the result's full text
to the top of the request as a block tagged with the same id.

Exercised purely through mocked tool/args/tool_context inputs: the fakes expose
only `.name`, `.function_call_id` and the public `.session.events` path the
callbacks read.
"""

import json
from types import SimpleNamespace
from typing import Optional, cast

from google.adk.agents.callback_context import CallbackContext
from google.adk.tools.base_tool import BaseTool

from cofacts_ai.agent_names import (
    AI_INVESTIGATOR_NAME,
    AI_PROOFREADER_DPP_NAME,
    AI_PROOFREADER_KMT_NAME,
    AI_VERIFIER_NAME,
)
from cofacts_ai.writer_citations import attach_citation, resolve_citations

ARTICLE_TOOL = "get_single_cofacts_article"
DRAFT_TOOL = "draft_factcheck_response"

# Function-call ids as Gemini actually issues them: 8 base36-ish characters
# (observed in trace 65a3975e), short enough that a citation id keeps the whole
# thing. `adk-<uuid4>` ids -- ADK's fallback when the model supplies none -- are
# covered separately in TestAttachCitation.
ARTICLE_CALL = "1a2b3cxy"
DRAFT_CALL = "7f3e21zz"
VERIFIER_CALL = "ab12cdyy"
SIBLING_CALL = "ygxikp2o"
FEEDBACK_CALL = "c0ffee11"
SEARCH_CALL = "dddddd77"


def make_tool(name: str) -> BaseTool:
    """Fake BaseTool -- both callbacks only read .name."""
    return cast(BaseTool, SimpleNamespace(name=name))


def make_fn_call_event(name: str, call_id: str, args: dict) -> SimpleNamespace:
    """Fake ADK Event bearing one function_call part.

    The callbacks only read event.content.parts[*].function_call
    (.name, .id, .args), so a SimpleNamespace stand-in avoids coupling the test
    to google.genai's pydantic models.
    """
    part = SimpleNamespace(
        function_call=SimpleNamespace(name=name, id=call_id, args=args),
        function_response=None,
    )
    return SimpleNamespace(content=SimpleNamespace(parts=[part]))


def make_fn_response_event(name: str, call_id: str, response: dict) -> SimpleNamespace:
    """Fake ADK Event bearing one function_response part. ADK gives the
    response the same id as its call, which is what lets one citation id
    address either side."""
    part = SimpleNamespace(
        function_call=None,
        function_response=SimpleNamespace(name=name, id=call_id, response=response),
    )
    return SimpleNamespace(content=SimpleNamespace(parts=[part]))


def draft_accepted_event(call_id: str) -> SimpleNamespace:
    """The response half of a submitted draft proposal.

    A draft is citable only once its response is back, like every other result,
    even though the quoted text comes from the CALL arguments.
    """
    return make_fn_response_event(
        DRAFT_TOOL,
        call_id,
        {
            "success": True,
            "text": "Proposal accepted.",
            "cite_as": f"[^{DRAFT_TOOL}-{call_id}]",
        },
    )


def make_tool_context(
    events: Optional[list] = None, function_call_id: Optional[str] = "fc12ab34"
) -> CallbackContext:
    """Fake ToolContext exposing only `.session.events` (ReadonlyContext.session,
    verified public in ADK 1.26.0 -- Context(ReadonlyContext) inherits it) and
    `.function_call_id`."""
    return cast(
        CallbackContext,
        SimpleNamespace(
            session=SimpleNamespace(events=events or []),
            function_call_id=function_call_id,
        ),
    )


class TestAttachCitation:
    def test_stamps_cite_as_and_hint_on_a_dict_response(self):
        result = attach_citation(
            make_tool(AI_VERIFIER_NAME),
            {"content": "report", "sources": []},
            make_tool_context(function_call_id=VERIFIER_CALL),
        )
        assert result == {
            "content": "report",
            "sources": [],
            "cite_as": f"[^{AI_VERIFIER_NAME}-{VERIFIER_CALL}]",
            "cite_hint": (
                f"To let a sub-agent read this result in full, write "
                f"[^{AI_VERIFIER_NAME}-{VERIFIER_CALL}] in its `request`."
            ),
        }

    def test_wraps_a_plain_string_the_way_adk_would(self):
        result = attach_citation(
            make_tool(AI_PROOFREADER_KMT_NAME),
            "這則訊息讓我想問…",
            make_tool_context(function_call_id=FEEDBACK_CALL),
        )
        assert result["result"] == "這則訊息讓我想問…"
        assert result["cite_as"] == f"[^{AI_PROOFREADER_KMT_NAME}-{FEEDBACK_CALL}]"

    def test_error_payloads_are_not_citable(self):
        payload = {"error": "timeout", "message": "[SYSTEM] ..."}
        result = attach_citation(
            make_tool(AI_VERIFIER_NAME), payload, make_tool_context()
        )
        assert result == payload

    def test_missing_function_call_id_leaves_the_response_alone(self):
        payload = {"content": "report"}
        result = attach_citation(
            make_tool(AI_VERIFIER_NAME),
            payload,
            make_tool_context(function_call_id=None),
        )
        assert result == {"content": "report"}

    def test_an_adk_generated_uuid_is_stripped_and_capped(self):
        # When the model supplies no id, ADK generates `adk-<uuid4>`. Copying 40
        # characters by hand invites mistakes, so the prefix and the dashes go
        # and what is left is capped.
        result = attach_citation(
            make_tool(AI_VERIFIER_NAME),
            {"content": "report"},
            make_tool_context(
                function_call_id="adk-3f2a1b4c-9d8e-4f7a-b6c5-1e2d3f4a5b6c"
            ),
        )
        assert result["cite_as"] == f"[^{AI_VERIFIER_NAME}-3f2a1b4c]"

    def test_parallel_calls_to_the_same_tool_get_distinct_ids(self):
        # Two verifier calls issued in one turn: counting them would collide,
        # deriving from the call id cannot.
        first = attach_citation(
            make_tool(AI_VERIFIER_NAME),
            {"content": "a"},
            make_tool_context(function_call_id="aaaaaa11"),
        )
        second = attach_citation(
            make_tool(AI_VERIFIER_NAME),
            {"content": "b"},
            make_tool_context(function_call_id="bbbbbb22"),
        )
        assert first["cite_as"] != second["cite_as"]


class TestResolveCitations:
    def test_unrelated_tool_name_is_skipped_even_with_a_citation_present(self):
        args = {"request": "please review [^draft_factcheck_response-aaaaaa]"}
        result = resolve_citations(
            make_tool("search_cofacts_database"), args, make_tool_context()
        )
        assert result is None
        assert args == {"request": "please review [^draft_factcheck_response-aaaaaa]"}

    def test_request_without_a_citation_is_left_untouched(self):
        args = {"request": "What questions would supporters ask?"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context()
        )
        assert result is None
        assert args == {"request": "What questions would supporters ask?"}

    def test_non_string_request_is_left_untouched(self):
        args = {"request": None}
        result = resolve_citations(
            make_tool(AI_VERIFIER_NAME), args, make_tool_context()
        )
        assert result is None
        assert args == {"request": None}

    def test_article_citation_is_hoisted_above_the_prose(self):
        events = [
            make_fn_response_event(
                ARTICLE_TOOL,
                ARTICLE_CALL,
                {"article_id": "abc", "article": {"text": "轉傳謠言全文"}},
            )
        ]
        args = {"request": f"請看 [^{ARTICLE_TOOL}-{ARTICLE_CALL}] 並說說感想"}
        resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert args["request"] == (
            f"<{ARTICLE_TOOL}-{ARTICLE_CALL}>\n"
            "轉傳謠言全文\n"
            f"</{ARTICLE_TOOL}-{ARTICLE_CALL}>\n"
            "\n---\n\n"
            f"請看 [^{ARTICLE_TOOL}-{ARTICLE_CALL}] 並說說感想"
        )

    def test_draft_resolves_from_the_call_args_so_a_rejected_proposal_still_works(self):
        events = [
            make_fn_call_event(DRAFT_TOOL, DRAFT_CALL, {"text": "草稿全文"}),
            # The gate rejected it: the response carries no draft text at all.
            make_fn_response_event(
                DRAFT_TOOL,
                DRAFT_CALL,
                {"success": False, "text": "These claims are not verifier-confirmed"},
            ),
        ]
        args = {"request": f"[^{DRAFT_TOOL}-{DRAFT_CALL}] 這樣寫公允嗎？"}
        resolve_citations(
            make_tool(AI_PROOFREADER_DPP_NAME), args, make_tool_context(events)
        )
        assert (
            f"<{DRAFT_TOOL}-{DRAFT_CALL}>\n草稿全文\n</{DRAFT_TOOL}-{DRAFT_CALL}>"
            in (args["request"])
        )
        assert "not verifier-confirmed" not in args["request"]

    def test_verifier_report_is_citable(self):
        events = [
            make_fn_response_event(
                AI_VERIFIER_NAME,
                VERIFIER_CALL,
                {"content": "1. 影片宣稱…\n2. 逐字稿…", "sources": []},
            )
        ]
        args = {"request": f"依據 [^{AI_VERIFIER_NAME}-{VERIFIER_CALL}] 評估"}
        resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert "1. 影片宣稱…\n2. 逐字稿…" in args["request"]

    def test_a_verifier_report_in_the_fallback_shape_is_citable(self):
        # Regression, trace cdfa394f: when Gemini omits grounding metadata the
        # verifier's after-model callback leaves the raw text alone, so the
        # report arrives under `result` instead of `content` (the
        # AdkFallbackResp shape documented in src/lib/adk.ts). Reading only
        # `content` made a complete verification report uncitable, and the
        # writer had no way out -- it kept re-citing an id that could never
        # resolve.
        events = [
            make_fn_response_event(
                AI_VERIFIER_NAME,
                VERIFIER_CALL,
                {"result": "以下為您提供 YouTube 影片的詳細內容報告：…"},
            )
        ]
        args = {"request": f"依據 [^{AI_VERIFIER_NAME}-{VERIFIER_CALL}] 評估"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is None
        assert "以下為您提供 YouTube 影片的詳細內容報告：…" in args["request"]

    def test_an_investigator_report_in_the_fallback_shape_is_citable(self):
        events = [
            make_fn_response_event(
                AI_INVESTIGATOR_NAME, SEARCH_CALL, {"result": "搜尋結果摘要"}
            )
        ]
        args = {"request": f"[^{AI_INVESTIGATOR_NAME}-{SEARCH_CALL}]"}
        result = resolve_citations(
            make_tool(AI_VERIFIER_NAME), args, make_tool_context(events)
        )
        assert result is None
        assert "搜尋結果摘要" in args["request"]

    def test_a_blank_body_is_not_citable_so_the_call_is_cancelled(self):
        events = [
            make_fn_response_event(
                AI_VERIFIER_NAME, VERIFIER_CALL, {"content": "   \n"}
            )
        ]
        args = {"request": f"[^{AI_VERIFIER_NAME}-{VERIFIER_CALL}]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is not None

    def test_an_article_with_no_text_never_falls_back_to_dumping_the_payload(self):
        # The payload carries other people's fact-check verdicts and reply
        # counts; a proofreader must not be primed with those, so a missing
        # `article.text` cancels the call rather than quoting the JSON.
        events = [
            make_fn_response_event(
                ARTICLE_TOOL,
                ARTICLE_CALL,
                {"article_id": "abc", "article": {"factCheckCount": 3}},
            )
        ]
        args = {"request": f"[^{ARTICLE_TOOL}-{ARTICLE_CALL}]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is not None
        assert "factCheckCount" not in json.dumps(result, ensure_ascii=False)

    def test_the_json_fallback_leaves_out_our_own_citation_fields(self):
        events = [
            make_fn_response_event(
                "search_cofacts_database",
                SEARCH_CALL,
                {
                    "data": [{"id": "a1"}],
                    "cite_as": f"[^search_cofacts_database-{SEARCH_CALL}]",
                    "cite_hint": "To let a sub-agent read this result…",
                },
            )
        ]
        args = {"request": f"[^search_cofacts_database-{SEARCH_CALL}]"}
        resolve_citations(
            make_tool(AI_INVESTIGATOR_NAME), args, make_tool_context(events)
        )
        assert '{"data": [{"id": "a1"}]}' in args["request"]
        assert "cite_hint" not in args["request"]

    def test_proofreader_feedback_is_citable(self):
        events = [
            make_fn_response_event(
                AI_PROOFREADER_KMT_NAME, FEEDBACK_CALL, {"result": "我的疑慮是…"}
            )
        ]
        args = {
            "request": f"另一位審稿人說 [^{AI_PROOFREADER_KMT_NAME}-{FEEDBACK_CALL}]"
        }
        resolve_citations(
            make_tool(AI_PROOFREADER_DPP_NAME), args, make_tool_context(events)
        )
        assert "我的疑慮是…" in args["request"]

    def test_unlisted_tool_falls_back_to_compact_json(self):
        response = {"data": [{"id": "a1"}]}
        events = [
            make_fn_response_event("search_cofacts_database", SEARCH_CALL, response)
        ]
        args = {"request": f"[^search_cofacts_database-{SEARCH_CALL}]"}
        resolve_citations(
            make_tool(AI_INVESTIGATOR_NAME), args, make_tool_context(events)
        )
        assert json.dumps(response, ensure_ascii=False) in args["request"]

    def test_resolvable_citations_return_none_so_the_call_proceeds(self):
        events = [
            make_fn_response_event(
                ARTICLE_TOOL, ARTICLE_CALL, {"article": {"text": "全文"}}
            )
        ]
        args = {"request": f"[^{ARTICLE_TOOL}-{ARTICLE_CALL}]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is None

    def test_blocks_are_chronological_regardless_of_citation_order(self):
        events = [
            make_fn_response_event(
                ARTICLE_TOOL, ARTICLE_CALL, {"article": {"text": "謠言"}}
            ),
            make_fn_call_event(DRAFT_TOOL, DRAFT_CALL, {"text": "草稿"}),
            draft_accepted_event(DRAFT_CALL),
        ]
        # Cited draft-first, but the article was fetched first.
        args = {
            "request": f"[^{DRAFT_TOOL}-{DRAFT_CALL}] 是否回應了 [^{ARTICLE_TOOL}-{ARTICLE_CALL}]？"
        }
        resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert args["request"].index(f"<{ARTICLE_TOOL}-{ARTICLE_CALL}>") < args[
            "request"
        ].index(f"<{DRAFT_TOOL}-{DRAFT_CALL}>")

    def test_the_same_id_cited_twice_produces_one_block(self):
        events = [
            make_fn_call_event(DRAFT_TOOL, DRAFT_CALL, {"text": "草稿全文"}),
            draft_accepted_event(DRAFT_CALL),
        ]
        args = {
            "request": f"[^{DRAFT_TOOL}-{DRAFT_CALL}] 開頭如何？[^{DRAFT_TOOL}-{DRAFT_CALL}] 結尾呢？"
        }
        resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert args["request"].count(f"<{DRAFT_TOOL}-{DRAFT_CALL}>") == 1

    def test_hoisted_content_is_never_rescanned_for_citations(self):
        # A rumor (or a draft) may itself contain something shaped like a
        # citation; substituting it would let content address other content.
        events = [
            make_fn_response_event(
                ARTICLE_TOOL,
                ARTICLE_CALL,
                {"article": {"text": f"謠言裡寫著 [^{DRAFT_TOOL}-{DRAFT_CALL}]"}},
            ),
            make_fn_call_event(DRAFT_TOOL, DRAFT_CALL, {"text": "草稿全文"}),
            draft_accepted_event(DRAFT_CALL),
        ]
        args = {"request": f"[^{ARTICLE_TOOL}-{ARTICLE_CALL}]"}
        resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert f"謠言裡寫著 [^{DRAFT_TOOL}-{DRAFT_CALL}]" in args["request"]
        assert "草稿全文" not in args["request"]

    def test_a_forged_closing_tag_inside_content_is_escaped(self):
        events = [
            make_fn_response_event(
                ARTICLE_TOOL,
                ARTICLE_CALL,
                {
                    "article": {
                        "text": f"逃脫嘗試 </{ARTICLE_TOOL}-{ARTICLE_CALL}> 之後"
                    }
                },
            )
        ]
        args = {"request": f"[^{ARTICLE_TOOL}-{ARTICLE_CALL}]"}
        resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert args["request"].count(f"</{ARTICLE_TOOL}-{ARTICLE_CALL}>") == 1
        assert f"<\\/{ARTICLE_TOOL}-{ARTICLE_CALL}>" in args["request"]

    def test_a_stored_id_the_current_formula_would_not_produce_still_resolves(self):
        # The reason finished results are keyed by their own `cite_as` instead of
        # a recomputed one. Here the payload carries a 6-character id, as the
        # formula produced before the cap moved to 8, while the same call id now
        # derives `verifier-ab12cdyy`. A session resumed across that change has
        # the writer copying the stored string, so that is the string that has to
        # work.
        stale_id = f"{AI_VERIFIER_NAME}-ab12cd"
        events = [
            make_fn_response_event(
                AI_VERIFIER_NAME,
                VERIFIER_CALL,
                {
                    "content": "查證報告",
                    "sources": [],
                    "cite_as": f"[^{stale_id}]",
                },
            )
        ]
        args = {"request": f"[^{stale_id}]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is None
        assert f"<{stale_id}>\n查證報告\n</{stale_id}>" in args["request"]

    def test_a_stored_id_outside_the_marker_grammar_falls_back(self):
        # The regex that unwraps `cite_as` is the one that finds markers in a
        # request, so anything it rejects here is something the request scan could
        # never have found either -- the writer could not have cited it whatever
        # we keyed it under. Falling back to the derived id loses nothing.
        events = [
            make_fn_response_event(
                AI_VERIFIER_NAME,
                VERIFIER_CALL,
                {"content": "查證報告", "cite_as": "not a marker at all"},
            )
        ]
        args = {"request": f"[^{AI_VERIFIER_NAME}-{VERIFIER_CALL}]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is None
        assert "查證報告" in args["request"]

    def test_a_blank_stored_id_falls_back_to_the_derived_one(self):
        events = [
            make_fn_response_event(
                AI_VERIFIER_NAME,
                VERIFIER_CALL,
                {"content": "查證報告", "cite_as": "   "},
            )
        ]
        args = {"request": f"[^{AI_VERIFIER_NAME}-{VERIFIER_CALL}]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is None
        assert "查證報告" in args["request"]

    def test_resolution_does_not_depend_on_the_payload_carrying_cite_as(self):
        # A response with no `cite_as` of its own still resolves, because ids are
        # derived from the stored event. That is what lets the draft path work
        # (its text is in the CALL args, which never carry cite_as) and closes
        # the gap where a payload could name its own id. Note it does NOT make
        # pre-citation sessions usefully citable: the writer was never handed an
        # id for those and cannot see part ids, so it has nothing to copy.
        events = [
            make_fn_response_event(
                AI_VERIFIER_NAME,
                VERIFIER_CALL,
                {"content": "舊的查證報告", "sources": []},
            )
        ]
        args = {"request": f"[^{AI_VERIFIER_NAME}-{VERIFIER_CALL}]"}
        resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert "舊的查證報告" in args["request"]

    def test_minted_id_matches_the_id_resolution_derives(self):
        # The two halves must agree or every citation the writer copies fails.
        # An `adk-<uuid4>` id exercises that through the stripping and capping
        # too, where a mismatch would be easiest to introduce.
        call_id = "adk-3f2a1b4c-9d8e-4f7a-b6c5-1e2d3f4a5b6c"
        minted = attach_citation(
            make_tool(AI_VERIFIER_NAME),
            {"content": "查證結果"},
            make_tool_context(function_call_id=call_id),
        )
        events = [make_fn_response_event(AI_VERIFIER_NAME, call_id, minted)]
        args = {"request": minted["cite_as"]}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is None
        assert "查證結果" in args["request"]


class TestUnresolvableCitationsCancelTheCall:
    """A citation that cannot be resolved returns a response from the
    before_tool_callback, which makes ADK skip the tool entirely
    (flows/llm_flows/functions.py: the tool runs only `if function_response is
    None`). Dispatching the call anyway is what produced the dead review round
    in trace 65a3975e: four proofreaders read a request with a hole where the
    claim inventory should have been, and all four refused.
    """

    def test_a_sibling_call_from_the_same_turn_says_it_has_not_returned_yet(self):
        # The writer fanned out the verifier and the proofreaders together and
        # cited the verifier -- Gemini emits all the calls in one completion, so
        # it already knows the id. The call event is in history; the response is
        # not, and never will be before this callback runs.
        events = [
            make_fn_call_event(
                AI_VERIFIER_NAME, SIBLING_CALL, {"request": "watch the video"}
            )
        ]
        args = {"request": f"Extracted claims: [^{AI_VERIFIER_NAME}-{SIBLING_CALL}]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is not None
        assert result["error"] == "unresolved_citation"
        assert f"{AI_PROOFREADER_KMT_NAME} was NOT called" in result["message"]
        assert "has not returned yet" in result["message"]
        assert "LATER turn" in result["message"]
        # The request must be left exactly as the writer wrote it.
        assert args == {
            "request": f"Extracted claims: [^{AI_VERIFIER_NAME}-{SIBLING_CALL}]"
        }

    def test_a_draft_proposal_that_has_not_come_back_is_not_citable_either(self):
        # A draft is quoted from its CALL arguments, which exist the moment the
        # call is issued -- but it is still reached from the response side, so the
        # same-turn rule applies to it as to everything else. Submitting a
        # proposal and reviewing it in one turn is not a shortcut.
        events = [make_fn_call_event(DRAFT_TOOL, DRAFT_CALL, {"text": "草稿全文"})]
        args = {"request": f"[^{DRAFT_TOOL}-{DRAFT_CALL}] 這樣寫公允嗎？"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is not None
        assert "has not returned yet" in result["message"]
        assert "草稿全文" not in args["request"]

    def test_an_errored_result_says_there_is_nothing_to_quote(self):
        events = [
            make_fn_call_event(AI_VERIFIER_NAME, VERIFIER_CALL, {"request": "x"}),
            make_fn_response_event(
                AI_VERIFIER_NAME, VERIFIER_CALL, {"error": "timeout"}
            ),
        ]
        args = {"request": f"[^{AI_VERIFIER_NAME}-{VERIFIER_CALL}]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is not None
        assert "returned an error" in result["message"]

    def test_an_unknown_id_lists_what_is_citable(self):
        events = [
            make_fn_response_event(
                ARTICLE_TOOL, ARTICLE_CALL, {"article": {"text": "全文"}}
            )
        ]
        args = {"request": f"[^{DRAFT_TOOL}-000000] 請看"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context(events)
        )
        assert result is not None
        assert "no tool result has that id" in result["message"]
        assert f"Citable results: {ARTICLE_TOOL}-{ARTICLE_CALL}" in result["message"]

    def test_nothing_citable_yet_says_none_yet(self):
        args = {"request": f"[^{DRAFT_TOOL}-000000]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context([])
        )
        assert result is not None
        assert "Citable results: none yet" in result["message"]

    def test_one_bad_citation_cancels_the_call_even_when_others_resolve(self):
        # A proofreader given the draft but not the evidence is worse than one
        # that was never called: it answers, and the answer looks legitimate.
        events = [
            make_fn_call_event(DRAFT_TOOL, DRAFT_CALL, {"text": "草稿全文"}),
            draft_accepted_event(DRAFT_CALL),
        ]
        request = f"[^{DRAFT_TOOL}-{DRAFT_CALL}] vs [^{AI_VERIFIER_NAME}-000000]"
        args = {"request": request}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_DPP_NAME), args, make_tool_context(events)
        )
        assert result is not None
        assert args == {"request": request}
        assert "草稿全文" not in args["request"]

    def test_every_bad_citation_is_reported_not_just_the_first(self):
        args = {"request": f"[^{DRAFT_TOOL}-aaaaaa] and [^{AI_VERIFIER_NAME}-bbbbbb]"}
        result = resolve_citations(
            make_tool(AI_PROOFREADER_KMT_NAME), args, make_tool_context([])
        )
        assert result is not None
        assert f"[^{DRAFT_TOOL}-aaaaaa]" in result["message"]
        assert f"[^{AI_VERIFIER_NAME}-bbbbbb]" in result["message"]
