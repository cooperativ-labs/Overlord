# Bounded repository inspection — coo:1108.zg8m

Phase C, objective 06. Builds on contract v152 (coo:1108.vasc), the durable
conversation services (coo:1108.a1ac), the connections module (coo:1108.zb9x), and
the Phase A target finding (coo:1108.cag9). Codex, Local, provider fallback,
coo:1109, and coo:1110 are out of scope. The chat tool gateway that calls this
service lands in coo:1108.vx29.

## What was built

| Layer | File | Responsibility |
| --- | --- | --- |
| Target | `local-target/git-run.ts` | `runInspectionGit`: no shell, hardened `-c` config and environment, per-call timeout, cancellation, output byte bound, SIGKILL; `neutralizedFilterArgs`; `runGitResult(..., { inspection: true })` for sync reads |
| Target | `local-target/repository-paths.ts` | Relative-path normalization, real-path containment (symlinks), sensitive-path policy plus `OVERLORD_REPOSITORY_READ_EXCLUDE` |
| Target | `local-target/repository-read-git.ts` | Root inspection (HEAD, branch, subdirectory prefix), structured porcelain-v2 status, bounded UTF-8 file read, literal `git grep` search |
| Target | `local-target/current-diff-git.ts` | The one diff: `currentDiffArgs`, `readCurrentDiffGit`, sensitive-section withholding; the commit-message drafter now builds its diff from the same arguments |
| Interface | `local-target/types.ts`, providers | `readCurrentDiff` replaced by the resource-addressed form; `readGitStatus`, `readRepositoryFile`, `searchRepositoryText` added to every provider; removed from the desktop bridge (it was never implemented there) |
| Queue | `local-target-mutations.ts`, `execution-requests.ts` | Queued metadata carries `resourceKey`; the claim resolves that resource instead of the primary; waits are cancellable |
| Runner | `local-target-mutation-runner.ts`, `cli/src/commands.ts` | Resource-addressed calls are rebound to the claim-resolved directory; only read capabilities may be resource-addressed |
| Gateway | `packages/core/service/repository-reads.ts` | Request parsing, execution-target eligibility, resource binding, offline short-circuit, operation-id idempotency and conflict detection, four-read limiter, result mapping with fixed messages |
| Route | `backend/repository-reads.ts`, `backend/index.ts` | `POST /api/projects/:id/repository-reads` (`project:read`); disconnect aborts the wait only. The runner completion route accepts 1 MiB JSON bodies |

Contract: `CONTRACT.md` v152 "Repository-read implementation details", the data DTOs
in `packages/contract/src/chat.ts`, and `contract/components.yaml`.

## Design decisions

- **One diff.** `readCurrentDiff` had no implementation and no caller, so its
  mission-keyed input was replaced rather than kept beside a second diff. The
  commit-message drafter keeps its own output format but builds `git diff` from
  `currentDiffArgs` under the same hardened configuration.
- **The path a read touches is the claim's.** The backend resolves the binding to
  check it exists and is connected, but the runner overwrites `repoPath` with the
  directory the claim resolved for the queued `resourceKey` on that target.
- **Offline before resource.** An unreachable target answers `target_offline`
  without queueing and before any resource lookup.
- **Retries never re-queue.** The queue key hashes the acting workspace user and the
  operation id. Reusing an id for a different read is 409 `operation_conflict`.
- **Target text never reaches the result.** Failures map to fixed messages by code;
  this keeps absolute paths and stderr out of model input.
- **Filtering happens on the target.** Sensitive diff sections and search hits are
  dropped before the result is posted, so their content never crosses the queue.

## Verification

All commands run from the repository root with `TMPDIR=/tmp`.

| Check | Result |
| --- | --- |
| `node --import tsx --test packages/core/service/local-target/repository-read-git.test.ts` (with siblings) | Pass: containment, symlink escape, secrets, binary/invalid UTF-8/oversized, line-range truncation, status classes incl. rename and conflict, subdirectory resources, diff scopes and unborn HEAD, sensitive diff withholding, literal search, hostile repository, timeout, cancellation, output bound |
| `packages/core/service/repository-reads.test.ts` | Pass (8): parsing rejects absolute/escaping paths, real claim resolves `mobile` not `primary`, only read capabilities are queued and none carry a mission, retry reuses the job, conflicting reuse is 409, timeout leaves the job queued, failed jobs map to `unavailable` without leaking text, unusable target 404, offline target and unlinked resource never queue, limiter |
| `node scripts/with-test-db.mjs … repository-reads.postgres-conformance.test.ts` | Pass on SQLite and Postgres (docker): remote target, non-primary resource through the real claim, idempotent retry, conflict |
| `yarn test:core` | 586/586 (before the final tree-bound addition; affected suites re-run after: 96/96) |
| `yarn test:backend` | 574/574 |
| `yarn test:desktop` | 30/30 |
| `yarn typecheck:core`, `typecheck:cli`, `typecheck:backend` | Clean, except pre-existing errors in `backend/execution/runner-claim-http.test.ts` (untouched) |

Hostile-repository proof: a repository configured with a `filter.<driver>` clean,
smudge and process command, a `diff.<driver>.textconv`, `diff.external`, an
fsmonitor hook, and executable hooks. Without the overrides plain `git status`/`git
diff` ran the fsmonitor, process filter and textconv (control run). Through the
inspection paths none ran, the index mtime did not change, and no `index.lock` was
left.

### Live run against this machine

A scratch backend (`127.0.0.1:4399`, throwaway SQLite home and account) and the
real `ovld runner start` built from this checkout, with this Overlord checkout bound
as `primary` and the OverlordMobile checkout as `mobile` (rows inserted directly so
neither checkout's `.overlord/project.json` was touched). All calls went through the
HTTP route with a user token and no device identity, as a remote client would.

| Read | Outcome |
| --- | --- |
| `git_status` primary | `ok`, HEAD `34e44ebe` on `main`, 37 unstaged and 24 untracked paths, matching `git status` |
| `read_file` mobile `README.md` lines 1–5 | `ok`, HEAD `2e468876`, 150 lines total |
| `diff` unstaged for two paths / `all` | `ok`; `all` truncated at 128 KiB |
| `search_text` `performRepositoryRead` in `backend` | `ok`, two hits in `backend/repository-reads.ts` |
| `tree` scoped and default | `ok`, capped at 5 and 500 entries, `truncated: true` |
| `branches` mobile, `worktrees`, `observe` | `ok` |
| `read_file` `.env.local` | `denied` |
| `read_file` `desktop/build/icon.png` | `binary`, size metadata only |
| `read_file` `/etc/hosts`, `../OverlordMobile/README.md` | 400 `invalid_request` |
| Unknown target / unlinked resource | 404 / `unavailable` |
| Runner stopped | `timeout` after 30 s, job left queued |
| Heartbeat stale | `target_offline` in 2 ms, nothing queued |
| Retry of a timed-out id after the runner returned | Original job's result, one row |
| Same id, different read | 409 `operation_conflict` |
| Index mtime of both checkouts across status/diff reads | Unchanged |

The first live run found a real defect: the runner posts results to
`/api/runner/requests/:id/completed`, whose 100 KB JSON limit rejected a full diff
and an unbounded tree (`body_too_large`). Fixed by a 1 MiB limit on that route and
target-side tree scoping and capping, then re-verified live.

## Remaining limitations

- **Hosted backend not exercised.** The route is not deployed to
  `backend.ovld.ai`, and the Mac's runner (under the desktop app) predates these
  capabilities, so the hosted-to-real-target proof needs a backend deploy and a
  runner update. Until then an old runner fails these jobs, reported as
  `unavailable`. Recheck in coo:1108.z77k.
- **Timed-out jobs stay queued.** A read that times out remains queued for the
  target's runner, matching the existing queue semantics; it runs when the runner
  returns.
- **Eligibility requires the primary resource on the target.** The existing
  eligible-target rule lists only targets holding the project's primary resource, so
  a target linking only a secondary resource answers 404.
- **Coverage gaps by design.** `diff` covers tracked files; untracked content is
  visible through `git_status` and `read_file`. Sensitive file names may appear in
  status and tree listings. Search over a non-Git directory uses
  `git grep --no-index`. The limiter is per process, not per cluster.
- **Worktree listing paths** are absolute paths on the target; they are
  informational and never accepted as input.
- **SQLite resource status** is checked against the backend's own disk on Local,
  which only affects co-located Local backends.
