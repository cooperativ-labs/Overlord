# Week 34, 2026 (17–23 Aug)

Consolidated from per-objective reports created this week.

## Fix published `ovld` crash: missing `@overlord/database` (2026-08-17)

Any `ovld` invocation, including `help`/`version`, failed with
`ERR_MODULE_NOT_FOUND: @overlord/database`. `cli/scripts/build.mjs` marked
private workspace packages (`@overlord/database`, `@overlord/auth`, `kysely`)
as esbuild externals, but the published `overlord-cli` tarball ships
`dist/index.js` with no workspace `node_modules` — the same class of bug as
the earlier `yaml` externalization.

Fix: bundle all JS the CLI graph actually imports (only the native addon
`better-sqlite3` stays external); fail the production build if `dist/index.js`
still has a non-`node:` package import; add `cli/test/packaged-bundle.test.ts`
asserting `ovld version` works from a copy with no `node_modules`.

## coo:757.bzsh — Agent data display on activity feed cards (2026-08-18)

Running/Delivery cards showed literal `unknown` next to a model id because the
protocol's missing-`--agent` sentinel (`unknown`) was preferred over
`assigned_agent`. Contract v86 added `createdByKind`/`createdByAgent`;
backend now treats `unknown` as absent and falls back to `assigned_agent`;
web ignores the sentinel in `normalizeAgentKey`/`getAgentIcon` and adds the
agent-authored provenance mark to run/delivery/question cards.

## coo:765 — Latch widget "request entity too large" (2026-08-18)

The mission-page Latch card showed a duplicated `request entity too large`
error and never recovered. The harness-events ingest POST exceeded Express's
100 KiB default JSON body limit once a session streamed enough
`assistant_delta` lines, so the stored cursor never advanced and every 10s
poll retried the same oversized POST. Fixed by raising the ingest limit to
1 MiB, chunking widget/runner posts to ≤64 KiB with correct cursors, and
mapping body-parser 413 to a single `body_too_large` message.

## coo:825.w81h — File changes missing from MissionPanel (2026-08-23)

Verdict: a recording failure, not a display bug — `changed_files` reads
correctly, but post-cutover Cursor missions never wrote evidence. Cursor
`postToolUse` hooks run with `PWD=/Users/jake/.cursor` and often omit `cwd`,
so `capture-change` missed the real worktree binding
(`no matching objective session binding`). Fix: recover the worktree by
explicit objective id across active-session manifests, seed a missing
top-level `cwd` so absolute paths relativize, map `StrReplace` to `edit`
instead of dropping to `generic`, and accept `filePath`/`path` aliases in the
Cursor codec. Shipped as connector release 0.3.36.

## coo:826.yb2y / coo:826.yhg8 — Inbox recent + agent-Next missions (2026-08-23)

Two passes on `GET /api/inbox/missions`: first added a triage list merging a
rolling 7-day "recently created" window with any agent-authored mission still
in status type `next` (contract v117, `listInboxMissions()`); then narrowed
status-type `next` rows to agent-authored only, since human Next missions
were leaking into the triage list through the recent window (contract v118).

## coo:826.kkg4 — Mission-anchored Feed (2026-08-23, contract v118→v119)

Redesigned the Feed so each card is a **mission**, not an objective or
delivery: `GET /api/activity-feed` now returns only `mission_run` and
`blocking_question` kinds. A mission with any launching/executing/
pending_delivery objective is one `ActivityFeedMissionItemDto` listing every
objective in the same order and icon vocabulary as the mission panel
(`sortObjectivesForMissionDisplay`, shared with `deriveObjectiveLifecycleView`
so the two surfaces cannot drift). Cards group launching, then executing,
then blocking questions. Delivery cards were removed from the feed (finished
work still reads via `GET /api/missions/:id/deliveries`).

## coo:826.64g8 — Split live feed onto its own Feed page (2026-08-23)

Moved the cross-workspace live feed and its mission drawer off Inbox onto a
dedicated `/feed` route; Inbox now holds only unallocated captures and
Everything Queued. Legacy `/inbox/missions/$missionId` URLs redirect to
`/feed/missions/$missionId`.

## coo:830 — Clarify stale execution-session attach errors (2026-08-23)

`execution_request_already_linked` attach failures were easy to mistake for
an auth rejection, since the backend text contains "session" and the CLI's
401 handler appends `ovld auth login`. The CLI now detects that payload by
`code`/message before the 401 branch and throws a dedicated diagnostic
(stale mission-session binding; retry attach without
`--execution-request-id`). Real auth 401s are unaffected.

## coo:831 — Railway Infrastructure as Code (2026-08-23)

Migrated Overlord Cloud from deprecated Config as Code (`railway.json`) to
Railway TypeScript IaC (`.railway/railway.ts`): imported the linked
`overlord-cloud`/`production` graph, ran `railway config migrate --apply
--delete-files`, encoded the former CaC Dockerfile/healthcheck settings on
`overlord-backend`, and applied the two non-destructive dashboard updates.
`railway config plan` confirms configuration is up to date. Secrets left as
`preserve()`; no services redeployed.

## coo:832 — Delivery known risks & deferred work on web/desktop (2026-08-23)

`DeliverySummaryCard.tsx` already rendered follow-up actions and tradeoffs
but omitted `knownRisks`, `deferredWork`, and `assumptions`, which mobile
already showed. Expanded the web delivery cards (mission panel + Inbox feed;
desktop shares the SPA) to render those sections when non-empty, matching
mobile's order and accent treatment. No API/contract change — the fields
already existed on `DeliveryPresentationV1`.

## coo:836 — Project settings Resources section (2026-08-23)

Replaced the single Resources settings menu item with a full Resources
navigation group: an `Overview` page, one page per linked resource, and an
`Add resource` page, with per-source agent settings surfaced inline
(`SourceAgentDefaultsTable`) instead of hidden behind a slider-icon dialog.
Webapp-only change — no REST/DTO/contract change, since `ProjectResourceDto`
already carried everything needed.

## coo:837 cluster — Runner launch-latency diagnosis and fixes (2026-08-23)

A diagnosis objective (`coo:837`) found that the persistent launchd/systemd
runner service was far slower than `ovld runner start`, or never launched at
all, because the service ran as a Background-QoS Electron-as-Node process:
Apple Events to Terminal/iTerm from that context return error -1712 after
60–120s (or never), `spawnSync(osascript)` had no timeout and blocked the
whole claim loop, the plist snapshotted Electron's stripped PATH, and the
25s Postgres LISTEN long-poll held HTTP headers silent long enough for
proxies to 502. Four follow-up objectives implemented the fixes:

- **coo:837.400q** — `POST /api/runner/claim` flushes HTTP 200 + JSON headers
  as soon as LISTEN is armed (still a single compact JSON body); LISTEN
  client `connect()` is bounded at 3s so a hang falls back to the runner's
  jittered 5s poll instead of waiting for a proxy 502.
- **coo:837.8c4k** — LaunchAgent `ProcessType` changed from `Background` to
  `Interactive` so Apple Events aren't App-Napped; `ovld runner service
  status` nags to reinstall when the installed plist is still Background.
- **coo:837.km44** — `spawnSync` for terminal-opening launches now has a 45s
  timeout (SIGKILL); on timeout the execution request is reported `failed`
  and the supervisor keeps claiming instead of stalling.
- **coo:837.6v47** — The service plist/unit no longer snapshots Electron's
  sanitized PATH; `composeRunnerServicePath` builds a fixed
  `/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin` prefix plus system
  dirs so `osascript` and agent binaries stay resolvable.

All four ship in the CLI/app bundle; existing machines need one
`ovld runner service install` (or Desktop → Reinstall service) to pick up the
plist/PATH rewrite.
