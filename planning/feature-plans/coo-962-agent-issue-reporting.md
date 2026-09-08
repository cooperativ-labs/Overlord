# coo:962 — Agent issue reporting

**Status:** proposed — design and approach only. No schema, service, or surface code is
being changed by this objective.

**Objective:** `coo:962.445r` — "The CLI and the MCP and the API should have a route that
lets agents report bugs or other issues they discover in the process of executing an
unrelated mission. This could be part of the delivery step, but it could also happen while
agents are in the process of executing. Think through this and propose an approach."

---

## 1. The problem, stated precisely

An agent executing objective X routinely walks through code that has nothing to do with
objective X. In the course of that walk it sees things: a swallowed error, an `==` that
should be `===`, a migration that will fail on Postgres but not SQLite, a route with no
authorization check, a test that asserts nothing. Today that knowledge has exactly three
destinations, and all three are bad:

1. **It is dropped.** The agent stays in scope, says nothing, and the observation dies with
   the session. This is the default and it is the common case.
2. **It becomes scope creep.** The agent fixes it, and the objective's diff now contains
   unrelated changes the reviewer did not ask for and cannot easily separate.
3. **It becomes prose.** The agent mentions it in the delivery summary, where it is one
   sentence in a narrative that gets read once and never indexed, searched, or acted on.

None of these is capture. Overlord already has a strong story for *work a human asked for*
and no story at all for *work an agent noticed was needed*. That second category is high
signal — an agent that has just read a file carefully is the best-positioned reporter
Overlord will ever have — and it is currently thrown away at the end of every session.

### What makes this hard

The naive version of this feature ("give agents a `create-mission` button for bugs") fails
immediately, and it is worth being explicit about why, because the failure modes drive
every design decision below.

- **Volume.** Agents are tireless and uncalibrated. Given an unbounded reporting channel,
  a fleet will file hundreds of low-value observations per week. A capture surface that
  produces more triage work than it saves is a net loss.
- **Repetition.** Ten agents that each read `backend/repository.ts` will each notice the
  same 4000-line module. Without deduplication the same finding arrives ten times, and
  after a human declines it, it arrives ten more times next week.
- **Board pollution.** Reports are *observations*, and most observations will be declined.
  If a report is a mission, the mission board — the thing that is supposed to represent
  committed work — fills with unvetted agent noise.
- **Credibility.** A report with no provenance is unactionable. "There is a bug in the
  session module" is worthless; "while editing `<file>:88` for coo:940.k3xm I saw the
  session lookup ignore its `deleted_at` filter" is a ticket. (Hypothetical — every
  example finding in this document is invented to show shape, not reported here.)
- **Blast radius.** Filing a report must never be able to fail, slow, or complicate the
  mission the agent is actually executing. A reporting channel that can break delivery
  will be disabled within a week.

### Design principles that follow

1. **A report is a captured observation, not a mission.** It enters a triage queue, not the
   board. Promotion to real work is a separate, human-gated act.
2. **Reporting is out-of-band and non-blocking.** It is its own protocol call with its own
   transaction. It never mutates the reporting mission's state and can never fail a
   delivery.
3. **Provenance is captured mechanically, not asked for.** The session already knows the
   mission, objective, agent, model, and project. The agent supplies only what it observed.
4. **Deduplication is a first-class feature, not a cleanup task.** A repeat report merges
   into the existing row and tells the reporting agent so.
5. **A decline is durable.** Once a human declines a finding, agents that rediscover it are
   told it was declined and the report is suppressed, not re-filed.
6. **Both entry points, one write path.** In-flight and at-delivery reporting normalize to
   the same row through the same service function.

---

## 2. Why both entry points are required

The objective asks whether this belongs in the delivery step or mid-execution. The answer
is both, and they are not redundant — they serve different failure modes.

**Mid-execution (`report-issue`) is required because:**

- The observation is most accurate at the moment of discovery, with the file open and the
  reasoning fresh. Deferred to delivery, it degrades into a vague recollection.
- The session may never reach delivery. An objective that is blocked, cancelled, crashed,
  or context-exhausted still produced a real finding, and that finding should survive.
- Discovery is often *why* an agent asks a blocking question. Filing the report and then
  calling `ask` keeps the two separable.
- Some findings — a live security hole, a data-loss path — should not wait for the end of
  a long objective.

**At-delivery (`deliveryReport.agentReport.issuesFound[]`) is required because:**

- Delivery is the reviewer's reading moment. A finding attached to the delivery the
  reviewer is already reading gets triaged; a finding sitting in a separate queue does not.
- Most agents will not interrupt their own flow to make an extra tool call mid-task.
  Delivery is the checkpoint they reliably hit, and the delivery report is a shape they are
  already prompted to fill in.
- It batches. An agent that noticed five things reports them once, in one structured array,
  with no per-item round trip.

They converge: delivery-time issues are fanned out into exactly the same `issue_reports`
rows through the same service, and the fingerprint dedup means an agent that filed
mid-flight *and* listed the same finding at delivery produces one row, not two.

---

## 3. Recommended approach

### 3.1 A new lightweight entity, promoted into a mission

Model an issue report on the existing **`inbox_items` → `POST /api/inbox/:id/promote`**
pattern, which is already proven in this codebase: a minimal capture row that holds
unvetted intent, plus an explicit promotion that atomically creates a normal mission and
consumes the capture.

The differences from `inbox_items` are what justify a second table rather than reuse:

| | `inbox_items` | `issue_reports` |
|---|---|---|
| Owner | one profile (private) | a project (team-visible) |
| Origin | a human capturing their own idea | an agent, mid-mission |
| Provenance | none | source mission / objective / session / agent |
| Triage state | none (exists or is promoted) | `new` / `accepted` / `declined` / `duplicate` |
| Dedup | none | content fingerprint + occurrence count |
| Classification | none | kind + severity |

Reusing `inbox_items` would put a team's agent findings into one person's private capture
list with no provenance and no way to decline them durably. Reusing `missions` (a report as
a draft mission) is the other tempting shortcut, and it is the one to avoid: it puts
unvetted agent output on the board, gives every declined observation a permanent mission
id, and forces the mission status vocabulary to grow a triage concept it does not want.

### 3.2 Schema

```sql
-- Agent-authored issue capture (coo:962, contract 136).
CREATE TABLE IF NOT EXISTS issue_reports (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  display_id text NOT NULL,          -- '<workspace slug>:R<n>', e.g. coo:R41
  sequence_number integer NOT NULL,

  -- Provenance. Every column is nullable: a report filed by a hosted MCP agent
  -- with no live session still has a project, and that is enough.
  source_mission_id text REFERENCES missions(id) ON DELETE SET NULL,
  source_objective_id text REFERENCES objectives(id) ON DELETE SET NULL,
  source_session_id text REFERENCES agent_sessions(id) ON DELETE SET NULL,
  source_delivery_id text REFERENCES deliveries(id) ON DELETE SET NULL,
  reported_by_agent text,
  reported_by_model text,
  reported_by_workspace_user_id text REFERENCES workspace_users(id) ON DELETE SET NULL,

  -- Content.
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  details text NOT NULL CHECK (length(btrim(details)) > 0),
  kind text NOT NULL CHECK (kind IN
    ('bug','security','data_loss','regression_risk','tech_debt','test_gap','docs','other')),
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  resource_key text,
  paths_json jsonb NOT NULL DEFAULT '[]',

  -- Triage.
  state text NOT NULL CHECK (state IN ('new','accepted','declined','duplicate')),
  triaged_by_workspace_user_id text REFERENCES workspace_users(id) ON DELETE SET NULL,
  triaged_at timestamptz,
  triage_note text,
  promoted_mission_id text REFERENCES missions(id) ON DELETE SET NULL,
  duplicate_of_id text REFERENCES issue_reports(id) ON DELETE SET NULL,

  -- Deduplication.
  fingerprint text NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_reported_at timestamptz NOT NULL,
  last_reported_at timestamptz NOT NULL,

  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_issue_reports_workspace_display_id
  ON issue_reports (workspace_id, display_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_issue_reports_project_fingerprint
  ON issue_reports (project_id, fingerprint) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issue_reports_project_state_created
  ON issue_reports (project_id, state, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_issue_reports_source_objective
  ON issue_reports (source_objective_id) WHERE deleted_at IS NULL;

-- One row per time a report was observed, so a merged report keeps every
-- provenance trail rather than only the first one's.
CREATE TABLE IF NOT EXISTS issue_report_sightings (
  id text PRIMARY KEY,
  issue_report_id text NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
  mission_id text REFERENCES missions(id) ON DELETE SET NULL,
  objective_id text REFERENCES objectives(id) ON DELETE SET NULL,
  session_id text REFERENCES agent_sessions(id) ON DELETE SET NULL,
  delivery_id text REFERENCES deliveries(id) ON DELETE SET NULL,
  agent_identifier text,
  entry_point text NOT NULL CHECK (entry_point IN ('in_flight','delivery')),
  note text,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_issue_report_sightings_report
  ON issue_report_sightings (issue_report_id, created_at DESC);
```

Both dialects (`database/postgres/migrations/`, `database/sqlite/migrations/`) get the
migration, following the existing `20260803130000_inbox_items.sql` pairing.

### 3.3 The fingerprint

```
fingerprint = sha256(
  project_id + '\n' +
  kind + '\n' +
  normalizedTitle + '\n' +
  primaryPath
)
```

where `normalizedTitle` is lowercased, stripped of punctuation, collapsed on whitespace,
and truncated to 120 characters, and `primaryPath` is the first entry of `paths` after
repo-relative normalization, or the empty string.

This is deliberately coarse. It will merge two genuinely distinct findings that share a
title and a file, and that is the right trade: an over-merged report is one triage decision
with two sightings attached, while an under-merged report is a queue that fills with
near-identical rows and stops being read. `kind` is in the key so a `security` finding never
silently merges into a `tech_debt` one.

### 3.4 Write semantics — what happens on a report

Inside one transaction, keyed on `(project_id, fingerprint)`:

| Existing row | Action | Response `status` |
|---|---|---|
| none | insert with `state = 'new'`, `occurrence_count = 1` | `created` |
| `state = 'new'` | increment `occurrence_count`, bump `last_reported_at`, insert sighting | `merged` |
| `state = 'accepted'` | same as `new`, and return `promotedMissionId` | `merged` |
| `state = 'declined'` | increment counter and insert sighting, **change nothing else** | `suppressed` |
| `state = 'duplicate'` | merge into `duplicate_of_id`'s row, apply that row's rules | `merged` |

The `suppressed` response is the load-bearing part of the design. It is what makes an agent
fleet converge instead of oscillating: the response carries the human's `triageNote`, so the
agent is told *"this was declined on 2026-08-14: intentional, the retry wrapper handles
it"* and can stop treating it as a finding — and can say so in its own summary rather than
re-litigating it.

`accepted` behaves like `new` rather than reopening, because a report that has already been
promoted to a mission does not need a second promotion; the response points the agent at the
mission that is already tracking it.

### 3.5 Bounds

Non-negotiable, because volume is the failure mode:

- **10 reports per objective run.** Beyond that the call returns
  `issue_report_limit_reached` (a successful protocol response with a `status`, not an
  exception — it must never look like a broken tool).
- **12 items per delivery** in `issuesFound[]`, matching the existing `MAX_ITEMS = 12` in
  `packages/core/service/delivery-report.ts`.
- **Title ≤ 200 chars, details ≤ 4000 chars, 10 paths per report.** Details is capped high
  because a good report includes a reproduction; the cap exists to keep a runaway agent
  from writing a transcript into the queue.
- Merges do not count against the per-run cap; only inserts do. An agent that keeps
  rediscovering known issues is not the problem this cap exists for.

### 3.6 Display ids

A report carries a workspace-scoped short id — `coo:R41` — on the same model as
`missions.display_id`, which is `` `${workspace.slug}:${sequence}` `` backed by a
`sequence_number` column and a unique `(workspace_id, display_id)` index.

No new counter table is needed. `mission_sequences` is already generic: rows are keyed by
`(workspace_id, scope_type, counter_name)`, and `nextMissionSequence` reads
`counter_name = 'mission'`. Reports allocate from `counter_name = 'issue_report'` in that
same table, so the allocator is the existing function parameterized by counter name rather
than a second copy of it.

The **`R` prefix is load-bearing**, not decoration. Without it `coo:41` could be either
mission 41 or report 41, and every reference — in conversation, in a protocol flag, in
`resolveObjectiveRef`-style parsing — would be ambiguous. With it, a report id is
unmistakable at a glance and can never collide with a mission or objective id.

`--issue-report-id` on the triage and read commands accepts either the UUID or the display
id, matching how `--mission-id` and `--objective-id` already behave.

### 3.7 Which project a report lands in

A report from a live session always lands in **that session's project**. `--project-id` is
honored only when there is no session at all, or when it names the session's own project;
a session-bearing call that points somewhere else is rejected rather than silently
redirected.

The flag cannot simply be dropped, because a hosted-MCP or chat agent with no mission has no
other way to name a destination. What v1 withholds is narrower: the ability for an agent
*that has a session* to write outside the project it is working in.

The reason is blast radius. Allowing it makes the agent write rule "any project in any
workspace where the token holds `issue_report:create`"; withholding it keeps the rule to one
auditable sentence — **an agent writes reports only into the project it is working in.**
Deciding that a finding belongs to a different project is an ownership judgment, and a human
at triage is better placed to make it than an agent mid-objective.

Two things make the restriction cheap rather than limiting:

- **Most of what looks like cross-project is cross-resource.** A project spans several
  repositories through its project resources — this one has `primary`, `latch`, `marketing`,
  `mobile`, and `refinery`. An agent that finds a bug in a sibling repo while reading it for
  context is reporting within the same project, and `resource_key` (§3.2) already carries
  where. No authorization boundary is crossed and no `--project-id` is involved.
- **The destination is chosen at promote, not at capture.** `POST /api/issue-reports/:id/promote`
  takes the target project as an argument, exactly as `promoteInboxItem(id, projectId)` in
  `backend/repository.ts` already does, checking `mission:create` against the destination
  rather than the capture's origin. A genuinely misrouted report therefore costs one dropdown
  at triage instead of a wrong write.

This is additive to reverse: permitting a session to override `--project-id` later is a
non-breaking relaxation. If it is ever enabled, the `mission_events` provenance row must
still land on the **source** mission while the report lands in the target project —
otherwise a report filed elsewhere becomes invisible to the reviewer of the mission that
produced it.

---

## 4. Surfaces

### 4.1 Protocol / CLI — `ovld protocol report-issue`

Illustrative shape only — the finding below is invented for the example, not a real
observation about this repository:

```bash
ovld protocol report-issue \
  --title "Lookup helper ignores deleted_at" \
  --kind bug --severity high \
  --paths some/module.ts \
  --details-file - <<'EOF'
`resolveThingByKey` selects on its key column without filtering `deleted_at IS NULL`,
so a soft-deleted row still resolves. Noticed while editing this file for
coo:940.k3xm; unrelated to that objective, so not fixed here.
EOF
```

| Flag | Required | Notes |
|---|---|---|
| `--title` | yes | ≤ 200 chars |
| `--details` / `--details-file` | yes | ≤ 4000 chars; file form for heredoc, per the standard shell-escaping rule |
| `--kind` | no | closed vocabulary, default `bug` |
| `--severity` | no | closed vocabulary, default `medium` |
| `--paths` | no | comma-separated, repo-relative |
| `--project-id` | no | honored only with no session, or when it names the session's own project (§3.7); falls back to cwd discovery |
| `--mission-id` / `--objective-id` | no | provenance; auto-filled from the attached session |
| `--session-key` | no | stamps agent/model/session provenance when present |
| `--resource` | no | logical project resource key for multi-repo projects |

Deliberately **not** required: a session. `report-issue` works with only a resolvable
project, so a hosted-MCP agent or a `load-context`-only session can file one — that
sessionless case is the reason `--project-id` exists at all. A call that *does* carry a
session is pinned to that session's project per §3.7.

Response:

```json
{
  "status": "created",
  "issueReport": {
    "id": "…", "displayId": "coo:R41",
    "state": "new", "kind": "bug", "severity": "high",
    "title": "Lookup helper ignores deleted_at",
    "occurrenceCount": 1,
    "promotedMissionId": null,
    "triageNote": null
  }
}
```

`report-issue` joins `SUBCOMMAND_PERMISSIONS` in `backend/protocol.ts` with the new
`issue_report:create`, and is reachable at `POST /api/protocol/report-issue` like every
other subcommand — that route *is* the API surface the objective asks for, and it comes for
free from the existing dispatcher. The CLI needs no flag-registry entry (protocol flags are
forwarded unvalidated by design) but does need help text in `cli/src/protocol-help.ts`.

Two read commands round it out:

- `ovld protocol list-issue-reports --project-id <id> [--state new] [--source-objective-id …]`
  — so an agent can check for known issues before filing, and so a triage session can pull
  the queue.
- `ovld protocol triage-issue-report --issue-report-id <id> --state accepted|declined|duplicate [--note …] [--duplicate-of <id>]`
  — gated on `issue_report:triage`, which is **excluded** from `MISSION_LIFECYCLE_GRANTS`,
  so an ordinary agent token can file and read but cannot rule on its own findings.

### 4.2 Delivery integration

`deliveryReport.agentReport` gains one additive optional array:

```json
{
  "deliveryReport": {
    "schemaVersion": 1,
    "agentReport": {
      "humanActions": [],
      "tradeoffsMade": [],
      "knownRisks": [],
      "deferredWork": [],
      "assumptions": [],
      "issuesFound": [
        {
          "title": "Lookup helper ignores deleted_at",
          "kind": "bug",
          "severity": "high",
          "details": "…",
          "paths": ["some/module.ts"]
        }
      ]
    }
  }
}
```

This follows the existing normalization discipline in
`packages/core/service/delivery-report.ts` exactly: `issuesFound` goes through
`salvageArray`, malformed items are dropped with a bounded warning, and **a bad or oversized
issue can never fail the delivery**. The fan-out into `issue_reports` runs after the
delivery transaction commits, so a fingerprint conflict or a project-resolution failure
degrades to a warning on an already-successful delivery rather than rolling one back.

The normalized report keeps `issueReportIds` alongside the items so the delivery card can
link each finding to its triage row, and `DeliveryPresentationV1` gains a matching
`issuesFound` array so both the deterministic and the Gemini-composed presentation render
them.

### 4.3 MCP

Three tools, all thin forwarders to the protocol subcommands, in both
`mcp/tool-catalog.ts` + `mcp/server.ts` (hosted) and
`connectors/core/scripts/overlord-mcp.mjs` (local shim), mirroring how
`overlord_create_inbox_item` is built:

- `overlord_report_issue` — `{ title, details, kind?, severity?, paths?, projectId?, missionId?, objectiveId? }`, `writeAction` annotation. `projectId` follows §3.7: required when the caller has no session, ignored-or-rejected when it disagrees with one.
- `overlord_list_issue_reports` — `{ projectId, state?, sourceObjectiveId?, limit? }`, `readOnly`.
- `overlord_triage_issue_report` — `{ issueReportId, state, note?, duplicateOfId? }`, `writeAction`; fails for a `mission_lifecycle`-scoped token, by design.

### 4.4 REST (human/webapp)

Following the `/api/inbox` shape:

- `GET /api/projects/:id/issue-reports` — bounded, newest-first, `{ items, total, limit }` page envelope per the v134 convention, filterable by `state`, `kind`, `severity`.
- `GET /api/issue-reports/:id` — one report with its sightings.
- `PATCH /api/issue-reports/:id` — triage (`state`, `triageNote`, `duplicateOfId`), plus editing `title`/`details`/`kind`/`severity` before promotion.
- `POST /api/issue-reports/:id/promote` — atomically creates a normal draft mission from the report and sets `state = 'accepted'`, `promoted_mission_id`. Takes the **destination `projectId` as an argument** rather than inheriting the report's project, mirroring `promoteInboxItem(id, projectId)`, and requires `mission:create` on that destination. This is the seam that makes §3.7's capture-time restriction cheap: a report filed against the wrong project is re-targeted here by the human who is already triaging it. Also accepts an optional objective override so a human can rewrite the agent's framing on the way through.
- `DELETE /api/issue-reports/:id` — soft delete.
- `GET /api/missions/:id/issue-reports` — reports *sourced from* this mission, for the mission panel.

### 4.5 Activity feed and notification

Filing a report from a session appends one `mission_events` row to the **source** mission
with `type = 'issue_report'`, summary `Reported an issue: <title>`, and the report id in
`payload_json`. This is the piece that makes reporting visible rather than a write into a
void the reviewer never opens — the person reviewing coo:940 sees, in the feed they are
already reading, that the agent found something while it was in there.

`issue_report` is a new closed-vocabulary value on `mission_events.type`. It is safe to add:
`MissionEventDto.type` is typed `MissionEventType | string` and the contract already states
that "unknown future values render with a neutral fallback", so an un-upgraded webapp or
mobile client degrades gracefully rather than breaking. (The lower-friction alternative is
to reuse `alert` with a payload discriminator, which needs no vocabulary change; it is worse
for filtering and for the mission-panel section, and the contract bump is already required
by the new table, so it buys nothing.)

A new open-vocabulary `outbox_messages.topic` value `issue_report.created` fires the
existing webhook dispatcher, so external consumers (a Linear/Jira bridge) get these without
further work.

### 4.6 Webapp

- A per-project **Reports** view: the `new` queue, grouped by severity, each row showing
  kind, severity, occurrence count, source mission link, and Accept / Decline / Merge
  actions. Accept opens the existing new-mission modal pre-filled from the report.
- A collapsed **"Issues found (3)"** section on the mission panel and on
  `DeliverySummaryCard`, listing what this mission's agents reported, triageable inline.
  This is where most triage will actually happen and it should be the better of the two
  surfaces.
- A sidebar count badge on the project, since an unread queue is an ignored queue.

### 4.7 Agent-facing guidance (the highest-leverage surface)

The feature's success is decided in `connectors/core/overlord-mission/SKILL.md`, not in the
schema. Without explicit calibration agents will file style preferences and the queue dies
in three weeks. The skill gets a bounded rule set:

> **Report an issue when** you encounter a concrete defect outside your objective's scope:
> a correctness bug, a security or data-loss risk, a missing authorization check, a test
> that cannot fail, or documentation that contradicts the code. State what you observed,
> where, and how you know.
>
> **Do not report** style preferences, refactors you merely prefer, anything you fixed as
> part of this objective, anything already covered by the mission you are on, or a
> suspicion you did not verify. Do not file more than a few per objective — if you are
> reporting constantly, you are reporting noise.
>
> If the response says `suppressed`, a human has already declined this finding; do not
> re-report it and do not work around it.

The same text belongs in `cli/docs/03-agent-protocol.md`,
`docs/src/content/docs/docs-for-agents/agent-protocol.mdx`, and `mcp.mdx`.

---

## 5. Contract impact — version 136

Per `CLAUDE.md` and the component-contract skill, this crosses module boundaries and
requires a contract bump before implementation. `136` is simply the next version after the
current `135`; renumber if another contract-modifying change lands first. The changes:

**Database Layer** — new core tables `issue_reports` and `issue_report_sightings`, in both
dialects. Core rather than `ext_` because they carry authorization, audit, and UI state.
`issue_reports.display_id` is `` `${workspace.slug}:R${sequence_number}` `` with a unique
`(workspace_id, display_id)` index; its counter is a new `counter_name = 'issue_report'` row
in the existing generic `mission_sequences` table, so no new sequence table is introduced.

**Closed vocabularies** (each requires this bump):
- `issue_reports.kind`: `bug`, `security`, `data_loss`, `regression_risk`, `tech_debt`, `test_gap`, `docs`, `other`
- `issue_reports.severity`: `critical`, `high`, `medium`, `low`
- `issue_reports.state`: `new`, `accepted`, `declined`, `duplicate`
- `issue_report_sightings.entry_point`: `in_flight`, `delivery`
- `mission_events.type` gains `issue_report`

**Open vocabularies** (additive, no constraint): `outbox_messages.topic` gains
`issue_report.created`; `entity_changes.entity_type` gains `issue_report`.

**Protocol Layer** — three new subcommands (`report-issue`, `list-issue-reports`,
`triage-issue-report`) in `contract/protocol-commands.yaml` and the `handlers` /
`SUBCOMMAND_PERMISSIONS` maps in `backend/protocol.ts`. Additive
`agentReport.issuesFound[]` on the delivery payload, and `issuesFound` on
`DeliveryPresentationV1` — both optional, so every existing delivery payload stays valid.

**Auth Layer** — new permissions `issue_report:create`, `issue_report:read`,
`issue_report:triage`. `create` and `read` join `MISSION_LIFECYCLE_GRANTS`; `triage` does
not, and is MANAGER/ADMIN by default in `overlord.rbac.toml`, with MEMBER granted
`issue_report:create` + `issue_report:read`.

**REST API Layer** — the six routes in §4.4, plus `IssueReportDto`,
`IssueReportSightingDto`, and `IssueReportListDto` in `packages/contract/src/index.ts`.

**MCP Server** — three tools in the hosted catalog and the connector shim; both
conformance manifests re-pin to contract 136.

**Connector Layer** — `SKILL.md` + `reference/cli.md` guidance, a new
`reference/issue-reporting.md`, per-adapter `commands/report-issue.md`, a connector version
bump per the `connector-versions` skill, and re-pinned adapter conformance manifests.

**Impact on components not otherwise changed:** the Mobile REST Consumer and Desktop Shell
need no change to keep working — the new `mission_events.type` value hits their documented
neutral-fallback path, and the new routes are additive. They gain the reports view whenever
they choose to.

---

## 6. Phasing

**Phase 1 — capture (the whole point).** Migrations, `packages/core/service/issue-reports.ts`
with fingerprint + merge semantics and `coo:R<n>` display-id allocation off the existing
`mission_sequences` counter, `report-issue` / `list-issue-reports` protocol subcommands
(project-pinned per §3.7), the `mission_events` row, permissions, DTOs, the two MCP
write/read tools, and the connector skill guidance. At the end of phase 1 findings are durably captured, deduped,
and visible in the mission activity feed — readable over CLI/MCP/REST even with no UI. This
is the phase that has to land; everything after it is triage ergonomics.

**Phase 2 — delivery integration.** `issuesFound[]` in the delivery report, post-commit
fan-out, presentation rendering, `GET /api/missions/:id/issue-reports`, and the
"Issues found" section on `DeliverySummaryCard` and the mission panel.

**Phase 3 — triage.** `triage-issue-report`, `PATCH` / `promote` / `DELETE` REST routes,
the per-project Reports view, sidebar badge, and the `issue_report.created` webhook topic.

Phases 1 and 2 are each a reasonable single objective; phase 3 is two (backend triage +
promote, then webapp).

---

## 7. Alternatives considered and rejected

**Reports as draft missions** (agents call the existing `create`). Zero new schema, and
agents can technically do it today. Rejected: no provenance, no dedup, no durable decline,
no severity, and every declined observation permanently occupies the mission board and the
mission id space. The board stops meaning "committed work" within a week.

**Reports as profile-owned `inbox_items`.** Reuses a working promote flow. Rejected: it is
private to whichever human's token the agent authenticated with, invisible to the team,
carries no link back to the discovering mission, and has no state to decline into — the
same finding returns forever.

**Reports as a mission artifact** (`add-artifact --type issue`). Cheapest possible option,
and it does put the finding in front of the reviewer. Rejected as the primary model:
artifacts are mission-scoped and unqueryable across missions, so there is no project-level
queue, no dedup across missions, and nothing an agent can consult before filing. It remains
a fine *secondary* rendering, and the mission-panel section in §4.6 delivers that benefit
without the limitation.

**Delivery-only reporting** (no mid-execution command). Half the cost. Rejected: it loses
every finding from a blocked, cancelled, or crashed objective, and it forces the agent to
carry the observation in context until the very end, which is exactly where detail is lost.

**No dedup in v1** ("we'll add it when it hurts"). Rejected: by the time it hurts the queue
is unreadable and the feature has already been turned off. The fingerprint is roughly thirty
lines and is what makes the difference between a queue and a landfill.

---

## 8. Resolved decisions

All four questions raised during review are settled. Each is reflected in the body sections
above; they are collected here so the implementing objective does not have to re-derive them.

1. **Reports get short display ids.** Confirmed. A report carries a workspace-scoped
   `coo:R41`-style id so a human can refer to one in conversation. See §3.6.
2. **Cross-project filing is restricted in v1.** A report from a live session always lands
   in that session's project; `--project-id` is honored only when there is no session, or
   when it names the session's own project. Re-targeting happens at triage, where a human
   picks the destination project on promote. See §3.7.
3. **No auto-promotion for `critical`/`security`.** Confirmed. The two are first-class
   `kind`/`severity` values that sort to the top of the queue and can drive notification,
   but every report reaches a mission only through explicit human triage. There is no path
   by which an agent's own classification creates work.
4. **No Inbox surfacing for now.** High-severity reports do not join the cross-workspace
   `GET /api/inbox/missions` card list. Reports are read in the per-project Reports view and
   in the mission-panel section (§4.6). Revisit once real triage volume exists — the
   `severity` column makes it a filter change, not a schema change.
