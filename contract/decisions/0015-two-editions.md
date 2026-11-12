# ADR 0015: Ship two first-class editions, Local and Cloud, under one contract

- Date: 2026-06-26
- Status: accepted
- Contract version: 0.55-draft
- Supersedes: none
- Origin: foundational; first recorded in the contract at 0.55-draft (no change summary explains it), backfilled 2026-11

## Context

Overlord runs on a single machine with SQLite and as a hosted control plane with Postgres, and the same desktop, web, CLI and execution-target clients talk to both.

## Decision

There are two editions: Overlord Local (default; the desktop shell supervises a loopback backend over SQLite, with no account or network dependency) and Overlord Cloud (additive; the backend and database are a hosted control plane reached over HTTPS). Both share the REST, protocol and realtime contract; only `backend_url` and authentication differ. A change for Cloud must never regress Local, and any surface that differs by edition says so explicitly in the contract.

## Consequences

- Database invariants and migrations exist in both dialects.
- Cloud-only surfaces (for example the assistant conversation routes) answer explicitly on Local rather than disappearing.

## Alternatives considered

Not recorded.
