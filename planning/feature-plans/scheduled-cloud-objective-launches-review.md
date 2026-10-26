# Review: Claude Code Cloud Jobs plan

Mission: coo:1219 · Objective: coo:1219.ynee
Reviewed: `planning/feature-plans/scheduled-cloud-objective-launches.md` (contract v168 spec), 2026-10-25.
Design artifact not reviewed (out of scope).

The plan is coherent and its overall shape (backend fires `/fire` in-process, ticket-only fire text,
attach-delivered assignment, Overlord-owned schedule) holds up against the code and Anthropic's
current docs. The findings below are places where the spec contradicts existing code, leaves a
race or a privilege gap, or names something that doesn't exist. Each has a recommended fix.

Severity: **High** = would ship a bug, security gap or design that doesn't work as written.
**Medium** = a real gap the implementer will hit and have to decide on. **Low** = accuracy or polish.

## Summary

| # | Sev | Finding | Plan § |
| --- | --- | --- | --- |
| 1 | High | Another project member can edit or Run now a job that runs as the owner | 13, 7 |
| 2 | High | The existing expiry sweep expires cloud requests after 15 min, not 2 h | 8.4 |
| 3 | High | Crash between fire and Transaction B causes a duplicate fire; fast attach races Transaction B | 8.2, 9.3 |
| 4 | High | Attach to a failed/expired request is skipped, not rejected, so an ambiguous session still attaches | 8.3, 9.3 |
| 5 | High | `createMissionGitHubPullRequest` ignores `workBranch`/`baseBranch` and can't be called from deliver | 10 |
| 6 | High | No file evidence from cloud sessions: the change-ledger hooks don't run there | 9, 12.4 |
| 7 | Medium | MCP attach skips the launch code, so a forged ticket can claim an unattached request | 6.3, 14 |
| 8 | Medium | `account_connections` has no metadata column and a uniqueness rule the plan doesn't address | 5.4 |
| 9 | Medium | Hidden verification missions need filtering everywhere; there's no "hidden mission" concept | 8.6 |
| 10 | Medium | Standing missions with per-run branches conflict with one-PR-per-mission | 11.1 |
| 11 | Medium | One `baseBranch` for multi-repo jobs whose repos have different default branches | 10, 7.1 |
| 12 | Medium | Mission status between objectives in a mission-shaped run is unspecified | 11.2 |
| 13 | Medium | Branch-protection check needs a GitHub App permission Overlord may not have, and can be wrong for bypass users | 7.3 |
| 14 | Medium | Fire error classification: `400` is overloaded, `503` is retryable | 8.3, 5.2 |
| 15 | Medium | Rate-limit buckets are in-process; worker-job dedupe is a single JSON field | 8.1, 8.5 |
| 16 | Medium | Request-scoped CLI token "expires at last delivery" has no mechanism | 9.2 |
| 17 | Low | Single-attach guard already exists under another error code | 9.3 |
| 18 | Low | Wrong CLI package name in the routine environment | 5.2, 9.2 |
| 19 | Low | `{runNumber}` used for branches but not a listed branch token | 7.1, 11.1 |
| 20 | Low | Platform facts table: version header, org concurrency cap, stale-slot behaviour | 3, 8.1 |
| 21 | Low | Lifecycle side effects and contract table are missing a few rows | 7.4, 13 |

## High

### 1. Non-owners can spend the owner's subscription and identity

**Problem.** §13 gives `project:update` to all job routes, and every run fires *the owner's*
routine. Any project editor can therefore change `objective_text`, repos or branch mode on someone
else's job, or press Run now, and the work executes as the owner: on the owner's Claude
subscription, pushing as the owner's GitHub identity, and with every claude.ai connector on the
owner's routine (Gmail, Slack, …), plus the owner's full Overlord RBAC through the MCP connector.
That's a privilege escalation from "project editor" to "acts as the owner everywhere the routine
reaches".

**Fix.**
- Only the job owner can create a job, change anything that affects what runs (prompt/objectives,
  shape, target mission, repos, branch policy, schedule), Run now, Relaunch or Resume.
- Other members with `project:update` can view, pause/disable and delete.
- "Take over" is an explicit action that makes the caller the owner. It disables the job until they
  have their own healthy routine for the project.
- Add these rules to §13 REST RBAC and §14, plus a service test for each.

### 2. Existing expiry sweep conflicts with the watchdog

**Problem.** `expireStaleExecutionRequests` (`packages/core/service/execution-requests.ts:1193`)
expires any `launched` request with `launched_session_id IS NULL` after `LAUNCH_ATTACH_TTL_MS`
= **15 min** (`:45`), when the objective is still `draft/submitted/launching`. Cloud requests match
this, so they'd be expired at 15 minutes. §8.4 assumes they stay `launched` until 2 hours so a late
attach works. Continuation requests (§11.2) are also created `launched` with a null session and
would match too.

**Fix.** Exclude `claude-code-cloud` requests from the generic sweep, keyed on
`requested_source IN ('cloud_job', 'cloud_job_continuation', …)` or on the target's adapter key. Let
`CloudJobWatchdog` own their expiry (`never_attached` at 2 h). Add a regression test that the
generic sweep leaves a 20-minute-old cloud request alone.

### 3. Duplicate fire after a crash, and a race with fast attach

**Problem.**
- §8.2 creates the request (`queued`), fires outside a transaction, then records `launched` in
  Transaction B. If the process dies or its `worker_jobs` lease expires after the `200` but before
  B commits, the worker job is retried (`max_attempts` defaults to 5). That re-fires, and `/fire`
  has no idempotency key, so a second session is created.
- §9.3 rule 1 requires status `launched` at attach. A session that attaches before B commits
  (unlikely but possible) is rejected and stops ("if attach fails, stop").

**Fix.**
- Before firing, move the request `queued → launching` in its own short transaction and record
  `fire_attempted_at`. A fire job that finds its request already `launching` with no recorded result
  must not fire. It marks the run `failed` with `fire_outcome_unknown` (same as a timeout).
- Enqueue fire jobs with `max_attempts = 1`, or make the handler idempotent on the run row as above.
  The run row, not `worker_jobs`, is the fire's state machine.
- Accept attach on `launching` as well as `launched` for this adapter (the existing linker already
  accepts both, `execution-requests.ts:1348`). Transaction B then must not overwrite an attached
  state.

### 4. Ambiguous sessions can still attach

**Problem.** §8.3 says a session from an earlier ambiguous fire "can't attach: the earlier request
is `failed`, and the guard in §9.3 rejects it". It doesn't. For a request in a terminal state, the
current linker returns `null` and **skips the link** without failing (`execution-requests.ts:1340`),
so attach succeeds and the stray session executes the objective in parallel with the Relaunch. The
§9.3 guard only covers the "different session already linked" case.

**Fix.** Add an explicit rule to §9.3: for `claude-code-cloud` requests, attach against
`failed | expired | cleared | cancelled` throws `execution_request_not_attachable` (409), and the
launcher prompt already says to stop on attach failure. Keep the skip-link behaviour for every other
adapter (agent-pod relies on it). Add a test: Relaunch, then the old request's session attaches and
is rejected.

### 5. PR creation can't do what §10 says

**Problem.** `createMissionGitHubPullRequest(missionId, body)` (`backend/ext/github/service.ts:696`)
takes `head` from `missions.active_branch` and `base` from the project link's `default_branch`. It
has no head/base parameters and throws 409 if `active_branch` is empty. It also lives in
`backend/ext/github`, while deliver lives in `packages/core`, and it makes a network call that must
not run inside the deliver transaction.

**Fix.**
- On delivery with a `deliveryReport.git` entry for the GitHub-linked repo, set
  `missions.active_branch = workBranch` (the field the PR function already reads).
- Add an optional `baseBranch` to the PR function's input, defaulting to the link's default branch.
- Open the PR from a worker job (`overlord.cloud-job.open-pr.v1`) enqueued by deliver, not inline.
  It retries safely because the function already returns an existing PR.
- Match the git report entry to the PR repo by `owner/name` against
  `ext_github_project_links.full_name`, not by "primary resource". The primary resource and the
  linked repo aren't guaranteed to be the same repo.

### 6. Cloud sessions produce no file evidence

**Problem.** The objective ledger's "Files changed" evidence comes from the Overlord connector's
native hooks (PostToolUse etc.) installed by the local plugin. A claude.ai cloud session over the
MCP connector has none of them, so every cloud delivery would show `coverage: unavailable`, and the
deterministic human-action rules (migrations, `.env.example`, manifests) never fire. The plan
doesn't mention this.

**Fix.** Pick one approach and specify it in §10/§12.4:
- **(Recommended)** After delivery, derive evidence server-side: for each `deliveryReport.git` entry
  with `pushed: true`, call GitHub compare `baseBranch...headSha` through the App and record the
  changed paths as `agent_declared` evidence with source `cloud_git_compare`. This is exact and
  doesn't depend on the agent.
- Also tell the agent in the "Cloud launch" skill section to pass `declaredPaths` on deliver as a
  fallback for repos the App can't read.
- Note in §15 that hook-driven features (permission capture, follow-up capture) aren't available in
  cloud runs.

## Medium

### 7. MCP attach should require the launch code too

**Problem.** §6.3 says MCP attach doesn't need the code. Over MCP, the gate is only "authenticated
user = job owner". Anyone with the fire token (it's on the user's machine, in Overlord, and possibly
copied elsewhere) can fire the routine with forged text. The routine runs as the owner with the
Overlord connector, so a crafted ticket naming a real, still-unattached request wins the
single-attach race and the real session is rejected. The `<routine-fire-payload>` wrapper reduces
but doesn't remove this, because the launcher prompt deliberately opts in to the ticket.

**Fix.** Require the launch code on both channels. `overlord_attach_session` takes `launchCode`, and
the backend verifies the hash. For MCP the code is consumed at attach; for CLI it's consumed by the
exchange. Update the launcher prompt, §6.3 and §14. It costs nothing, since the code is already in
every ticket.

### 8. `account_connections` storage doesn't fit as written

**Problem.**
- The table has **no metadata column** for `{ routineId, fireUrl, tokenHint }`.
- Profile-scoped rows are unique on `(owner_profile_id, provider, server_url)` where not
  disconnected (`20261005120000_account_connections_profile_scope.sql:40`). With one connection per
  project routine, the plan never says what `server_url` is, and a constant URL would allow only one
  routine per user.
- `credential_format` and `credential_kind` are CHECKed, and `provider = 'knowledgebase'` is the
  only org-scoped provider.

**Fix.** Specify the mapping:
- `server_url = fireUrl`. That makes rows unique per routine and satisfies the `https://` CHECK.
- `external_account_id = routineId`, `external_account_label = tokenHint`.
- `credential_kind = 'api_key'`, a new `credential_format = 'claude-routine-token-v1'`, and
  `organization_id = NULL` (profile scope).
- Migration: extend the `provider` and `credential_format` CHECKs in both dialects.
- Encryption uses the current key ring key (`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`, platform fallback).
  No new env var is needed, so §13's "no Railway changes" holds. State that explicitly.
- Replace token re-seals the same row, bumping `credential_revision`. Two projects that bind the
  *same* routine share one connection row. Allow that, or reject it in Step 4 with "This routine is
  already bound to project X".

### 9. Verification shouldn't create hidden missions

**Problem.** §8.6 creates a mission that "doesn't appear on the board" and isn't in deliveries.
Overlord has no hidden-mission concept. Every list, search (`overlord_search_missions`), activity
feed, webhook/outbox event, notification, mission-summary compose, delivery compose, mission counts
and export would need a filter, and any missed one leaks verification noise. It also leaves a
mission per verify forever.

**Fix.** Make verification mission-less:
- The fire carries `OVERLORD_VERIFY v1 request=<id> code=<code>`. The launcher prompt handles both
  ticket kinds.
- The agent calls one new tool, `overlord_report_cloud_verify` (MCP) or `ovld cloud verify-report`
  (CLI), with the cloned repo URLs and channel. The backend checks the launch code and records the
  result on the routine binding.
- The execution request can be mission-less (the schema already supports mission-less requests, see
  the `requested_source` local-target-mutation path), with `requested_source = 'cloud_verify'`.

This tests the same things (fire, connector reachability, auth, repos) with no fake missions.

### 10. Standing missions vs. one PR per mission

**Problem.** §11.1 lets each run on a standing mission render its own branch (`{date}` /
`{runNumber}`). The PR function returns the mission's existing PR, so run 2+ never get a PR, and
the mission's PR keeps pointing at run 1's branch.

**Fix.** For `standing_mission` + `new_branch`, force a single branch: the template may not contain
`{date}`/`{runNumber}`, and `continueExistingBranch = true` after the first run. Users who want a PR
per run should use `new_mission`. Enforce it in §7.3 validation.

### 11. Multi-repo base branch

**Problem.** `baseBranch` is one string, resolved from "the project's default branch → the GitHub
link's `default_branch` → `main`". Repos in a multi-repo job routinely have different defaults
(`main` vs `master` vs `develop`). `new_branch` would branch other repos off a non-existent base, and
`base_branch` mode would push to the wrong branch.

**Fix.** Make it per repo: `branchPolicy.repos: [{ resourceKey, baseBranch, workBranch }]`.
`cloud_jobs.base_branch` overrides only the active repo. Other repos use their own default branch,
read through the GitHub App (`GET /repos/{o}/{r}`) at request creation and frozen. The
branch-protection check (§7.3) also runs per repo.

### 12. Mission status during a mission-shaped run

**Problem.** §11.2 has the agent deliver objective *n* and continue to *n + 1* in the same session.
The spec doesn't say what happens to the mission's status column, delivery composition,
`run_delivered` notifications, webhooks or the summary for intermediate deliveries. Today a delivery
moves the session to `review`. Bouncing the mission review → execute per objective is noisy and
could trigger review-column automation.

**Fix.** State that intermediate deliveries in a mission-shaped cloud run:
- keep the mission in `execute`;
- record the objective as `complete` with its delivery;
- enqueue delivery compose per objective (so evidence exists);
- emit `run_delivered`, open the PR and move the mission to `review` only on the last objective.

Also create mission-shaped objectives with `autoAdvance = false` and never add them to a run queue,
so `RunQueueDispatchWorker` can't create a competing request for objective *n + 1*.

### 13. Branch-protection check

**Problem.** §7.3 refuses `base_branch` jobs when the base requires PRs, checked through the GitHub
App. Two issues:
- The classic protection endpoint needs the App's **Administration: read** permission, which the
  current App may not request. It also ignores rulesets.
- Anthropic's docs say rules the user's connected access can **bypass** don't block a run's push.
  Repo admins would be refused a job that would actually work.

**Fix.** Use `GET /repos/{o}/{r}/rules/branches/{branch}`, which covers rulesets and needs only
metadata read, plus classic protection when readable. Make the result a **warning with explicit
acknowledgement** ("Pushes to main require a pull request; this job will fail unless your GitHub
account can bypass that rule"), not a hard refusal. Keep the run-time behaviour (rejected push →
`blocked`). Repos without the App installed show "couldn't check".

### 14. Fire error classification

**Problem.** Per the API reference:
- `400 invalid_request_error` covers a paused routine, a bad `anthropic-version` and text over
  65,536 characters.
- `503 overloaded_error` and `500 api_error` are separate statuses.

§8.3 maps all `400` to "paused" (setting `needs_attention` for what may be our own bug), and treats
all 5xx as ambiguous and never retried.

**Fix.**
- Classify `400` as `routine_paused` only when the error message indicates a paused routine.
  Otherwise use `fire_rejected`: run `failed`, health unchanged, and an operator error log.
- Treat `503 overloaded_error` as **not accepted**: re-enqueue with backoff (up to 3 tries in about
  10 minutes) and record `deferred_overloaded`. Keep `500`, timeouts and connection resets after the
  request was sent as `fire_outcome_unknown`. Connection errors *before* sending (DNS, connect
  refused) are safe to retry.
- Add `cancelled` handling for runs whose job was deleted while deferred.

### 15. Rate limiting and fire-job dedupe

**Problem.**
- "In-process token buckets, persisted" is vague and breaks if the backend ever runs more than one
  replica.
- `worker_jobs` has no dedupe key column. `enqueueWorkerJob`'s `dedupeBy` matches one JSON field
  (`worker-jobs.ts:150`) and isn't a unique constraint.

**Fix.**
- Compute limits from the database: count `cloud_job_runs` (plus verify requests) with
  `fired_at > now() - 1h`, per routine and per owner, inside the fire job before firing. That's
  exact across replicas and restarts, with no bucket state. The platform's `429` + `Retry-After`
  stays the backstop, since the user's own Run now presses in claude.ai count too.
- Put `slotKey = <jobId>:<fireAtIso>` in the payload and dedupe on it. The real guarantee is the
  unique `(cloud_job_id, fire_at)` on `cloud_job_runs`; the run insert must
  `ON CONFLICT DO NOTHING` and the fire job must exit if it didn't insert.

### 16. Request-scoped CLI token lifetime

**Problem.** §9.2 says the exchanged token "expires when the mission's last objective is delivered,
or after 12 hours". `user_tokens` has `expires_at` but nothing revokes a token on delivery.
Mission-shaped runs can also legitimately exceed 12 hours across a usage-limit pause plus Resume.

**Fix.**
- Issue a `user_tokens` row with `scope = 'mission_lifecycle'` and a `user_token_scopes` row
  (`resource_type = 'mission'`), `expires_at = now + 12h`, tagged with `execution_request_id`.
- The final delivery of the run, Resume and Relaunch revoke it (`deleted_at`).
- Resume mints a fresh code and token, so the 12 h cap never needs extending.
- Specify that the token can't create missions, projects or tokens.

## Low

17. **The guard already exists.** `linkExecutionRequestSession` already throws
    `execution_request_already_linked` (409) when a request is linked to a different session
    (`execution-requests.ts:1350`), for every adapter. Reuse that code instead of inventing
    `execution_request_already_attached`, and reword §9.3 rule 2. The genuinely new rule is #4
    above.
18. **CLI package name.** The CLI is published as `overlord-cli` (`cli/README.md:36`), not
    `@overlord/cli`. Fix §5.2 step 3 and §9.2: `npm i -g --no-fund overlord-cli@<pinned>`.
19. **Branch tokens.** §11.1 uses `{runNumber}` in `branch_template`, but §7.1 lists it only for
    `mission_title_template`. Either add it to the branch token list or drop it (moot if #10 is
    adopted). Also define `{jobSlug}` (lowercase, `[a-z0-9-]`, max 40).
20. **Platform facts (§3).**
    - The current docs show `anthropic-version: 2026-10-21` and say every version from `2023-06-01`
      behaves the same, with the older `anthropic-beta: experimental-cc-routine-2026-04-01` header
      optional. Pin a version but keep it configurable, and record the beta-header deprecation
      window in `claudeRoutineClient`.
    - The docs list an **organization cap on concurrent cloud sessions** ("the last run didn't
      start…"): a fire can return `200` and the session never start. The watchdog already covers
      this. Mention it in the §3 table and in the `run_unattached` notification text.
    - If the user's claude.ai GitHub connection lapses, runs fail. Add it to the step 5 failure
      table and the unattached notification as a likely cause.
    - **Stale missed slots (§8.1):** running "the most recent missed slot" can fire many hours late
      after an outage. Add a lateness cap (default: skip if later than half the recurrence interval,
      max 6 h) and record `skipped_missed`.
21. **Missing rows.**
    - §7.4: project archived or deleted → jobs disabled (`project_archived`); standing mission
      deleted or completed → job disabled (`standing_mission_closed`); routine Disconnect while runs
      are in flight → in-flight sessions may still attach and deliver (state it either way).
    - §13: the notification kinds (§12.5) and the new `requested_source` values (`cloud_job`,
      `cloud_job_continuation`, `cloud_verify`) need contract vocabulary entries. Add the
      `account_connections` CHECK changes from #8.
    - §7.1: `cloud_jobs.schedule_id` reuses `schedules`, whose service (`mission-schedules.ts`) is
      mission-keyed. Job-scoped upsert/clear helpers are needed, and job missions must never get a
      `missions.schedule_id`, or `createScheduledDuplicateIfNeeded` will clone them on completion.

## Suggested phase adjustments

- Phase 1 should include #2, #3, #4, #7 and #17 (attach and expiry semantics). These are protocol
  changes that everything else depends on.
- Phase 2 replaces hidden verification missions with #9.
- Phase 3 must include #1 (RBAC), #5 (PR worker), #6 (git-compare evidence) and #15 before any
  scheduled job runs in production.
- Phase 4 picks up #12.

## Verified against

- Code: `packages/core/service/execution-requests.ts` (expiry sweep, session linking),
  `backend/protocol/session.ts:69` (`--execution-request-id` exists),
  `backend/ext/github/service.ts:696` (PR creation),
  `database/postgres/migrations/20260712000000_virtual_execution_targets.sql`
  (`execution_request_grants` shape matches §6.3), `…20261005120000_account_connections_profile_scope.sql`,
  `…20260719124600_worker_jobs.sql`, `packages/core/service/worker-jobs.ts`,
  `backend/connections/keyring.ts`, `cli/README.md`.
- Docs (fetched 2026-10-25): code.claude.com/docs/en/routines and
  platform.claude.com/docs/en/api/claude-code/routines-fire. Rate limits (30/routine,
  100/account for API fires), token format, response shape, payload wrapping, `claude/` branch
  default and the no-idempotency note all match the plan.
