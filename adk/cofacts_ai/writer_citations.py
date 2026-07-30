"""
Footnote citations for the writer's stateless sub-agent calls.

``ai_investigator``, ``ai_verifier`` and the four ``ai_proofreader_*`` are each
mounted on the writer as an ``AgentTool``, and every such call starts a fresh,
stateless, single-message session: the sub-agent sees nothing but the
``request`` string of that one call — not the writer's conversation, not a
sibling call made in the same turn, not an earlier call to the same sub-agent.
So a back-reference like 「（同上）」 has no referent, and the writer used to
fan out four parallel proofreader calls with the draft pasted into only the
first (cofacts/ai#117).

This module lets the writer *cite* content instead of retyping it, in two
halves that must stay in step:

- ``attach_citation`` stamps every tool result with the footnote id that
  addresses it (``cite_as`` / ``cite_hint``). The id has to travel inside the
  payload because ADK strips its own function-call ids from the history it
  sends to the model, so the writer could never see them otherwise.
- ``resolve_citations`` finds ``[^id]`` markers in an outgoing ``request``,
  looks each one up in the writer's OWN event history (via the public
  ``ReadonlyContext.session``) and hoists the referenced text to the top of the
  request as a delimited block. The marker stays where the writer put it. A
  citation that cannot be resolved cancels the call rather than dispatching a
  request with a hole in it.

Hoisting rather than substituting is deliberate: a long rumor spliced into the
middle of a sentence reads as an interruption, two adjacent markers expand into
one indistinguishable blob, and where the writer happens to place a marker
should not change what the sub-agent ends up receiving.

See ``docs/decisions/20260722-subagent-context-citations.md`` for why this
shape was chosen over session state, artifacts and a prose-marker convention.
"""

import json
import re
from typing import Any, NamedTuple, Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.tools.base_tool import BaseTool

from .agent_names import (
    AI_INVESTIGATOR_NAME,
    AI_PROOFREADER_NAMES,
    AI_VERIFIER_NAME,
)
from .tools import draft_factcheck_response, get_single_cofacts_article

_DRAFT_TOOL_NAME = draft_factcheck_response.__name__
_ARTICLE_TOOL_NAME = get_single_cofacts_article.__name__

# Sub-agents whose `request` argument gets citations resolved before dispatch.
# All are AgentTools: every call starts a fresh, stateless single-message
# session that sees nothing but this one `request` string.
_CITING_TOOL_NAMES = (
    AI_INVESTIGATOR_NAME,
    AI_VERIFIER_NAME,
    *AI_PROOFREADER_NAMES,
)

# GitHub-flavored-markdown footnote markers. The bracket-caret form reads as a
# citation rather than a placeholder, which is what this mechanism actually
# does -- and unlike a curly-brace syntax it cannot collide with ADK's own
# instruction templating (`inject_session_state` treats any run of `{`/`}` as a
# state variable and raises KeyError for an unknown one, which would crash
# while rendering the very instruction that documents the syntax).
_CITATION_RE = re.compile(r"\[\^([A-Za-z0-9_.-]+)\]")

# Tools whose citable text lives in the function CALL arguments rather than in
# the response. `draft_factcheck_response` returns only a verdict, and reading
# the call keeps a proposal the validation gate REJECTED reviewable -- a
# proofreader should be able to critique pre-verification prose too.
_BODY_FROM_CALL = frozenset({_DRAFT_TOOL_NAME})


# Response keys that can carry a tool result's prose, in priority order.
#
# Deliberately a chain rather than one key per tool: the SAME sub-agent returns
# either shape. `ai_investigator`/`ai_verifier` normally return
# {content, sources}, but whenever Gemini omits grounding metadata their
# after-model callback leaves the raw text alone and it arrives as ADK's
# {result: ...} wrapping instead (the `AdkFallbackResp` documented in
# src/lib/adk.ts). Keying on the tool name made a complete verification report
# uncitable for exactly that reason -- see trace cdfa394f. Proofreaders always
# use `result`.
_BODY_KEYS = ("content", "result")

# Never part of the quoted body: our own citation bookkeeping.
_CITATION_FIELDS = ("cite_as", "cite_hint")


# Cap on the call-id part of a citation id. Gemini supplies its own short
# function-call ids (8 characters, e.g. `ygxikp2o`), which pass through whole.
# The cap is for the other case: when the model supplies no id, ADK generates
# `adk-<uuid4>` (`populate_client_function_call_id`), and a 32-hex-digit tail
# would be 40 characters for the writer to copy without a mistake.
_MAX_CALL_ID_CHARS = 8


def _citation_id(
    tool_name: Optional[str], function_call_id: Optional[str]
) -> Optional[str]:
    """The footnote id for one tool call, e.g. `verifier-ygxikp2o`.

    Derived from the call id so that the call and its response -- which share
    that id -- address the same citation, and so that two calls issued in
    parallel cannot collide (counting them would).

    The tool name is kept in front on purpose: an id on its own tells the
    writer nothing about what it points at, and citing the wrong id would
    resolve *successfully* to the wrong content, which is far worse than not
    resolving. The `adk-` prefix is dropped and punctuation removed for the
    same reason -- what is left is the part that actually distinguishes calls.
    """
    if not tool_name or not function_call_id:
        return None
    suffix = "".join(c for c in function_call_id.removeprefix("adk-") if c.isalnum())
    return f"{tool_name}-{suffix[:_MAX_CALL_ID_CHARS]}" if suffix else None


def attach_citation(
    tool: BaseTool, response: Any, tool_context: CallbackContext
) -> Any:
    """Stamp a tool result with the footnote id that lets the writer cite it.

    Called from ai_writer's after_tool callback for every tool. A non-dict
    response is wrapped as `{"result": ...}`, which is what ADK would have done
    anyway, so the shape reaching the frontend is unchanged apart from the two
    new fields.

    Error payloads are left alone -- there is nothing worth forwarding in them,
    and offering an id would invite the writer to hand a failure to a
    proofreader as if it were evidence.
    """
    payload = response if isinstance(response, dict) else {"result": response}
    if "error" in payload:
        return payload
    cite_id = _citation_id(tool.name, tool_context.function_call_id)
    if not cite_id:
        return payload
    marker = f"[^{cite_id}]"
    payload["cite_as"] = marker
    payload["cite_hint"] = (
        f"To let a sub-agent read this result in full, write {marker} in its `request`."
    )
    return payload


class _CitableIndex(NamedTuple):
    """What one walk of the writer's event history found.

    `blocks` is what can be cited; `called` and `responded` exist only so a
    failure can say what actually happened to an id instead of "no such thing".
    """

    blocks: dict
    called: set
    responded: set


def _citable_index(tool_context: CallbackContext) -> _CitableIndex:
    """Index the writer's event history by citation id.

    `blocks` maps citation id to text, in the order the results appeared in the
    conversation. Chronological order is what lets a request read naturally
    without any per-type ranking rule: the article is fetched first, research
    follows, the draft comes last.

    A finished result is keyed by the `cite_as` its own payload carries, read
    back rather than recomputed, because that string is exactly what the writer
    was handed and will copy. Recomputing it would desynchronize the moment the
    id formula changes: a session resumed across such a change would have the
    writer citing strings that the new formula no longer produces.

    `called` and `responded`, which exist only for diagnosing a failure, are
    keyed by the *derived* id instead. They have to be: a call that has not
    returned yet carries no `cite_as` at all, so the derived id is the only name
    it has -- and it is necessarily a name the current formula produced, which is
    also the shape the writer would construct if it tried to cite its own
    in-flight sibling. The two schemes never need to agree because they cover
    disjoint populations: payload ids name what came back, derived ids name what
    has not.
    """
    blocks: dict = {}
    # Part id -> function_call, so a response can reach its own call arguments.
    calls: dict = {}
    called: set = set()
    responded: set = set()
    for event in tool_context.session.events:
        content = event.content
        if not content or not content.parts:
            continue
        for part in content.parts:
            fc = part.function_call
            if fc:
                if fc.id:
                    calls[fc.id] = fc
                pending_id = _citation_id(fc.name, fc.id)
                if pending_id:
                    called.add(pending_id)
                continue

            fr = part.function_response
            if not fr:
                continue
            derived_id = _citation_id(fr.name, fr.id)
            if derived_id:
                responded.add(derived_id)
            response = fr.response
            if not isinstance(response, dict) or "error" in response:
                continue
            # The id the writer was handed, read back rather than recomputed --
            # see the docstring. Read liberally, and deliberately NOT checked
            # against `_CITATION_RE`: that grammar can change just as the id
            # formula can, and an id stored under an older one is still the exact
            # string the writer copies out of the payload. Validating against
            # today's grammar would reintroduce the version coupling this avoids.
            #
            # Nothing unsafe can come of honouring it. `attach_citation`
            # overwrites `cite_as` on every payload it stamps, error payloads are
            # skipped above, and a block is tagged with the id the writer actually
            # cited -- which came out of the marker scan, so its character set is
            # already bounded.
            #
            # The fallback covers events predating citations. Inert in practice:
            # the writer was never handed an id for those and cannot see part ids,
            # so it has nothing to cite them by.
            stored = response.get("cite_as")
            cite_id = (
                stored.strip().removeprefix("[^").removesuffix("]")
                if isinstance(stored, str) and stored.strip()
                else derived_id
            )
            if not cite_id or cite_id in blocks:
                continue

            if fr.name in _BODY_FROM_CALL:
                # The proposal text lives in the CALL arguments, so that a draft
                # the validation gate REJECTED is still reviewable. Reached from
                # the response side so a proposal only becomes citable once it
                # has actually come back, same as everything else.
                call = calls.get(fr.id)
                call_text = ((call.args or {}) if call else {}).get("text")
                if isinstance(call_text, str) and call_text.strip():
                    blocks[cite_id] = call_text
                continue

            if fr.name == _ARTICLE_TOOL_NAME:
                # Only the message text, and no JSON fallback if it is missing:
                # the rest of the payload -- existing fact-check responses, reply
                # counts, popularity -- would prime a proofreader with other
                # people's verdicts on the very thing we ask it to judge.
                article_text = (response.get("article") or {}).get("text")
                if isinstance(article_text, str) and article_text.strip():
                    blocks[cite_id] = article_text
                continue

            for key in _BODY_KEYS:
                value = response.get(key)
                if isinstance(value, str) and value.strip():
                    blocks[cite_id] = value
                    break
            else:
                if any(key in response for key in _BODY_KEYS):
                    # A prose-carrying tool that came back blank. Quoting the
                    # empty envelope would look like content; leaving it
                    # uncitable cancels the call and tells the writer to re-run
                    # the tool, which is the real fix.
                    continue
                # Some other tool's structured payload. Quoting it whole beats
                # refusing to resolve an id we handed out ourselves.
                blocks[cite_id] = json.dumps(
                    {k: v for k, v in response.items() if k not in _CITATION_FIELDS},
                    ensure_ascii=False,
                )
    return _CitableIndex(blocks, called, responded)


def _render_block(cite_id: str, body: str) -> str:
    """One citation definition: the id *is* the tag name, so the marker and the
    delimiters are the same string and cannot drift apart.

    That also makes the closing delimiter unguessable, so untrusted message
    text cannot break out of its own block; escaping it as well costs nothing.
    """
    closing = f"</{cite_id}>"
    escaped = body.replace(closing, closing.replace("</", "<\\/"))
    return f"<{cite_id}>\n{escaped}\n</{cite_id}>"


def resolve_citations(
    tool: BaseTool, args: dict, tool_context: CallbackContext
) -> Optional[dict]:
    """before_tool_callback for ai_writer.

    Rewrites `request` so every `[^id]` the writer cited is backed by the real
    text, hoisted above the prose as a delimited block. See the module
    docstring for why a stateless AgentTool call leaves a bare back-reference
    dangling, and why the text is hoisted rather than substituted in place.

    If ANY citation cannot be resolved, the call is **not made**: returning a
    truthy value from a before_tool_callback makes ADK use it as the tool
    response without invoking the tool, so the writer gets a correction instead
    of a sub-agent reviewing content with a hole in it. Aborting on a single bad
    citation is deliberate -- a proofreader handed the draft but not the
    evidence produced exactly the dead review round this replaced, and it costs
    four sub-agent calls to find out.
    """
    if tool.name not in _CITING_TOOL_NAMES:
        return None
    request = args.get("request")
    if not isinstance(request, str) or "[^" not in request:
        return None

    index = _citable_index(tool_context)
    cited = set()
    problems = []

    for match in _CITATION_RE.finditer(request):
        cite_id = match.group(1)
        if cite_id in index.blocks:
            cited.add(cite_id)
        else:
            problems.append(f"{match.group()} -- {_why_unresolvable(cite_id, index)}")

    if problems:
        return {
            "error": "unresolved_citation",
            "message": (
                f"[SYSTEM] {tool.name} was NOT called, because "
                f"{'a citation' if len(problems) == 1 else 'some citations'} in your "
                f"`request` could not be resolved: " + " | ".join(problems) + " "
                "Change the citation(s) first -- re-sending this same request "
                "will be cancelled again."
            ),
        }

    if cited:
        # Blocks are keyed in conversation order, so iterating the index (not
        # the citations) yields 原文 -> 查證 -> 草稿 without a ranking rule, and
        # an id cited twice still produces one block.
        preamble = "\n\n".join(
            _render_block(cite_id, index.blocks[cite_id])
            for cite_id in index.blocks
            if cite_id in cited
        )
        args["request"] = f"{preamble}\n\n---\n\n{request}"
    return None


def _why_unresolvable(cite_id: str, index: _CitableIndex) -> str:
    """Why one citation failed, in terms the writer can act on.

    The first case is the one worth distinguishing: the writer sometimes fans
    out a research call and the proofreaders that need to read it in the SAME
    turn, then cites its sibling -- Gemini emits all the calls in one completion
    so it already knows the id it just assigned. That result does not exist yet
    when this callback runs, and telling the writer "no such id" would send it
    hunting for a typo instead of splitting the turn.
    """
    if cite_id in index.called and cite_id not in index.responded:
        return (
            "that call has not returned yet, so there is nothing to quote. A citation can "
            "only refer to a result you have ALREADY received; if you issued that call in "
            "this same turn, wait for its result and cite it in a LATER turn"
        )
    if cite_id in index.responded:
        return (
            "that call returned an error or had no readable content, so there is nothing "
            "to quote; re-run it and cite the new result"
        )
    available = ", ".join(index.blocks) if index.blocks else "none yet"
    return f"no tool result has that id. Citable results: {available}"
