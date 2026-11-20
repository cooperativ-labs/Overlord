# ADR 0084 — Follow-up in a continuing runner-launched harness

- Status: Accepted
- Date: 2026-11-20

Delivery closes the protocol session. A runner-launched harness can stay open, and
its environment and launch script still identify the initial execution request.

Explicit follow-up uses `resume-follow-up` to reopen the same objective and obtain a
new key. The launch request records the initial session for provenance. A pinned
attach to a completed objective is refused. The delivered key remains invalid for
execution updates. The CLI receives the exact resume command and MCP receives
directions to ask the user to start follow-up in Overlord.

The launcher keeps a private scratch path for the harness. Automatic cleanup can
expire stale files in it while retaining the directory, even between protocol
sessions. Explicit project temporary cleanup can remove it. The CLI can recreate a
missing inherited scratch directory on resume for a harness launched before this fix.
