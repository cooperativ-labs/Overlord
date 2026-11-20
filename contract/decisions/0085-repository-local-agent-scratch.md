# ADR 0085: Direct agent scratch files to the project checkout

Date: 2026-11-20
Status: accepted
Contract version: [179.0.2](../CHANGELOG.md#17902---2026-11-20)
Supersedes: none
Contract impact: patch

## Context

The launcher exports a per-launch directory under `.overlord/tmp/`. Agents still
choose system temp paths for intermediate files when creating them explicitly.

## Decision

Include repository scratch guidance in the shared attach and resume-follow-up
instructions for CLI and MCP. Prefer the launch-provided `OVERLORD_TMPDIR` when
it is available under the writable checkout’s `.overlord/tmp/`. Otherwise, agents
working in a writable checkout can create and use `.overlord/tmp/` at its root.
Tell agents to pass that directory to tools with system temp defaults.

## Consequences

The guidance covers manual attachments and resumed sessions as well as managed
launches. The existing launch environment, pruning behavior, compact launch
prompt, and protocol response shape remain compatible.

## Alternatives considered

Launch environment variables cover tools that respect them automatically.
Putting the rule in the launch prompt would cover managed launches. The attach
instructions also reach agents that connect from an existing session.
