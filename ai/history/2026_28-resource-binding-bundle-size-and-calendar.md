# Week 28, 2026 (6–12 Jul)

Consolidated from per-objective reports created this week.

## Resource binding code review (coo:169, 2026-07-07 / re-review 2026-07-08)

Cross-repo resource binding review across protocol, projects, CLI launch, manifest assembly, and execution requests. **0 critical.** High issues fixed this week: `changed_files.resource_id` null on attach, wrong worktree `resourceKey` on manual launch, missing sibling manifest, wrong changed-file attribution, and tests that clobbered `.overlord/project.json`.

On-device re-review (PR #16 never merged) also fixed backend/webapp typecheck breaks on main, `resolveCwdProjectResource` ignoring `executionTargetId`, and mission suites failing `no_workspace` after the org migration (`createSeededServiceContext`). Shared target-scoped resource query helpers landed. Still deferred: MCP deliver without CLI VCS preflight, unscoped `discoverProject({ projectId })`, duplicate `isTruthyFlag`, stale `runner-and-changes.test.ts`, remaining `no_workspace` core tests.

## Resource binding Phase 6 E2E (coo:169, 2026-07-07)

Branch-planning vectors passed (CLI + backend, 5/5). New `resource-binding-e2e.test.ts` simulates the cross-repo scenario in memory; SQLite-backed suites were blocked in the cloud pod. Real-device G1–G3 (linked OpenOverlord + OverlordMobile, per-repo changed-file attribution, hosted MCP manifest) were not run.

## Bundle size optimization (coo:187, 2026-07-09)

Cleared Vite’s 500 kB chunk warning. Root causes: statically imported routes, catch-all `vendor` chunk, and `@overlord/automations` barrel pulling `@google/genai` into the SPA. Added browser-safe automations subpaths, split `manualChunks`, and lazy-loaded route pages. `bootstrap-app` 535→347 kB min; SW precache ~1735→1364 KiB.

## Calendar phases 2–3 (change rationales)

Phase 2: shared `due-datetime` helpers, calendar day droppable ids, and drag-and-drop so MissionCalendarCard drops update `dueDatetime` with optimistic UI.

Phase 3: infinite-scroll month sentinels, selected-card styling aligned with list view, calendar/due-datetime unit tests, and board UI docs for the calendar surface.
