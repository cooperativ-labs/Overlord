# ADR 0095: Point Claude Code's temp root at the checkout's `.overlord/tmp/harness/`

Date: 2026-11-21
Status: accepted
Contract version: [179.11.0](../CHANGELOG.md#179110---2026-11-21)
Supersedes: none (extends ADR 0085)
Contract impact: minor

## Context

Launched agents already receive `TMPDIR`, `TMP`, `TEMP` and `OVERLORD_TMPDIR` pointing at a
per-launch directory under `.overlord/tmp/sessions/`. Codex and the other harnesses honor
`TMPDIR`. Claude Code does not: it reads only `CLAUDE_CODE_TMPDIR` and otherwise writes its
scratchpads, background task output and messaging sockets under the system `/tmp/claude-<uid>/`
and `/tmp/cc-socks/`. That tree grows without bound and Overlord's `.overlord/tmp` pruning never
sees it.

Claude Code binds `<CLAUDE_CODE_TMPDIR>/cc-socks/<pid>.sock`. Unix socket paths are limited to
104 bytes on macOS. If the path is too long, Claude starts without its messaging socket and does
not report an error. The per-launch `sessions/<objective>-<request>/` directory is usually too
long for that socket.

## Decision

Every launch exports `CLAUDE_CODE_TMPDIR=<checkout>/.overlord/tmp/harness`. The export applies to
all agents, so a Claude process started from another harness also uses it. The launcher creates
the directory with mode 0700, which Claude requires. The variable is omitted when the
directory path plus `/cc-socks/<7-digit pid>.sock` would exceed the socket limit. Claude then
keeps its default location.

`harness/` is shared by concurrent Claude sessions in the checkout. Explicit `ovld prune`
without `--force` keeps that directory and removes only files older than the `.overlord/tmp`
retention period. The launch-time stale prune never removes socket files, because a socket's
modification time records when it was bound, not whether a process still uses it.

## Consequences

Claude Code temp files from Overlord-launched sessions stay in the repository's ignored
`.overlord/tmp/` and age out with its existing retention. Claude sessions that were not launched
by Overlord are unchanged. Checkouts whose path exceeds roughly 60 bytes still use `/tmp`.

## Alternatives considered

- Use the per-launch session scratch directory. Deleting it would clean up each session, but its
  path is too long for Claude's socket.
- Set `XDG_RUNTIME_DIR` separately for the sockets. That variable means more to other tools, and
  Claude would still write its other files to `/tmp`.
- Add a separate prune for `/tmp/claude-<uid>`. That would delete files Overlord does not own,
  including those of sessions it did not launch.
