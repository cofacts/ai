"""
Symbol references for the writer's stateless sub-agent calls.

``ai_investigator``, ``ai_verifier`` and the four ``ai_proofreader_*`` are each
mounted on the writer as an ``AgentTool``, and every such call starts a fresh,
stateless, single-message session: the sub-agent sees nothing but the
``request`` string of that one call — not the writer's conversation, not a
sibling call made in the same turn, not an earlier call to the same sub-agent.
So a back-reference like 「（同上）」 has no referent, and the writer used to
fan out four parallel proofreader calls with the draft pasted into only the
first (cofacts/ai#117).

This module lets the writer *reference* content instead of retyping it:
``[[message]]``, ``[[message:<articleId>]]``, ``[[draft]]`` and
``[[draft:vN]]`` written into a `request` are replaced with the real text
before the call is dispatched. Expansion reads the writer's OWN event history
(via the public ``ReadonlyContext.session``) rather than session state, so the
sub-agent receives the actual text with zero state writes and zero
``list_sessions`` cost.

See ``docs/decisions/20260722-subagent-context-symbols.md`` for why this shape
was chosen over session state, artifacts and a prose-marker convention.
"""

import re
from typing import Optional

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

# Sub-agents whose `request` argument gets [[draft]]/[[message]] symbols
# expanded before dispatch. All are AgentTools: every call starts a fresh,
# stateless single-message session that sees nothing but this one `request`
# string.
_SYMBOL_EXPANSION_TOOL_NAMES = (
    AI_INVESTIGATOR_NAME,
    AI_VERIFIER_NAME,
    *AI_PROOFREADER_NAMES,
)

# Square brackets, not curly braces: ADK's own instruction templating
# (inject_session_state) treats ANY run of `{`/`}` as a state-variable
# reference and raises KeyError for an unknown one. These symbols are
# explained in ai_writer's own instruction text, so a curly-brace syntax
# would make ADK try to resolve "draft"/"message" as session state while
# rendering that very instruction and crash before the writer ever runs.
_DRAFT_SYMBOL_RE = re.compile(r"\[\[draft(?::v(\d+))?\]\]")
_MESSAGE_SYMBOL_RE = re.compile(r"\[\[message(?::([A-Za-z0-9_-]+))?\]\]")


def _writer_draft_texts(tool_context: CallbackContext) -> list:
    """Every `text` argument the writer has proposed via draft_factcheck_response
    so far this invocation, in submission order (index 0 = first proposal).

    Reads the `text` straight from each call's function-call args, so a
    proposal the tool rejected (failed the claim_sources/verification gate)
    still resolves -- proofreaders can review pre-verification prose too.
    """
    drafts = []
    for event in tool_context.session.events:
        content = event.content
        if not content or not content.parts:
            continue
        for part in content.parts:
            fc = part.function_call
            if fc and fc.name == _DRAFT_TOOL_NAME:
                text = (fc.args or {}).get("text")
                if text:
                    drafts.append(text)
    return drafts


def _writer_article_texts(tool_context: CallbackContext) -> dict:
    """Every Cofacts article the writer has fetched, as {article_id: text},
    ordered least- to most-recently fetched.

    One conversation can cover more than one suspicious message: the user may
    paste a second Cofacts URL to move on to another article, and the writer
    may pull up a related article for comparison. Re-fetching an article moves
    it to the end, so the last entry is always the most recent fetch.
    """
    articles: dict = {}
    for event in tool_context.session.events:
        content = event.content
        if not content or not content.parts:
            continue
        for part in content.parts:
            fr = part.function_response
            if fr and fr.name == _ARTICLE_TOOL_NAME:
                response = fr.response or {}
                article = response.get("article") or {}
                text = article.get("text")
                if text:
                    # Real responses always carry article_id; the positional
                    # fallback keeps bare [[message]] working if that ever
                    # changes. "#" is outside the id pattern, so a fallback
                    # key can never be addressed as [[message:...]].
                    key = (
                        response.get("article_id")
                        or article.get("id")
                        or f"#{len(articles)}"
                    )
                    articles.pop(key, None)
                    articles[key] = text
    return articles


def expand_writer_symbols(
    tool: BaseTool, args: dict, tool_context: CallbackContext
) -> Optional[dict]:
    """before_tool_callback for ai_writer.

    Lets the writer reference its own drafts and the suspicious message by
    symbol -- `[[message]]`, `[[message:<articleId>]]`, `[[draft]]`,
    `[[draft:vN]]` -- in a sub-agent's `request` instead of retyping or
    paraphrasing them ("(same as above)"). See the module docstring for why a
    stateless AgentTool call leaves a bare back-reference dangling.

    Bare `[[draft]]`/`[[message]]` resolve to the most recent of each, since
    that is the task at hand; the indexed forms address an older draft or a
    specific article when a conversation covers more than one.

    An unresolved symbol is replaced with an explicit `[SYSTEM: ...]` marker
    rather than left as literal text or silently dropped, so a mistake is
    visible in the forwarded request instead of failing silently; the
    proofreaders' own report-back protocol is the safety net if this is ever
    bypassed or the writer forgets a symbol entirely.
    """
    if tool.name not in _SYMBOL_EXPANSION_TOOL_NAMES:
        return None
    request = args.get("request")
    if not isinstance(request, str) or "[[" not in request:
        return None

    drafts = None
    articles = None

    def _replace_draft(match):
        nonlocal drafts
        if drafts is None:
            drafts = _writer_draft_texts(tool_context)
        if not drafts:
            return f"[SYSTEM: no draft_factcheck_response proposal exists yet to resolve {match.group()}]"
        version = match.group(1)
        if version is None:
            return drafts[-1]
        index = int(version) - 1
        if not (0 <= index < len(drafts)):
            return (
                f"[SYSTEM: only {len(drafts)} draft_factcheck_response proposal(s) "
                f"exist so far; cannot resolve {match.group()}]"
            )
        return drafts[index]

    def _replace_message(match):
        nonlocal articles
        if articles is None:
            articles = _writer_article_texts(tool_context)
        if not articles:
            return f"[SYSTEM: no get_single_cofacts_article result found to resolve {match.group()}]"
        article_id = match.group(1)
        if article_id is None:
            # Most recently fetched article: a conversation can move on to
            # another suspicious message, and the newest one is the task at
            # hand -- the same "latest wins" reasoning as
            # inject_youtube_filedata in agent.py.
            return next(reversed(articles.values()))
        if article_id not in articles:
            return (
                f"[SYSTEM: article {article_id} was not fetched in this conversation, "
                f"so {match.group()} cannot be resolved; available: {', '.join(articles)}]"
            )
        return articles[article_id]

    new_request = _DRAFT_SYMBOL_RE.sub(_replace_draft, request)
    new_request = _MESSAGE_SYMBOL_RE.sub(_replace_message, new_request)
    if new_request != request:
        args["request"] = new_request
    return None
