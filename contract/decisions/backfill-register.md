# ADR backfill register

Audit record of phase 3 of `planning/feature-plans/contract-adr-openapi-migration.md`
(ADRs 0004 and 0005). One row per provenance entry `## [95]` to `## [168]` in
[CHANGELOG.md](../CHANGELOG.md); versions 98, 100 and 102 never had an entry. This
register is not normative: it records where each binding statement of a provenance
entry now lives in the normative documents, which ADR records the decision, and what a
later version reversed.

Columns:

- **Original date**: the date of the commit that first added the version's
  "Version N Change Summary" to the former root `CONTRACT.md` (git history; all 71
  dates were recovered).
- **Binding statements**: interfaces, invariants, security or tenancy properties, data
  meaning, migration semantics and observable behaviour the entry stated.
- **Where it now lives**: `arch` = [architecture.md](../architecture.md), `prot` =
  [protocol.md](../protocol.md), `auth` = [authorization.md](../authorization.md),
  `conf` = [conformance.md](../conformance.md), `data` =
  [data/README.md](../data/README.md), `rest` = [api/rest-notes.md](../api/rest-notes.md),
  `comp` = [components.yaml](../components.yaml), `pcmd` =
  [protocol-commands.yaml](../protocol-commands.yaml), `hcs` =
  [harness-capabilities.schema.yaml](../harness-capabilities.schema.yaml). "Hoisted in
  phase 3" marks text this phase copied from the entry because no normative document
  carried it; "phase 2" marks text hoisted earlier.
- **ADR**: the record for a decision that still binds, or "changelog only" for a purely
  additive version.
- **Superseded by**: statements of the entry that a later version reversed; they were
  not hoisted.
- **Checked by**: `doc-only` (each statement located in a normative document by text
  search), or `code-checked` (the hoisted or located statements were also confirmed
  against the implementation).
  `sentence-audited` is added for the eleven entries audited sentence by sentence in
  168.0.3 (see "Sentence-level audit" below).

Contradictions found between an entry, the normative text and the code are listed in
the contract changelog entry for the version that adopted this register.

| Version | Original date | Ticket | Binding statements | Where it now lives | ADR | Superseded by | Checked by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 168 | 2026-10-26 | coo:1197 | `attachments.inbox_item_id` + index; Inbox attachment routes; owner-only storage read; storage-workspace selection; promotion re-point/copy/409; deletion tombstones; DTO fields | data `attachments`; rest REST API Layer (Profile-owned inbox capture); comp rest.owns; storage-workspace rule and promotion detail hoisted in phase 3 | 0047 | — | code-checked |
| 167 | 2026-10-24 | coo:1202 | required `deliveredAt` on summary risks/suggestions, projected from the delivery row | comp rest.owns (mission summary source timestamps); data `mission_summaries` | changelog only (shares 0046) | — | doc-only |
| 166 | 2026-10-24 | coo:1202, coo:986 | structured `DeferredWorkInputV1`/`DeferredWorkV1`, id derivation, no rewrite; `DeliveryDeferredWorkItemDto`; historical deferred work dropped; webhook shape; `summary_enabled`; `mission_summaries`/`_seen`; compose job and triggers; summary routes; operator-only parity exemption | prot Protocol requirements (Delivery evidence); data `deliveries`, `human_action_resolutions`, `mission_summaries`, `mission_summary_seen`, `worker_jobs`; arch Database Layer; rest REST API Layer (Mission summary, deferred-work resolution); compose triggers hoisted in phase 3 | 0045, 0046 | v139 rewrite rule reversed here | code-checked, sentence-audited |
| 165 | 2026-10-24 | coo:1199 | `FileChangeDto` shape; row identity objective+resource+path; `declaredPaths`; retired rationale/`changedFiles`; capture diagnostics; two reads (`changes` vs `objective-changes`); MCP parity; storage migrations; ledger v3; outcome gating; delivery-composition provenance; ended-session recovery | data Change Tracking, `agent_sessions` capture diagnostics; prot Protocol requirements; pcmd; comp protocol/cli/rest; hcs codec dialect; authorization.md allowlist (`objective-changes`); ended-session recovery hoisted in phase 3 | 0044 | supersedes parts of 113–116, 125 | code-checked, sentence-audited |
| 164 | 2026-10-23 | — (review 2026-10-23) | one MCP tool catalog, generated shim; REST delegates to `packages/core/service`; schedule errors carry `code: validation_error`; atomic scheduled-duplicate number; display-id objectives fix; Desktop shared helpers | arch MCP Server → Service Layer, REST API → Database "One implementation", Desktop Shell → CLI; rest REST API Layer (validation_error, hoisted in phase 3) | 0043 | — | code-checked |
| 163 | 2026-10-23 | coo:1174 | `update-objective --title`; MCP `title`; objective context includes `assignedAgent`, `model`, `reasoningEffort` | prot; pcmd; comp protocol.owns | changelog only | — | doc-only |
| 162 | 2026-10-21 | coo:1166 | `GET /api/objective-transcript` selection, paging, refresh rules; index | arch Mobile → REST (Objective Transcript Surface) (hoisted in phase 2); data `objectives` | changelog only | — | doc-only |
| 161 | 2026-10-20 | coo:1165 | `window.overlord.diagnostics` bridge, fixed 15 s capture, no arbitrary path or upload | arch Desktop Shell owns | changelog only | — | doc-only |
| 160 | 2026-10-08 | coo:1134 | My Missions board, routes, DTOs, vocabulary and `my_mission_positions` removed | data "Retired personal mission ordering"; comp | 0042 | — | doc-only |
| 159 | 2026-10-07 | coo:1125, coo:1127 | owner-only `/diagnostics` route; `chat_diagnostics` unredacted append-only store; privacy exception; performance aggregates; summary coverage and token budget; static cache; viewer windowing (UI only) | data `chat_diagnostics`; comp clientToConversation rules; arch Assistant Conversation Behaviour (Summaries, Context budget, Static-prefix cache) | 0041 | — | code-checked, sentence-audited |
| 158 | 2026-10-06 | coo:1117 | `assistant_write_scope` column and closed values; `PATCH /api/connections/:id` and its errors; enforcement re-reads row; off refuses next write | data `account_connections`; conf Closed vocabularies; rest REST API Layer (errors hoisted in phase 3); arch Backend → Outbound MCP Policy, Assistant Conversation Behaviour (Knowledgebase writes) | 0040 | — | doc-only |
| 157 | 2026-10-06 | coo:1117 | positive source-check cache 30 s per owner; connection row checked every time | arch Backend → Outbound MCP Access checks | 0039 | — | doc-only |
| 156 | 2026-10-06 | coo:1121 | default server / override / off; egress unchanged; no per-user servers; platform key (HKDF, `platform-*`), seal-key selection, re-seal, missing-key outcomes; availability reasons; startup log | arch Backend → Outbound MCP Configured server (phase 3), Assistant Conversation Behaviour; auth Auth Layer key ring (phase 3); data `account_connections.credential_key_id`; rest availability reasons (phase 3) | 0038 | supersedes v152/v153 "Knowledgebase key required" | code-checked, sentence-audited |
| 155 | 2026-10-05 | per:202.5h64 | exact-reference lookup; canonical Feature reference; `overlord_find_feature_missions`; `createdReceipts`; `set_properties` link guard; prompt v5; label | rest REST API → Database "Mission search versioning" (lookup, phase 2); arch Assistant Conversation Behaviour "Feature handoff" and Progress labels (phase 3); comp | 0037 | — | code-checked, sentence-audited |
| 154 | 2026-10-05 | per:202.62e3 | run-scoped `knowledgebaseWrite` grant and its validation; storage and inheritance; tool policy v2; guards and bounds; outcomes `conflict`/`uncertain`; sequential writes; `uncertain_write`; label | arch Backend → Outbound MCP (Policy, Tool policy version 2, Bounds); arch Assistant Conversation Behaviour "Knowledgebase writes" and Progress labels (phase 3); data `chat_runs` | 0036 | extended by v158 | code-checked, sentence-audited |
| 153 | 2026-10-05 | coo:1110 | two connection scopes and uniqueness; credential formats and key ring; missing-key outcomes; re-seal and sweep; migrations and adoption; GitHub OAuth properties; REST forms and errors; aliases and retirement criteria; DTOs; closed vocabularies; Local edition | data `account_connections`, `account_connection_authorizations`; conf Closed vocabularies; arch Extension → Account Connections; auth Auth Layer (key ring, GitHub OAuth, adoption hoisted in phase 3); rest REST API Layer (forms, errors, aliases hoisted in phase 3) | 0035 | "Knowledgebase has no fallback" superseded by v156 | code-checked, sentence-audited |
| 152 | 2026-10-05 | coo:1108, coo:1110, coo:1127 | assistant conversation interfaces (scope, REST, runs, leases, checkpoints, snapshot, private channel, sources, proposals/Create, Continue, notifications, connections, repository reads, runtime, hardening, account deletion) | arch Client → REST (Private Conversation Surface), Assistant Conversation Behaviour (phase 2, reviewed phase 3), Backend → Outbound MCP; data Assistant Conversations; conf Closed vocabularies; comp | 0034 | Local `/api/connections/*` rule narrowed by v153; Everhour/GitHub stores by v153; read-only allowlist by v154; KB variables required by v156; "any failure is revoked" source check — code answers `unknown` (see report) | code-checked, sentence-audited |
| 151 | 2026-09-28 | coo:1093 | `project_automation` preset, grants, `user_token_projects`, two-layer default deny, route allowlist, project predicate, Protocol `create` gate, creator-token attribution | auth "User tokens"; data `user_tokens`, `user_token_projects`, `missions` | 0033 | My Missions list entries by v160 | doc-only, sentence-audited |
| 150 | 2026-09-28 | coo:1098 | Human Actions rail and `GET /api/human-actions` removed; deferred-work resolution routes; migration | rest REST API Layer (deferred-work resolution); data `human_action_resolutions` | 0032 | — | doc-only |
| 149 | 2026-09-27 | coo:1083 | `pendingAsk` content-state (fields, three-day limit, 140 chars, hash, dispatch transitions) | arch Mobile → REST (Live Activity Push Surface) (fields and age hoisted in phase 3) | 0031 | — | code-checked |
| 148 | 2026-09-25 | — | `attachment-download-url --output`, token never exposed | prot Protocol requirements "Attachment download" and pcmd (hoisted in phase 3) | changelog only | — | code-checked |
| 147 | 2026-09-23 | coo:1045 | resolution `outcome`/`outcome_ref`; `DeliveryDto.deferredWorkItems` | data `human_action_resolutions`; rest REST API Layer | changelog only | rail part by v150; item shape by v166 | doc-only |
| 146 | 2026-09-23 | coo:1044 | lazily created queue behind a running sibling seeds it and starts unpaused | comp rest.owns (Run Queue family) | 0027 | — | doc-only |
| 145 | 2026-09-23 | — | Latch `agent-launch` extension: `launch.argv`, `launch.agent`, `launch.login_shell`; fallback | comp runner.owns (Latch launch path) | changelog only | — | doc-only |
| 144 | 2026-09-18 | coo:1025 | viewer `background` projected and frozen; explicit `--background`/`--foreground` gated on Latch `productVersion` | comp runner/cli (launch session viewer) | changelog only | — | doc-only |
| 143 | 2026-09-18 | — | enqueue cascade; bidirectional order write-through; dequeue to end; empty queues retire; `removedEmptyQueueId` | rest REST API Layer Run Queue family (hoisted in phase 3) | 0030 | supersedes v106 queued span | code-checked |
| 142 | 2026-09-15 | — | rail kind `blocking_action` | — | changelog only | v150 (rail removed) | doc-only |
| 141 | 2026-09-11 | coo:981 | no project inference; `--unassigned-to-project`; MCP `unassignedToProject`; prompt/record-work require project | prot Protocol requirements "Inbox capture"; arch MCP Server (corrected in phase 3); pcmd; comp | 0029 | — | code-checked |
| 140 | 2026-09-09 | coo:986 | deferred work = new work outside the mission; eligible subset; agent-report index ids | prot Protocol requirements (Delivery evidence) | 0045 | compose rewrite by v166; ids by v166 | doc-only |
| 139 | 2026-09-09 | coo:977, coo:986 | recovery actions pause the queue transactionally; composer rewrites deferred work | rest Run Queue family; comp | 0027 | deferred-work rewrite by v166 | doc-only |
| 138 | 2026-09-08 | coo:971 | deferred work joins the rail, `kind`, ids | — | changelog only | v150 (rail), v166 (ids) | doc-only |
| 137 | 2026-09-08 | coo:963 | human action `command`/`verify`/`link`; deterministic path-derived actions | prot Protocol requirements (Delivery evidence); data `deliveries` | changelog only | rail projection by v150 | doc-only |
| 136 | 2026-09-08 | coo:963 | `GET /api/human-actions` rail; `human_action_resolutions`; entity type | data `human_action_resolutions`; data Controlled Vocabularies (entity type) | changelog only | rail and route by v150 | doc-only |
| 135 | 2026-09-08 | coo:959 | per-item `agent`/`model` on create/prompt and REST; `--objective-agent`/`--objective-model`; MCP inputs | comp protocol.owns; arch MCP Server; pcmd | changelog only | — | doc-only |
| 134 | 2026-09-07 | coo:955 | `{ items, total, limit }` envelope for deliveries and file-changes | rest REST API Layer; comp | changelog only | — | doc-only |
| 133 | 2026-09-07 | coo:879 | `objectives.reopened_at` semantics; client run grouping | arch Database Layer; data `objectives` | 0028 | — | doc-only |
| 132 | 2026-09-07 | coo:941 | 21-day window for complete/cancelled on board reads; `includeAllCompleted` | comp rest.owns | changelog only | My Missions half by v160 | doc-only |
| 131 | 2026-09-03 | — | queues start paused; Direct Run resumes; pause/resume need `project:update` | comp rest.owns (Run Queue family); rest Run Queue family | 0027 | exception added by v146 | doc-only |
| 130 | 2026-08-31 | — | `delete-missions`/`delete-objectives` with `--confirm`; MCP destructive tools | pcmd; comp protocol/mcp | 0026 | — | doc-only |
| 129 | 2026-08-27 | coo:833 | `RunnerQueueProvider` transport; nullable ids for `local_target_mutation`; `LOCAL_TARGET_UNSUPPORTED`/`_TIMEOUT`; `sendLatchMessage` and loopback gateway; `discover` purge; answerable asks; `AgentRequestDto.delivery`; `answer` event type | data `execution_requests`; prot (AgentRequestDto.delivery, phase 2); arch Runner Layer (gateway and purge hoisted in phase 3); conf Closed vocabularies; comp | 0025 | — | code-checked, sentence-audited |
| 128 | 2026-08-26 | coo:863 | shared branch checkout resolution; `worktreePath` null; any-status branch switch; `BRANCH_WORKTREE_MISMATCH` retired | rest REST API Layer (Branch checkout resolution); comp | changelog only | — | doc-only |
| 127 | 2026-08-26 | coo:858 | Inbox missions exclude archived projects | rest REST API Layer; comp | changelog only | — | doc-only |
| 126 | 2026-08-26 | — | worktree automation is a user launch-session default; workspace fields mirror it | data `profiles`/`workspaces` settings | 0024 | — | doc-only |
| 125 | 2026-08-26 | — | codec path and patch-header fields; `--paths` on update/deliver | hcs codec dialect; pcmd; comp cli | changelog only | `direct` quality by v165 | doc-only |
| 124 | 2026-08-26 | coo:858 | overdue Inbox slice and ordering | rest REST API Layer; comp | changelog only | — | doc-only |
| 123 | 2026-08-25 | coo:858 | due-soon Inbox slice | rest REST API Layer; comp | changelog only | — | doc-only |
| 122 | 2026-08-25 | coo:854 | waiting vs blocked; reasons; serial-mission guarantee; retry semantics; dispatch triggers; `objective_sibling_active` | arch Runner → REST Run Queue boundary; comp; rest Run Queue family (`objective_sibling_active` hoisted in phase 3) | 0023 | — | code-checked |
| 121 | 2026-08-24 | coo:826 | delivered missions on the Feed; `before`/`nextBefore` | rest REST API Layer; comp | changelog only | — | doc-only |
| 120 | 2026-08-24 | coo:844 | Inbox missions = agent-authored Next only | rest REST API Layer; comp | changelog only | — | doc-only |
| 119 | 2026-08-24 | coo:826 | mission-anchored Feed; retired item kinds | rest REST API Layer; comp | 0022 | — | doc-only |
| 118 | 2026-08-24 | coo:826 | Next in the recent window is agent-only | — | changelog only | v120 (recent window removed) | doc-only |
| 117 | 2026-08-23 | coo:826 | `GET /api/inbox/missions` recent + agent-Next union | rest REST API Layer | changelog only | recent window by v120 | doc-only |
| 116 | 2026-08-23 | — | ledger-only change tracking cutover; `fileInputs` envelope; codec-gated `declared_edit`; ledger properties | prot; pcmd (`fileInputs`); comp cli/protocol; data Change Tracking | 0021 | rationale annotations, `changedFiles` on record-work, quality/overlap by v165 | doc-only |
| 115 | 2026-08-23 | — | CLI drains ledger before update/deliver; deliver needs only summary | comp cli | 0021 | `fallback_delta` by v116 | doc-only |
| 114 | 2026-08-23 | — | `sync-changes`; CLI ledger keyed by objective and session; cwd never selects | prot; pcmd; comp | 0021 | metadata fields by v165 | doc-only |
| 113 | 2026-08-23 | — | delivery non-blocking; salvage of malformed report items | prot Protocol requirements (Delivery evidence) | 0021 | identity `(objective_id, file_path)` by v165 | doc-only |
| 112 | 2026-08-23 | — | connector mutation-window evidence classification; hook-surface restrictions | prot Connector → Protocol (Hook Surface); hcs | 0021 | window classification left reserved by v116/v165 | doc-only |
| 111 | 2026-08-21 | — | `add-objectives` per-item `agent`/`model` | comp protocol.owns; pcmd | changelog only | extended by v135 | doc-only |
| 110 | 2026-08-21 | — | Run Queue read diagnostics; `diagnosticCode`; shared redaction | comp rest.owns; rest Run Queue family (`diagnosticCode` hoisted in phase 3) | changelog only | — | code-checked |
| 109 | 2026-08-21 | — | `GET /api/objectives/:id/effective-launch-config` | comp rest.owns; arch Runner Layer (launch-config resolution) | changelog only | — | doc-only |
| 108 | 2026-08-21 | coo:815 | Latch v1 conversation integration retired | arch Runner Layer, Runner → REST "Latch v2 boundary" | 0020 | — | doc-only |
| 107 | 2026-08-21 | coo:812 | `pending_delivery` counts as executing in projections; feed run state | rest REST API Layer (hoisted in phase 3) | changelog only | feed run items by v119 | code-checked |
| 106 | 2026-08-21 | — | first-wins `launched_at`/`started_at`; display order; mission-scoped lazy queues; forced removal; agent Run Queue commands | data `objectives`, `run_queues`; rest Run Queue family; pcmd; comp | 0018 | queued span and retire-on-removal by v143 | doc-only |
| 105 | 2026-08-20 | — | self-minted tokens consent to all workspaces; issuance ids not authorization inputs; owner from authenticated profile | auth "User tokens"; data `user_tokens` | 0019 | — | doc-only |
| 104 | 2026-08-20 | — (table cites many) | `PATCH /api/projects/:id/run-queues/order`; the embedded version table restates other versions | rest Run Queue family; table rows are provenance for their own versions | 0018 | — | code-checked, sentence-audited |
| 103 | 2026-08-20 | — | agent Run Queue commands through the service; `autoAdvance` derived and deprecated | pcmd; comp protocol.owns; rest Run Queue family | 0018 | — | doc-only |
| 101 | 2026-08-20 | coo:781 | `list-deliveries`, `launch-objective`, `reorder-future-objectives` and MCP tools forward to services | pcmd; arch MCP Server → Service Layer; comp | 0043 | — | doc-only |
| 99 | 2026-08-19 | coo:789 | `GET /api/search/v3` ranking, filters and caps | rest REST API → Database "Mission search versioning"; data `search_documents` | changelog only | — | doc-only |
| 97 | 2026-08-19 | coo:781 | human project references; `project_selection_required`; `--workspace-id`; `dueDatetime` date field | prot; comp; rest Mission search versioning | changelog only | — | doc-only |
| 96 | 2026-08-19 | coo:753 | My Missions as a status-type board | — | changelog only | v160 (My Missions retired) | doc-only |
| 95 | 2026-08-19 | — | organization-bounded consent; `authorizedWorkspaces` taxonomy; no oldest-membership fallback; search quotas and v2/v3 envelopes | auth "User tokens"; arch REST API → Database (Workspace resolution taxonomy); rest Mission search versioning | 0017 | — | doc-only |

## Sentence-level audit

Contract 168.0.3 audited the eleven largest entries sentence by sentence: 152, 153, 165, 104,
166, 151, 156, 159, 129, 154 and 155. Each entry was split mechanically into sentences (on
`.` and `;` boundaries and list items, so counts follow that split) and every sentence was
classified:

- **a**: binding and present in a normative document;
- **b**: binding and missing or weaker in the normative documents, now hoisted after the
  code confirmed it;
- **c**: superseded by a later version;
- **d**: not binding (narrative, impact notes, rollout status, client UI, and the internal
  details an entry itself declares to change no stable interface);
- **e**: contradicts the current code; recorded, not hoisted.

For `[104]` the embedded version-history rows for versions 0–94 (94 rows; there is no row
for 43) are provenance and were not audited; the introduction and the rows for 95–135 were.
In `[152]` the 251 sentences that match `architecture.md` "Assistant Conversation
Behaviour" nearly verbatim were confirmed by matching and spot reading; every other sentence
of every entry was read against the normative documents.

| Version | Sentences | a | b | c | d | e |
| --- | --- | --- | --- | --- | --- | --- |
| 152 | 280 | 251 | 0 | 3 | 25 | 1 |
| 153 | 152 | 109 | 13 | 1 | 29 | 0 |
| 165 | 82 | 49 | 19 | 0 | 14 | 0 |
| 104 | 93 | 58 | 6 | 8 | 21 | 0 |
| 166 | 54 | 31 | 9 | 0 | 14 | 0 |
| 151 | 31 | 24 | 2 | 0 | 5 | 0 |
| 156 | 60 | 34 | 0 | 0 | 26 | 0 |
| 159 | 55 | 15 | 10 | 0 | 30 | 0 |
| 129 | 23 | 18 | 4 | 0 | 1 | 0 |
| 154 | 34 | 17 | 8 | 1 | 8 | 0 |
| 155 | 31 | 19 | 0 | 0 | 10 | 2 |

### Hoisted (b)

- `[153]`: envelopes are in the AES-256-GCM `v1` format (data `account_connections`); the
  Everhour adoption skips a profile that already has an Everhour connection in any state, no
  key is needed at migration time and no plaintext is in flight, and SQLite rebuilds
  `account_connections` preserving rows, foreign keys and `chat_source_refs` links (data
  `ext_everhour_user_connections`); the `AccountConnectionDto` fields and the request and
  response DTO names of the connection routes (rest, profile-scoped account connections).
- `[165]`: the exact `FileChangeDto` shape, `null` source shown as Unknown and never
  relabelled native, clients derive the basename, and a blank or repeated `objectiveId` is
  rejected with 400 (rest, File-change reads); the changed-file list is not a Git diff,
  snapshot, ownership proof or completeness proof (data `changed_files`); capture warnings
  derived across all sessions (data `agent_sessions` capture diagnostics); the provenance
  mapping of migration `20261024120000` (data, retired columns); the webhook envelope's
  `changedFiles` item shape and absence of `changeRationales` (rest, webhook envelopes);
  `TradeoffMadeV1.source` only `agent` and composed tradeoffs cite only agent tradeoff ids
  (data `deliveries`); CLI `attach --capture-binding` derivation and the CLI-local
  `ovld protocol changes` read (prot, Changed-file tracking); `ovld changes status` and the
  removed rationale commands and flags (arch CLI Layer); the event codec dialect
  `outcomeExitCodePrefix`, numeric `outcomePath`, `successOnly`, unknown-never-success and
  `*** Move to:` reduction (arch Connector Layer). `components.yaml` said `FileChangeDto` has
  five fields "only"; it now names the exact eight-field shape the code has.
- `[104]` (rows): Run Queue dispatch through a project-deduped durable worker job that
  promotes only the selected future objective (row 102; data `run_queue_entries`);
  `overlord_search_missions` v3 default and `detail` `compact`/`full` semantics (row 100;
  arch MCP Server); project reference resolution, case-insensitive names,
  `project_selection_required` shape and `--workspace-id` narrowing (row 97; prot Protocol
  requirements "Project references").
- `[166]`: the `DeferredWorkV1` id derivation and its fixture (prot, Delivery evidence); the
  historical deferred-work migration preserving every other report field and refreshing
  search documents (data `human_action_resolutions`); eligibility learned only from the
  summary envelope, the evidence contents, open suggestions carrying every field, the
  `watermark` and the evidence maximum (rest, Mission summary).
- `[151]`: routes outside the `project_automation` allowlist may be added only with the
  project predicate in place, and no allowlisted route is widened for any other caller
  (auth, User tokens).
- `[159]`: the diagnostics route's `after` rules, page order, entry fields and open kinds
  (rest, new "Owner-only chat diagnostics" item); what `chat_diagnostics` captures, capture
  independent of the display setting, escaped rendering, headers and credential envelopes
  not copied, never entering snapshots, SSE, global logs, search, webhooks or provider
  history, and reads never invoking tools or changing authorization (arch Assistant
  Conversation Behaviour, new "Owner-only diagnostics" paragraph); the summary coverage
  boundary validation (arch, _Summaries_ _Coverage_).
- `[129]`: the runner-queue transport returning `transport: 'runner_queue'`, nullable
  `ExecutionRequestDto` mission and objective ids, and `capability_call` (arch Runner
  Layer); a refused `sendLatchMessage` carries Latch's `state.sendMessage.reason` (arch
  Runner Layer).
- `[154]`: the revision-guard names, nested-JSON bounds, what stays outside the policy, no
  Knowledgebase write OAuth scope, `toolPolicyVersion` not gating tools, and the
  `conflict`/`uncertain`/safe outcome details with `response_too_large` (arch Backend →
  Outbound MCP, Tool policy version 2).

### Contradictions (e)

- `[152]`: a failed Knowledgebase source check "is treated as revoked"; the code
  (`backend/connections/source-check.ts`) and architecture.md answer `unknown` for a
  connection that is not connected and for other failures (both fail closed). Recorded in
  168.0.2.
- `[155]`: `createdReceipts` lists "up to five created cards"; the code
  (`packages/core/service/chat/runs.ts`) selects the five most recently updated non-open
  (created or cancelled) cards, which architecture.md describes. Recorded in 168.0.2.
- `[155]`: "System prompt `overlord-assistant-v5`"; the code has
  `SYSTEM_PROMPT_VERSION = 'overlord-assistant-v8'` (`backend/chat/gemini-runtime.ts`).
  `components.yaml` (`rest.owns`, assistant Feature handoff) still says
  `prompt overlord-assistant-v5`; that normative text is stale and left for a follow-up
  correction.

### Superseded (c)

`[152]`: Knowledgebase-only `account_connections` uniqueness clause, the unchanged
Everhour/GitHub stores and their superseded note (`[153]`); `[153]`: Knowledgebase has no
fallback key (`[156]`); `[104]` rows: `ActivityFeedRunItemDto` run state (`[119]`), retire
on emptying a mission queue (`[143]`), My Missions board (`[160]`); `[154]`: system prompt
`overlord-assistant-v4` (`[155]`).

Ticket-tagged labels such as `(coo:1108.k0tc)` remain on seven bold or italic paragraph
labels in architecture.md (none in a `#` heading); they do not break reading and were left.
