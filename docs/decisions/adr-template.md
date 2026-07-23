---
# MADR frontmatter. Remove any field you don't use.
status: 'proposed' # proposed | accepted | rejected | deprecated | superseded by YYYYMMDD-short-name
date: YYYY-MM-DD # when the decision was last updated
decision-makers: # people involved in the decision
consulted: # subject-matter experts consulted (two-way communication)
informed: # people kept up to date (one-way communication)
---

# {short title, representative of the solved problem and the chosen solution}

## Context and Problem Statement

{Describe the context and problem in two or three sentences, or as a short story. State the
scope explicitly — which components/connectors are affected (frontend, BFF, ADK agents,
deploy). Link the driving PR/issue.}

<!-- Optional. Remove if no production trace drove this decision. -->

### Langfuse evidence

- [{trace label}](https://langfuse.cofacts.tw/project/cmm0emerr0001qi07eugd0760/traces/{id}) —
  {what the trace showed, and the analysis it led to}

<!-- Optional. -->

## Decision Drivers

- {decision driver / force / concern}

## Considered Options

<!-- Backfilling an old decision? Reconstruct from real sources, not guesswork: the PR
description & comments (pivots surface in review), the git commit log for those commits, and the
Cofacts weekly meeting notes (cofacts/kb, src/meetings/YYYY/). Cite what you find. If no
alternatives were recorded anywhere, trim this section to what shipped rather than inventing options. -->

- {title of option 1}
- {title of option 2}

## Decision Outcome

Chosen option: "{option}", because {justification — meets a k.o. criterion / resolves a
force / comes out best, see below}.

<!-- Optional. -->

### Consequences

- Good, because {positive consequence}
- Bad, because {negative consequence}

<!-- Optional. How compliance with this decision is confirmed: a test, a review, a CI check. -->

## Confirmation

{…}

<!-- Optional. -->

## Pros and Cons of the Options

### {title of option 1}

- Good, because {argument}
- Neutral, because {argument}
- Bad, because {argument}

<!-- Optional. Links to PRs, kb research docs, follow-up decisions, revisit conditions. -->

## More Information

{…}
