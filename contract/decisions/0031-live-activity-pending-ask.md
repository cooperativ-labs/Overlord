# ADR 0031: The Live Activity payload carries one bounded pending-ask line

- Date: 2026-09-27
- Status: accepted
- Contract version: 149
- Supersedes: none
- Origin: contract v149 (coo:1083), backfilled 2026-11

## Context

Live Activity payloads excluded all question text, so the watch and lock-screen card could not say what the agent was waiting for.

## Decision

`content-state.pendingAsk` carries the newest unanswered, unseen ask (at most three days old) on a still-executing objective of the account's assigned missions, with the question markdown-stripped to one line of at most 140 characters. Answer options, transcripts, objective instructions and event payloads stay excluded, and standard push notifications still carry no question text.

## Consequences

- Asking, answering and marking the question seen are dispatch transitions.

## Alternatives considered

Not recorded.
