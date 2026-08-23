# Hook-first attribution — Phase 0 evidence

Mission `coo:825`, objective `coo:825.f9v5`.

This records the contract/conformance foundation only. It does not enable a
pre/post hook, local ledger, snapshot persistence, `sync-changes`, or any
delivery behavior change.

## Connector classification

| Connector | Classification | Fixture-backed evidence | Why it is not paired |
| --- | --- | --- | --- |
| Claude | `post-only` | `PostToolUse` write: session, cwd, tool, direct path | No recorded matching pre payload with a stable native call id. |
| Codex | `post-only` | Separate `PreToolUse` and `PostToolUse` payloads: session, turn, call, cwd, tool | The samples are different calls; `apply_patch` completion exposes no direct path. |
| Cursor | `post-only` | Separate pre/post payloads: conversation, cwd, call, tool; post has direct path | The samples have different native call ids. |
| Antigravity | `unsupported` | First-party `PreToolUse` payload: conversation, workspace, tool | No completion payload or empirical `agy` hook execution. |
| Pi | `unsupported` | Extension `tool_call`: session, cwd, tool, call | No matching completion callback was recorded. |
| OpenCode | `post-only` | Completed control-plane tool part: session, cwd, part, call, tool, status | No matching in-progress frame was recorded. |

The `mutation-window` fixture runner checks these claims directly and rejects a
descriptor whose declared classification differs from its fixture. This makes
the absence of a pair executable evidence rather than prose. No connector is
currently permitted to install a paired hook.

## Snapshot benchmark

Run locally on 2026-08-22 using synthetic Git repositories with untracked
TypeScript files. Each measurement is one cold-ish process/run and is a sizing
signal, not a latency SLO.

| Repository | Files | Declared-path stat | `git status --porcelain=v2 -uall` | Filesystem directory walk |
| --- | ---: | ---: | ---: | ---: |
| Small | 100 | 0.060 ms | 14.548 ms | 1.829 ms |
| Medium | 5,000 | 0.032 ms | 20.744 ms | 5.749 ms |
| Large | 25,000 | 0.045 ms | 42.893 ms | 18.454 ms |

Direct-path snapshots are the default for native write tools: their cost does
not scale with repository size. Shell and unknown mutation tools need a
repository provider, but Phase 3 must impose a bounded local timeout and record
incomplete/overlap health instead of blocking the harness. The benchmark also
supports retaining a no-VCS filesystem provider for later work; it is faster in
this synthetic case but needs the same ignore and privacy rules.

## Failure and privacy boundary

- Resolve objective/session scope before logging, spawning, or filesystem work.
  Missing or ambiguous scope records no attribution and never falls back to a
  most-recent mission.
- Hook work is local-only, bounded, and best-effort. Timeout, malformed payload,
  missing post-hook, or snapshot failure must fail toward the harness and later
  report health rather than block a delivery.
- Adapters make no database or network call. The future CLI-owned sync sends
  metadata only.
- Never retain or transmit file contents, patches/diffs, raw commands, tool
  output, transcript paths, environment values, or file fingerprints. Review
  records may contain normalized repository-relative paths and bounded quality
  metadata only.
- `window_observed` is not exclusive authorship. Direct native edit paths can be
  high confidence; overlapping shell/user activity remains explicitly observed
  window evidence.

## Phase-0 exit decision

The exit criterion is met: all six connectors are explicitly classified from
fixtures and their classifications are visible in generated connector pages,
the matrix, and the compiled catalog. The expected first paired adapters
(Claude, Codex, Cursor) remain blocked on real matching payload pairs; Phase 3
must not promote them until those recordings exist.
