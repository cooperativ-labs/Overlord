# `.overlord/tmp` pruning strategy

Mission coo:878 · objective coo:878.3dzm

## What exists today

| Mechanism | Where | Behaviour |
|---|---|---|
| Age-based sweep, 7-day retention | `cli/src/project-tmp.ts` `pruneStaleProjectTmp` | Runs on **every** `ovld protocol …` call (`commands.ts`) and on every launch (`launch.ts`). Deletes any entry older than 7 days; empty stale dirs too. |
| Manual nuke | `ovld prune` → `pruneProjectTmpContents` | Deletes everything in `.overlord/tmp`, regardless of age or whether an agent is running. |
| `TMPDIR`/`TMP`/`TEMP`/`OVERLORD_TMPDIR` pinned to `.overlord/tmp` | `terminal-launcher.ts` `tmpEnvFor` | So every tool the agent runs (node compile cache, mkdtemp, etc.) lands in the project tmp, not `/tmp`. |
| Launch artifacts | `launch.ts` | `launch-<mission>-<executionRequestId>.sh` and `objective-<id>.md` / `mission-<id>.md` at the top level. `attach` reads the newest `launch-*.sh` back to recover the channel id (`launch-bootstrap.ts`). |

So "prune regularly" is already automated — the gap is not scheduling, it is **ownership**: nothing knows which files belong to which session, so the sweep must be conservative (7 days) and `ovld prune` must be reckless (everything).

Snapshot of this checkout at the time of writing: 71 entries, dominated by 18 dangling `ovld-session-key-workspace-*-alias` symlinks (Aug 23–27) left by an earlier CLI that has since moved the session-key cache to `~/.overlord/protocol-session-keys/`. They survived the sweep because of a bug (fixed in this objective, see below).

## Bug fixed in this objective

`pruneLeaf` used `statSync`, which follows symlinks → ENOENT on a dangling link → caught → entry skipped forever. Also `rmSync(link, { recursive, force })` resolves the link first and `force` swallows the ENOENT, so even with `lstat` the link stayed. Now: `lstatSync` for age, `unlinkSync` for symlinks. Regression test added. The 18 stale aliases will disappear on the next protocol call once they pass the retention cutoff (the oldest already have).

## Options considered

### A. Agent deletes its own files at `deliver` — **recommended, with one structural change**

The blocker today is that "its own files" is undefined. Fix it by giving each session a private scratch directory:

```
.overlord/tmp/
  launch-coo-878-<requestId>.sh       # launch plumbing, top level (attach recovery reads it)
  objective-coo-878-3dzm.md           # briefing, top level
  sessions/
    coo-878-3dzm-<requestId>/         # TMPDIR / OVERLORD_TMPDIR for this launch only
      node-compile-cache/
      whatever-the-agent-wrote.json
```

- `launch.ts` creates `sessions/<objective>-<requestId>/` and `tmpEnvFor` points `TMPDIR`/`TMP`/`TEMP`/`OVERLORD_TMPDIR` at it. Agents and their tools already honour `TMPDIR`; the skill text already says scratch goes under `.overlord/tmp`, so instruct it to use `$OVERLORD_TMPDIR`.
- `deliver` (the block in `commands.ts` that runs `finalizeActiveSession` + `clearCachedSessionKey`) additionally `rm -rf`s **only** `sessions/<own id>/` plus its own `launch-<mission>-<requestId>.sh` and briefing file. It knows the request id from `OVERLORD_EXECUTION_REQUEST_ID` / the active-session record, so this is a single `rmSync` — no scan, no mtime heuristics. Cost: microseconds.
- Concurrency safety is by construction: every path deleted is keyed to the delivering session's own identity. Another objective on the same mission has a different request id; another mission has a different prefix. Nothing time-based is touched at deliver.
- Only delete after `finalized === true` (ledger fully synced), matching the existing rule that a failed sync keeps the binding for `changes` retries — the launch script must still be there for `attach` recovery if the agent has to re-attach.
- Keep the briefing `.md` if the mission has future objectives with `autoAdvance`? Not needed: the next launch writes a fresh one.

### B. Keep the age sweep as the backstop, make it smarter — **recommended alongside A**

The sweep still matters for sessions that crash, get killed, or never deliver. Two refinements:

1. `sessions/<id>/` dirs whose id is **not** present in `~/.overlord/active-objective-sessions/` can be dropped after a short window (proposal: 24h instead of 7d). A live session always has a record there; an orphaned dir with no record is safe to drop once it is old enough that a racing launch cannot be mid-write.
2. Top-level unknown files keep the 7-day rule (unchanged).

Optionally have `ovld prune` refuse (or require `--force`) to delete `sessions/<id>/` for ids with a live active-session record, so a human running it mid-fleet does not yank scratch out from under a running agent.

### C. Prune as part of the commit flow — **not recommended**

- `.overlord/tmp` is gitignored; commits never see it, so there is no natural coupling.
- Commits are user-owned and irregular (the skill forbids agents from committing unless asked), so pruning would be both unpredictable and, in a fleet with several agents on one checkout, actively dangerous: a pre-commit hook has no idea which sessions are live.
- A git hook would also need installing per clone; the CLI already runs on every protocol call and every launch, which is a strictly better trigger.

### D. Time-based only (status quo, tune the number) — rejected

Lowering 7d to, say, 24h across the board would delete a long-running session's scratch while it is still in use. Time alone cannot distinguish live from dead.

## Implementation plan — implemented 2026-08-30 (connector 0.3.40)

One deviation from option A: the launch script is **not** removed at deliver, because `attach`/`resume-follow-up` recover the channel and request ids from it on reconnect. It is tiny and the 7-day sweep collects it. Deliver removes the `sessions/<id>/` scratch directory and the briefing `.md`.


1. **Per-session scratch dir** — `launch.ts` + `terminal-launcher.ts` `tmpEnvFor(workingDirectory, sessionScratchDir)`; contract doc for `OVERLORD_TMPDIR` in `packages/contract/src/launch-variables.ts` gains the `sessions/<id>` note; agent-pod path (`OVERLORD_DEVICE_FINGERPRINT` flow) gets the same env.
2. **Deliver-time cleanup** — `commands.ts` deliver block, after `finalized`; new `removeSessionScratch({ workingDirectory, objectiveId, executionRequestId })` in `project-tmp.ts`; tests.
3. **Sweep refinement** — `pruneStaleProjectTmp` learns about `sessions/` + active-session records; 24h orphan window; `ovld prune` live-session guard; tests.
4. **Skill/docs** — `overlord-mission` skill and `docs/src/content/docs/cli.mdx`: "write scratch to `$OVERLORD_TMPDIR`; deliver removes it; nothing else in `.overlord/tmp` is yours".

Steps 1–2 are the payoff; 3–4 are small. Nothing here changes the contract in `CONTRACT.md`; the only cross-module surface is the launch-variable description, which is documentation.
