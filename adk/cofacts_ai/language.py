"""The language rules every agent shares.

Kept in one module rather than restated in eight prompts: the rules have to
agree, or the receptionist answers in one language and the writer continues the
same conversation in another.

Two separate questions live here, and conflating them is a mistake this module
exists to prevent:

- **What language to write in** is about the person reading the answer, and on
  this branch it is pinned (see below).
- **What language to search in** is about where the evidence is, and is not
  pinned. A rumour circulating in Thai is reported, debunked and argued about
  in Thai; an English query finds none of that, and the research comes back
  empty on a message that is in fact well covered.

DEMO BRANCH: the output language is pinned to English rather than inferred.

It used to be inferred — "write in the language the user writes in, English if
they have written nothing of their own" — which is the nicer behaviour and the
one to restore for real use. It was withdrawn because it is unreliable exactly
where this branch needs it. At a booth the common input is a pasted link and no
words at all, so the "written nothing of their own" branch is the one that runs,
and it does not run consistently: three requests with the same URL and
near-identical search results (Langfuse traces 8bf9de42, 733f64ab, de8234e9)
produced English, English, then Traditional Chinese.

Worth recording what that was NOT, because both are tempting and both are
wrong. It was not the prompt being diluted by Chinese: the system instruction
was 100% English and byte-identical across the calls, and the rule sat at
character 64 of it. It was not the Chinese search results crowding it out
either — the same 333 Han characters of unrelated Cofacts articles were in
front of the model on the two runs that answered in English. What is left is
run-to-run variance on a judgement call, and a judgement call is not something
prompt wording fixes. Removing the judgement removes the variance.
"""

CONVERSATION_LANGUAGE_RULE = """
## What language to write in

**Write everything in English.** Every reply, every question you ask, every
report to another agent, and every document you draft for the user to review.

This holds whatever language the material around you is in. Cofacts is a
Taiwanese database, so the messages you search, the articles you read and the
transcripts you are given are mostly Traditional Chinese — that is the language
of the data, not the language you write in. Quote a message's own words
verbatim when the user needs to recognise which message it is, and write your
own words around the quote in English.
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

Quote sources verbatim in their original language, and add a short English
translation alongside.
"""
