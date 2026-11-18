# ADR 0081: Ledger-ranked project item discovery

Status: accepted
Date: 2026-11-18

## Decision

Add project-items and overlord_project_items as live-session, mission:read discovery
surfaces, scoped to the attached mission project. Exclude own mission by default.
Read accepted live open item rows only; draft reports have no join into the relation.
Attach adds an exact count and conditional CLI/MCP instructions, never candidates.

Scan at most 2,000 newest-delivery rows, rank by the live objective ledger plus
explicit repo-relative paths, then page compact results (20 default, 100 maximum).
Text query and kind filter within that bounded scan. The version-1 response exposes
scan truncation, ledger size and capture gaps; golden vectors pin the new algorithm.
No existing seen algorithm, item close, immutable receipt/report, draft sealing or
narrative publication behavior changes. No schema migration is needed.

## Alternatives and consequences

A search index adds write amplification and vocabulary changes without helping the
current scale. Unbounded lists waste context; attach candidates go stale before work.
The bounded ranked command keeps discovery cheap and reviewable. Text-only items may
rank poorly: substring filtering and newest-first fill remain available. Explicit
paths augment ranking, retaining unmatched candidates. Counts are exact but ranked
page totals describe only the bounded filtered scan. Offset pages restart after writes.

This is an additive minor contract change across core, backend, CLI, MCP and connectors.
Publication's ended-session exception does not grant discovery authority. Existing
coo:1297 coordinated release gates remain mandatory; nothing here proves deployment.
