# ADR 0029: Agent-created work requires deliberate project routing

- Date: 2026-09-11
- Status: accepted
- Contract version: 141
- Supersedes: none
- Origin: contract v141 (coo:981), backfilled 2026-11

## Context

Protocol creation inferred a project from the working directory and fell back to the inbox, producing accidental inbox submissions.

## Decision

Protocol `create`, `prompt` and `record-work` never infer a project from the current directory or discovery. A normal creation names `--project-id` (MCP `projectId`); only non-executing `create` may instead state `--unassigned-to-project` (alias `--inbox`; MCP `unassignedToProject: true`) to create an account-owned inbox item. `prompt` and `record-work` reject an omitted project.

## Consequences

- Intentional unassigned capture is kept.

## Alternatives considered

- Inferring the project from the working directory (the previous behaviour): rejected because it caused accidental inbox submissions.
