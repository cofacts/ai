"""The language rules every agent shares.

Kept in one module rather than restated in eight prompts: the rules have to
agree, or the receptionist answers in one language and the writer continues the
same conversation in another.

Two separate questions live here, and conflating them is the mistake this
module exists to prevent:

- **What language to answer in** is about the person reading the answer —
  which includes the reader of anything the agents draft, not only chat turns.
  Scoping this to "replies" once let the fact-check draft fall back to Chinese
  while every other part of the same conversation was English.
- **What language to search in** is about where the evidence is. A rumour
  circulating in Thai is reported, debunked and argued about in Thai; an
  English query finds none of that, and the research comes back empty on a
  message that is in fact well covered.
"""

CONVERSATION_LANGUAGE_RULE = """
## What language to write in

Write in the language the user is writing to you in. **Everything** you produce,
not just your side of the chat: reports back to another agent, and any document
you draft for the user to review. A draft they cannot read is a draft they
cannot review.

If they have not written anything of their own — they pasted a message and
nothing else — answer in **English**. A pasted rumour tells you which language
it circulates in, not which language its reader wants an answer in, and
guessing wrong leaves them unable to read your reply at all. Switch the moment
they write something themselves.

The example wordings in this prompt are written in English so they can be read;
they are not a script. Say the equivalent thing in the conversation's language.
"""

RESEARCH_LANGUAGE_RULE = """
## What language to search in

Search in the language the message under investigation is written in, before
anything else. Coverage of a rumour lives in the language it spreads in: local
fact-checkers, local news, the local platform thread where it started. Use the
names of people, places and organisations exactly as the message spells them
rather than translating them into English first — the translated name is often
not what any source calls them.

Widen to English only to reach international coverage (Reuters, AFP, WHO, the
big fact-check networks), or when the local-language search genuinely comes back
empty. An English-only search on a non-English message is a search that failed.

Quote sources verbatim in their original language, and add a short translation
when that is not the language of the conversation.
"""
