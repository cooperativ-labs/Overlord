# ADR 0067: Attach instructions by connection method

- Date: 2026-11-17
- Status: accepted
- Supersedes: none
- Amends: none

## Context

The attach response is the only step every launch path goes through: a local
terminal launch, the local connector MCP shim and the hosted MCP server all call
the same core attach (plan `planning/feature-plans/mission-summary-flow-review-2026-11-17.md`,
decisions D2 and D7). Its `agentInstructions` named `ovld protocol` commands and
flags, which an agent on MCP does not have, and no caller told the backend how it
was connected: every session was stored with `connection_method = 'cli'`.

## Decision

`attach` and `resume-follow-up` accept an optional `--connection-method cli|mcp`.
Both MCP servers send `mcp`. Core selects the wording of the workflow, changed-file,
delivery-evidence and mission-summary rules from it; the rules and limits are the
same in both wordings. `agentInstructions` becomes the first response key and
states that it takes precedence over an installed Overlord skill or plugin, so an
old plugin copy cannot override the server's rules.

A flag was chosen over inferring the method from the request: the local shim
reaches the backend through the CLI over REST, so neither the token nor the route
distinguishes it from a terminal session.

## Impact

Backend protocol route, core attach, hosted MCP and the connector MCP shim change
together. The CLI forwards the flag and documents it. `load-context` and `connect`
are unchanged. No schema migration; `connection_method` is an open text column and
`mcp` is a new value in it.
