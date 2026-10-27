"""
Cofacts' stored page text, carried from the writer to the verifier.

An article or reply already carries `hyperlinks`: page text Cofacts' own
url-resolver crawled at `fetchedAt`. When the verifier's live fetch fails, that
copy is the fallback ``inject_resolved_url_content`` injects as
``[ARCHIVED PAGE]``. The data lives in the writer's session -- in the
``function_response`` events of its Cofacts tool calls -- and the verifier runs
in a different one, so it has to be carried across.

It rides inside the verifier's ``request``, in a delimited block:

- ``stage_archived_links`` (writer, ``before_tool_callback``) walks the writer's
  event history, keeps the hyperlinks whose URL the request mentions, and
  appends them as JSON.
- ``unpack_archived_links`` (verifier, first ``before_model_callback``) parses
  the block into ``ARCHIVED_LINKS_STATE_KEY`` and removes it, so the model only
  ever sees the archived text the way ``inject_resolved_url_content`` frames
  it.

Why not the obvious alternatives:

- ``temp:`` state in the writer does not reach the verifier at all.
  ``AgentTool`` seeds the child session through ``create_session(state=...)``,
  which drops every ``temp:`` key; and across turns ``temp:`` is never
  persisted. Hyperlinks harvested into it were therefore never seen.
- Non-``temp:`` state would cross, but it is persisted with every event's
  ``state_delta``, so whole page texts would pile up in the session database.
- Re-saving them as artifacts duplicates what the session events already hold,
  and pays a write for every hyperlink of every Cofacts call when most are
  never needed: the live fetch usually succeeds.

Editing ``args`` is safe for the writer: ADK hands callbacks a deep copy of the
function call's arguments, so the block never enters the writer's own history.
It does show up in the tool call's trace, which is the point -- what was
carried is visible where the call is.

Decision record: ``docs/decisions/20260722-url-resolver-verifier-prefetch.md``.
"""

import json
import re
import secrets
from typing import Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.tools.base_tool import BaseTool

from .agent_names import AI_VERIFIER_NAME
from .tools import get_single_cofacts_article, search_cofacts_database
from .writer_citations import strip_hoisted_blocks

# What unpack_archived_links hands to inject_resolved_url_content, both inside
# the verifier's own child session: {url: {"summary", "title", "fetchedAt"}}.
# `temp:` is right here, unlike in the writer: writer and reader share one
# session, and one AgentTool call is that session's whole life.
ARCHIVED_LINKS_STATE_KEY = "temp:cofacts_archived_links"

_HYPERLINK_TOOL_NAMES = frozenset(
    {get_single_cofacts_article.__name__, search_cofacts_database.__name__}
)

# The tag carries a per-process random suffix, so text in the request -- the
# suspicious message itself is quoted there -- cannot forge a block and hand the
# verifier "archived" text of its choosing. Writer and verifier run in the same
# process, so both ends agree on it.
_TAG = f"cofacts-archived-links-{secrets.token_hex(8)}"
_BLOCK_RE = re.compile(rf"\n*<{_TAG}>\n(.*?)\n</{_TAG}>", re.DOTALL)


def _collect_hyperlinks(node: object, found: dict[str, dict]) -> None:
    """Gather usable `hyperlinks` entries from one Cofacts tool response.

    Walks the payload rather than indexing fixed paths, because the two tools
    nest the same field differently -- `get_single_cofacts_article` under
    `article.hyperlinks` plus one list per reply, `search_cofacts_database`
    under `data.edges[].node.hyperlinks`.

    Only entries with usable text are kept: a non-empty summary and no `error`.
    A hyperlink whose crawl failed carries no summary worth falling back to.
    `status` is not checked -- it is a String in rumors-api, and most successful
    crawls carry "0" or null.
    """
    if isinstance(node, list):
        for item in node:
            _collect_hyperlinks(item, found)
        return
    if not isinstance(node, dict):
        return
    links = node.get("hyperlinks")
    if isinstance(links, list):
        for link in links:
            if not isinstance(link, dict):
                continue
            url = link.get("url")
            summary = link.get("summary")
            if not isinstance(url, str) or not isinstance(summary, str):
                continue
            if not summary.strip() or link.get("error"):
                continue
            found[url] = {
                "summary": summary,
                "title": link.get("title"),
                "fetchedAt": link.get("fetchedAt"),
            }
    for value in node.values():
        _collect_hyperlinks(value, found)


def stage_archived_links(
    tool: BaseTool, args: dict, tool_context: CallbackContext
) -> Optional[dict]:
    """before_tool_callback for ai_writer: carry Cofacts' copies to the verifier.

    Only URLs the writer itself wrote are carried: the request minus the
    citation blocks `resolve_citations` hoisted into it, the same text
    `_extract_web_urls` reads on the verifier side. Any other copy could
    never be looked up, and would only make the call's payload larger -- a
    cited search result alone can hold dozens of hyperlinks.

    Always returns None: this never replaces the tool call.
    """
    if tool.name != AI_VERIFIER_NAME:
        return None
    request = args.get("request")
    if not isinstance(request, str):
        return None

    found: dict[str, dict] = {}
    # Chronological, so a later fetch of the same article overwrites an earlier
    # one.
    for event in tool_context.session.events:
        content = event.content
        if not content or not content.parts:
            continue
        for part in content.parts:
            fr = part.function_response
            if fr and fr.name in _HYPERLINK_TOOL_NAMES:
                _collect_hyperlinks(fr.response, found)

    written = strip_hoisted_blocks(request)
    wanted = {url: entry for url, entry in found.items() if url in written}
    if wanted:
        body = json.dumps(wanted, ensure_ascii=False)
        args["request"] = f"{request}\n\n<{_TAG}>\n{body}\n</{_TAG}>"
    return None


def unpack_archived_links(
    callback_context: CallbackContext, llm_request: LlmRequest
) -> None:
    """before_model_callback for ai_verifier: take the staged block back out.

    Must run before every callback that reads the user's text for URLs
    (`inject_youtube_filedata`, `inject_resolved_url_content`), since archived
    page text contains URLs of its own. It runs on every model call because ADK
    rebuilds `llm_request.contents` from session events each time, block
    included.
    """
    found: dict[str, dict] = {}
    for content in llm_request.contents:
        if content.role != "user" or not content.parts:
            continue
        for part in content.parts:
            if not part.text or _TAG not in part.text:
                continue
            for match in _BLOCK_RE.finditer(part.text):
                try:
                    data = json.loads(match.group(1))
                except ValueError:
                    continue
                if isinstance(data, dict):
                    found.update(data)
            part.text = _BLOCK_RE.sub("", part.text)
    callback_context.state[ARCHIVED_LINKS_STATE_KEY] = found
