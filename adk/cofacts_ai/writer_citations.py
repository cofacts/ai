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
  request as a delimited block. The marker stays where the writer put it.

Hoisting rather than substituting is deliberate: a long rumor spliced into the
middle of a sentence reads as an interruption, two adjacent markers expand into
one indistinguishable blob, and where the writer happens to place a marker
should not change what the sub-agent ends up receiving.

See ``docs/decisions/20260722-subagent-context-citations.md`` for why this
shape was chosen over session state, artifacts and a prose-marker convention.
"""

import json
import re
from typing import Any, Optional

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


def _article_text(response: dict) -> Any:
    # Only the message text. The rest of the payload -- existing fact-check
    # responses, reply counts, popularity -- would prime a proofreader with
    # other people's verdicts on the very thing we are asking it to judge.
    return (response.get("article") or {}).get("text")


def _grounded_content(response: dict) -> Any:
    return response.get("content")


def _plain_result(response: dict) -> Any:
    return response.get("result")


_BODY_EXTRACTORS = {
    _ARTICLE_TOOL_NAME: _article_text,
    AI_INVESTIGATOR_NAME: _grounded_content,
    AI_VERIFIER_NAME: _grounded_content,
    **{name: _plain_result for name in AI_PROOFREADER_NAMES},
}


def _citation_id(
    tool_name: Optional[str], function_call_id: Optional[str]
) -> Optional[str]:
    """The footnote id for one tool call, e.g. `verifier-ab12cd`.

    Derived from the call id so that the call and its response -- which share
    that id -- address the same citation, and so that two calls issued in
    parallel cannot collide (counting them would).

    The tool name is kept in front on purpose: a bare uuid tells the writer
    nothing about what it points at, and citing the wrong id would resolve
    *successfully* to the wrong content, which is far worse than not resolving.
    """
    if not tool_name or not function_call_id:
        return None
    suffix = "".join(c for c in function_call_id.removeprefix("adk-") if c.isalnum())
    return f"{tool_name}-{suffix[:6]}" if suffix else None


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


def _citable_blocks(tool_context: CallbackContext) -> dict:
    """Every citable tool result so far, as {citation id: text}, in the order
    the results appeared in the conversation.

    Chronological order is what lets a request read naturally without any
    per-type ranking rule: the article is fetched first, research follows, the
    draft comes last.

    Ids are derived from the stored event, never read back from the response's
    own `cite_as`. That keeps sessions recorded before citations existed fully
    resolvable, and means untrusted payload content can never claim an id.
    """
    blocks: dict = {}
    for event in tool_context.session.events:
        content = event.content
        if not content or not content.parts:
            continue
        for part in content.parts:
            fc = part.function_call
            if fc and fc.name in _BODY_FROM_CALL:
                call_id = _citation_id(fc.name, fc.id)
                call_text = (fc.args or {}).get("text")
                if call_id and call_text and call_id not in blocks:
                    blocks[call_id] = call_text
                continue

            fr = part.function_response
            if not fr or fr.name in _BODY_FROM_CALL:
                continue
            response = fr.response
            if not isinstance(response, dict) or "error" in response:
                continue
            cite_id = _citation_id(fr.name, fr.id)
            if not cite_id or cite_id in blocks:
                continue
            extract = _BODY_EXTRACTORS.get(fr.name)
            text = (
                extract(response)
                if extract
                else json.dumps(response, ensure_ascii=False)
            )
            if text:
                blocks[cite_id] = text if isinstance(text, str) else str(text)
    return blocks


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

    An id that matches nothing is replaced with an explicit `[SYSTEM: ...]`
    note listing what is actually available, so a mistake is visible in the
    forwarded request instead of failing silently; the proofreaders' own
    report-back protocol is the safety net if the writer forgets to cite
    anything at all.
    """
    if tool.name not in _CITING_TOOL_NAMES:
        return None
    request = args.get("request")
    if not isinstance(request, str) or "[^" not in request:
        return None

    blocks = _citable_blocks(tool_context)
    cited = set()

    def _check(match):
        cite_id = match.group(1)
        if cite_id in blocks:
            cited.add(cite_id)
            return match.group()
        available = ", ".join(blocks) if blocks else "none"
        return (
            f"[SYSTEM: {match.group()} matches no tool result in this conversation; "
            f"citable results are: {available}]"
        )

    # One pass over the original request only. Hoisted text is never rescanned,
    # so a citation-looking string inside a message or a draft stays literal.
    new_request = _CITATION_RE.sub(_check, request)

    if cited:
        preamble = "\n\n".join(
            _render_block(cite_id, blocks[cite_id])
            for cite_id in blocks
            if cite_id in cited
        )
        new_request = f"{preamble}\n\n---\n\n{new_request}"

    if new_request != request:
        args["request"] = new_request
    return None
