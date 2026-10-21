# Bounded Compose history and mobile handoff

Mission `coo:1166`, backend objective `coo:1166.ww5f`, 2026-10-21.
Authoritative base: Overlord `9667a3c6f4a006250235cfb56da0a6d1a80cc62a` plus this
uncommitted patch, contract **162**. Nothing was staged, committed or deployed.
Mobile integration belongs to `coo:1166.rpng`; device profiling to `qbzn`.

## Decision and evidence

Add `GET /api/objective-transcript`. The project mission list embeds objectives
in a batch, but has no objective-history limit: only old *terminal missions*
are windowed. An active mission's old objectives all travel. Compose applies
its 20-day display filter after retrieval. The activity feed selects running/
recently delivered missions and truncates instructions; search selects matching
documents rather than a complete chronological transcript. Neither is adequate.

Read baseline: sibling `OverlordMobile/docs/compose-mission-jitter-investigation.md`,
the current `MissionChatModel`, `WorkspaceData`, `MissionChatFeed`, and mission
artifact `7674013c-f016-4cc4-9f49-a986786d8442`. Prior objectives moved transformations
off MainActor, scoped/coalesced refreshes and deferred covered screens. This
objective bounds objective retrieval; it does not remeasure those CPU/device results.

Reproduce with Node 24:

```sh
node --import tsx backend/objective-transcript.bench.ts --http
```

This creates a disposable migrated SQLite file, authorized operator, 1 or 10
active projects, 10 or 1,000 nonterminal missions, three objectives per mission,
and 4,096-character instructions. 80% of objective timestamps are 100 days old;
20% are one day old. Histories are synthetic, not a measurement of the user's
account. The harness wraps the actual authorized read services in loopback
HTTP and includes serialization, transport and client JSON parsing. It does
not run deployed authentication middleware, WAN transport, compression, Swift
decoding or iPhone rendering. One warmup precedes seven measured iterations.

| Workload / read | Objective requests | Response bytes | DB calls | DB rows returned | Loopback median / maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 missions / 30 objectives, existing | 1 | 158,073 | 11 | 48 | 3.86 / 4.59 ms |
| Same, new first page (30 rows) | 1 | 147,460 | 6 | 35 | 2.74 / 5.09 ms |
| 1,000 missions / 3,000 objectives, existing | 10 | 15,820,432 | 110 | 4,080 | 158.70 / 177.17 ms |
| Same, new first page (50 rows) | 1 | 246,075 | 6 | 56 | 3.23 / 3.46 ms |

DB calls/rows include the local fallback membership/role reads. They count
returned rows, **not** storage reads or every scanned row. Authenticated HTTP
requests normally supply the authorized workspace/role snapshot already;
history selection itself is one SQL statement. Each workspace uses the live
`(workspace_id, created_at, id)` index with a page-plus-one LIMIT before the
bounded candidates are merged. SQLite query-plan regression verifies index use;
both SQLite and PostgreSQL run the ordering/isolation/query-bound battery.
There is no COUNT, mission aggregate or per-objective session/queue hydration.

The large first-page payload is about 98.4% smaller. A full archive still costs
all its pages if explicitly requested; this comparison is initial reads, not
pretending the complete archive is represented by 50 rows. Project-selection,
members, settings and private Inbox requests are excluded from both counts.

## Endpoint and payload

Authenticated `GET /api/objective-transcript` returns
`ObjectiveTranscriptPageDto` from `packages/contract/src/index.ts`. Responses
are `Cache-Control: no-store`. Existing routes and DTOs remain compatible.

| Query | Semantics |
| --- | --- |
| absent | Latest 50 live objectives, newest first |
| `limit=1..100` | Page row count (default 50) |
| `before=<cursor>` | Strictly older `(createdAt, id)`, descending |
| `after=<cursor>` | Strictly newer `(createdAt, id)`, **ascending**; drain pages in this direction |
| `ids=<uuid>,<uuid>` | Revalidate 1–100 distinct objective UUIDs; returns available rows, descending, no paging; no `limit` |

`before`, `after`, `ids` are mutually exclusive. Unknown, duplicate/array-valued,
malformed and oversized query values are 400. `ids` cannot exceed 3,699 characters.
Cursors are opaque, canonical base64url of a versioned position, at most 256
characters. Clients store them verbatim and must not synthesize them.

```ts
interface ObjectiveTranscriptPageDto {
  items: ObjectiveTranscriptItemDto[];
  nextBefore: string | null;
  nextAfter: string | null;
  newestCursor: string | null;
  hasMore: boolean;
}
```

Every item has these exact fields:

| Fields | Types and meaning |
| --- | --- |
| `id`, `workspaceId`, `projectId`, `missionId` | strings; `id` is the stable objective UUID |
| `missionDisplayId`, `missionTitle`, `missionRevision`, `statusType` | string, string, number, `StatusType`; current parent presentation |
| `projectName`, `projectColor`, `projectRevision` | string, string-or-null, number; current project presentation |
| `title`, `instructionText`, `state` | string-or-null, full string, `ObjectiveState` |
| `assignedAgent`, `resourceKey` | string-or-null each; current assignment |
| `createdByKind`, `createdByAgent`, `createdByWorkspaceUserId` | `CreatedByKind`, string-or-null, string-or-null; authorship, independent of assignment |
| `createdAt`, `updatedAt`, `revision` | canonical UTC timestamp strings and number; objective identity/revision |

No text truncation is introduced. The bound is **100 rows, not a hard byte
ceiling**: a very large instruction can still be expensive. Preserve full text
and profile decoding off the UI actor rather than silently cutting user text.
This projection intentionally omits mission aggregate counts, launch overrides,
queue details and external session IDs; fetch existing mission/detail APIs on
explicit navigation or mutation. Do not convert it into an incomplete `MissionDto`
and publish that into the shared full-mission cache.

`nextBefore` is non-null only if another older history page exists. For `after`,
`nextAfter` always carries the last returned position, or the input cursor when
empty; `hasMore` tells whether to immediately continue draining. `newestCursor`
is the maximum returned key, null on an empty page. Preserve the prior high-water
position across empty responses and older-page reads. ID revalidation is not a
new-creates high-water advance. Display a deduplicated ascending transcript;
never use array index, instruction text or objective position as row identity.

## Authorization and incremental correctness

Every call obtains the active-organization authorization snapshot (or derives
live memberships for trusted Local calls), then requires both `mission:read`
and `objective:read` per workspace. Token project allowlists narrow selection
before LIMIT. An unreadable workspace contributes nothing. Deleted workspaces,
projects, missions and objectives, and archived projects, are excluded. Completed
mission history is available through older pages rather than the board's terminal
window. Cursors cannot grant access; a cursor's referenced row need not survive.
The existing `project_automation` route allowlist keeps this new aggregate route
closed; it has not been expanded. Other scoped tokens must pass both read scopes.

The history cursor is a live keyset, **not a change-log cursor or a snapshot**.
Use the existing authorized `GET /sync/changes?after=<seq>` / realtime stream
to learn which entities changed. Its bounded batches supply `changes`, `cursor`,
`hasMore`; drain and retain that independent sequence. Start buffering changes
before the initial transcript read, then apply them afterward, so an edit or
deletion concurrent with initial loading is not lost. The `after` transcript mode
is a convenient catch-up for normally timestamped new creates, not a replacement
for change replay: an insert committed later at the same timestamp with a lower
UUID, or a backdated insert, can sort before its high-water position.

For objective creates/edits/deletes, revalidate the named objective UUIDs in batches
of at most 100, including new IDs from change notices. Returned rows replace the
cached item; absent requested IDs remove it. Absence deliberately does not reveal
whether an ID was deleted, moved out of scope, or never existed. To refresh a
changed mission or project, revalidate loaded row IDs whose parent matches;
current metadata, attribution and resource/agent/project assignments arrive with
each row. This work is proportional to the loaded window, not the archive. Retain
bounded pending dirty IDs while covered; critical/local actions keep their prompt path.

At foreground/reconnect, replay changes and revalidate the loaded window in bounded
chunks to remove stale/deleted/revoked rows, while merging a fresh head read and
draining new creates. If replay continuity is unavailable or an unknown notice
cannot be routed, rebuild the loaded history window with bounded pages; do not
treat `after` as proof that nothing older changed. A permission expansion or
newly accessible project requires a fresh bounded history walk because older rows
may have become visible. Clear account/backend/organization-scoped state on a
scope change; fence late responses with the existing session epoch/load ticket.
Merge overlapping pages by ID; do not let an older in-flight response overwrite
a later accepted revalidation. Keep loaded pages, draft, focus and scroll anchor
on warm reopen; older-page insertion must preserve the current visible anchor.

## Private Inbox and optimistic creation

Profile-owned `/api/inbox` captures never enter the workspace transcript SQL or
workspace change feed. Keep their existing owner-only API and identities. Read
their authoritative set on initial load/reconnect/foreground and after local
create/edit/delete/promotion; absence removes a former capture. That existing
API remains a full capture-set read, so this objective does **not** claim to bound
all possible Compose traffic. No cross-profile capture is exposed by the new read.

On mission creation, reconcile the pending bubble with the returned first
objective UUID; for add-objective use its returned UUID. The same ID appearing
through a page or realtime revalidation is the same bubble. Inbox creation uses
the returned Inbox UUID. On promotion, consume that capture UUID and reconcile
against the created mission's returned objective IDs atomically in local state;
do not show capture and mission duplicates. Keep creation provenance separate
from assigned agent; `agent` rows are attributed to `createdByAgent`, while
human/automation rows retain existing presentation semantics.

## Integration and runtime status

The next mobile objective should vendor the two DTOs, consume the new endpoint
and declare contract 162 against the upstream base plus this patch. The migration
`20261021090000_objective_transcript_index` must run in the backend's edition.
No secret, feature flag or additional consent configuration is required.

The endpoint is **implemented and tested locally**, **not deployed**, and **not
verified available to the installed phone app**. Mobile sources were read only.
Existing app builds still use the old APIs until `rpng` integrates this read.
Use the supported backend contract/capability to select compatibility behavior;
do not fall back to all-project objective fan-out on ordinary HTTP, decoding,
authentication or cancellation errors. If pre-162 servers remain supported, keep
an explicitly selected and tested legacy path limited to that declared version.

Validation: 27/27 transcript and adjacent regressions pass across SQLite and
disposable Docker PostgreSQL. The transcript conformance battery covers both database adapters,
equal timestamps, deletion of cursor rows, multiple incremental pages, late
edits/creates, full Unicode text, attribution, reassignment, membership revocation,
organization/profile/token isolation, live ancestors, malformed cursors and a
single bounded projection using the history index. Adjacent mission move, board
window, Inbox and route-guard regressions also pass. Backend typecheck reports
only the pre-existing `runner-claim-http.test.ts:39–40` TS2345 errors. No device
latency, WAN improvement or production rollout is inferred from these checks.
Core typecheck and upstream conformance-version checks pass. The mobile checker
currently fails on its expected v161/v162 manifest mismatch; `rpng` must perform
the actual client audit/update rather than only changing that version number.
The production backend bundle builds successfully, including staging migrations
for both editions. Generated tracked bundles were returned to their initially
clean contents after verification; the delivery contains the source changes.
