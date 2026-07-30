# Resource Materialization for Execution Targets

**Status:** design — contract-first implementation plan, nothing implemented.
**Origin:** the out-of-scope gap recorded during the coo:522 architecture review and carried in
`planning/feature-plans/execution-target-identity.md` §4.4 ("a build box that clones fresh per run").
Tracked as objective 3 of coo:528.

**Relationship to execution-target identity:** this plan does not change target identity,
registration triggers, adoption, liveness, routing granularity, or the `local`/`virtual` security
split. It answers a different question: once a target is declared and claims work, **where does the
working directory come from when the project's source is a Git URL rather than a checkout on that
machine?**

---

## 1. The gap, precisely

`assertPrimaryResourceConnected` (`packages/core/service/projects.ts:444-480`) resolves the primary
resource for a target and rejects it unless the source is a local checkout:

- `rowToProjectResourceSummary` (`projects.ts:499-524`) maps `source_kind = 'local_checkout'` to type
  `local_directory` and reads the working path out of `descriptor_json.path`; every other
  `source_kind` (`git`, `source_bundle`, …) becomes `remote_directory` with an empty path.
- The assert then throws `primary_resource_not_connected` with _"Primary resource type
  \"git\" is not supported for local agent runs yet."_ `assertObjectiveResourceConnected`
  (`projects.ts:589-631`) does the same for a resource-bound objective.
- `resolveWorkingDirectory` (`projects.ts:697-753`) is the single funnel for both queue time
  (`execution-requests.ts:414`) and claim time (`execution-requests.ts:607`). On a local claim the
  failure is converted into a terminal `failed` request (`execution-requests.ts:614-626`).
- `findProjectResourceRow` (`projects.ts:381-424`) will happily resolve a **global** (null-target)
  Git source for a device target — target-scoped rows merely win precedence — so a device target can
  look eligible in project settings and still fail at claim. A global Git source also contributes no
  path to `OVERLORD_PROJECT_RESOURCES_PATHS` (`project-resource-manifest.ts:141` skips every
  non-`local_checkout` row), so even a successful launch would have no sibling resource paths.

So the failure is not a missing feature flag in one place; it is a structural assumption:
**Overlord's local path resolves an absolute filesystem path server-side, before the machine that
owns the filesystem is ever consulted.** That assumption holds for `add-cwd`, which is exactly a
human saying "this path, on this machine, is the checkout". It cannot hold for a build box that has
no checkout until the run starts.

The virtual path already made the opposite choice. `VirtualExecutionQueueItemV1` "carries resource
identities plus typed sources, not paths" (CONTRACT.md v3), `resolveWorkingDirectory` never runs on a
virtual claim, and the gateway owns "source/environment realization and observed-state reporting"
while Overlord owns "durable queue delivery, leases/retries, and status transitions". That boundary
rule is the right one. It is simply unavailable to the runner that is already installed on the build
box.

---

## 2. Decision

> **Materialization is a provider-neutral contract, not a gateway-exclusive one. The device runner
> is its first implementer. Overlord never materializes anything itself and never invents a path for
> a source it cannot see.**

Three options were considered.

**(a) Gateway-exclusive — tell build boxes to become virtual targets.** Rejected. Realizing a Git
clone would require the operator to stand up an external service implementing the whole
`/api/virtual-targets/v1/*` surface (registration, claim, progress, launched, failed, grant
exchange, mission resources, delegated actions), obtain a target-scoped gateway credential, and
author environment definitions — to run `git clone`. It also excludes Local mode outright, which has
no gateway and is where single-user build boxes actually live. The gateway boundary exists to let a
*foreign system* own realization; it is not a prerequisite for owning a directory you already own.

**(b) Server-side materialization — the backend clones and hands the runner a path.** Rejected
outright. In Cloud the backend has no access to the runner's filesystem at all, so it is not
implementable; in Local it would make the backend a credential-holding Git client and would
reintroduce exactly the server-resolves-the-path assumption that caused this gap. It would also
force Overlord to store remote-repository credentials for every project.

**(c) Provider-neutral materialization contract (chosen).** The *desired* materialization plan is
computed and frozen by Overlord at queue time from data it already owns
(`project_resource_sources`). The *observed* realization — the actual directory, the actual commit —
is reported by whoever claimed the request. A device runner and a virtual gateway are two
implementers of the same plan vocabulary; they differ only in what the plan is allowed to contain
(§8) and in which REST surface carries it.

This is the same desired/observed split the virtual boundary already states, extended one step so it
also governs the local path. It costs no new tables, does not weaken target/source separation (the
source stays a `project_resource_sources` row; the target only declares a capability), and keeps
Local and Cloud on one code path.

There is already precedent for runner-owned filesystem work: branch preparation creates worktrees
client-side and reports the resulting path back through `POST /api/missions/:id/branch-prepared`
(`cli/src/branch-preparation.ts:409-469`). Materialization is the same shape one step earlier in the
launch sequence.

### The invariant this introduces

| Today (local path)                                | After                                                          |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Server resolves an absolute path at queue + claim | Server resolves a resource **identity + desired plan**          |
| Path is authoritative and stored before the run   | Path is **observed**, reported by the claimant, display-only    |
| Non-`local_checkout` source = hard failure        | Non-`local_checkout` source = materialize, if the target can    |

`local_checkout` sources are unchanged: they are already-materialized resources, resolved exactly as
today. Materialization is strictly additive and only reached when the resolved source for a target
is not a local checkout.

---

## 3. Model

Two objects, one new vocabulary, no new tables.

**`ResourceMaterializationPlanV1`** — desired state, computed by the service layer at queue time,
frozen into the request's snapshot, and returned to the authorized claimant:

```jsonc
{
  "schemaVersion": "v1",
  "resources": [
    {
      "resourceId": "…",
      "resourceKey": "primary",
      "isPrimary": true,
      "accessMode": "read_write",
      "sourceId": "…",
      "sourceKind": "git",
      "mode": "ephemeral",              // ephemeral | cached
      "descriptor": {                    // kind-specific, non-secret
        "url": "https://github.com/acme/web.git",
        "ref": "main",
        "depth": 1,
        "submodules": false
      },
      "credentialRef": "github-app:installation" // reference only, never a secret
    }
  ],
  "planDigest": "sha256:…"
}
```

**`ResourceMaterializationObservationV1`** — observed state, reported by the claimant:

```jsonc
{
  "resourceId": "…",
  "workingDirectory": "/var/lib/overlord/work/…", // claimant-owned, display-only
  "observedRevision": "9f2c…",
  "observedContentDigest": "sha256:…",
  "reusedCache": false,
  "materializedAt": "2026-07-30T10:00:00.000Z"
}
```

The plan is authored by Overlord and is immutable per request; the observation is authored by the
claimant and never rewrites the plan. Overlord's status machine is untouched: materialization
happens inside the existing `claimed → launching` window and its failures are ordinary request
failures with `failure_phase = 'source'`.

---

## 4. Desired source input and user intent

Materialization is **opt-in per (execution target, resource)** and is declared by a human on the
machine that will do the work — the same intent rule §4.4 established for registration. Nothing
about installing a runner, authenticating, or adding a global Git source turns materialization on.

Two facts must exist before a target can materialize a resource:

1. **A materializable source resolved for that target.** Either a project-global `git` source (the
   common case — one repository URL for the project) or a target-scoped source when this machine
   needs a different ref/mirror. Precedence is unchanged: target-scoped beats global.
2. **A target-scoped materialization policy**, stored as a target-scoped
   `project_resource_sources` row of `source_kind = 'materialized'` whose descriptor names the
   source it materializes and how:

```jsonc
{
  "materializes": { "sourceId": "…" },     // or { "sourceKind": "git" } for "whatever the project's git source is"
  "mode": "ephemeral",                      // ephemeral | cached
  "workspaceRoot": "/var/lib/overlord/work", // local targets only; see §8
  "retainFailedHours": 24
}
```

Keeping the policy in `project_resource_sources` rather than on `execution_targets` is deliberate:
it is per-resource (a project may materialize its primary and mount a sibling), it inherits the
existing target-scoped precedence, soft-delete, revision, and the v27 per-source DELETE route, and
it keeps `execution_targets` free of source data. Target/source separation is preserved: the target
row still says only *who runs*; the source rows say *what to materialize and how*.

**CLI (new, explicit):**

```
ovld add-materialized --project-id <id> [--key <resourceKey>] \
    [--from-source <sourceId> | --url <git-url> [--ref <ref>]] \
    --root <dir> [--mode ephemeral|cached] [--retain-failed <hours>]
```

Run on the build box, authenticated as a member with project update permission. It resolves this
machine's already-declared execution target (it is **not** a target declaration path — a machine with
no target fails with the usual `no_execution_target_registered` and the `ovld add-et` hint), creates
the global `git` source when `--url` was given and none exists, and writes the target-scoped policy
row. `--root` must be an absolute path that exists and is writable on that machine; the CLI verifies
this locally before the write so the failure is immediate rather than at first claim.

**REST:** additive fields on the existing `POST /api/projects/:id/resources` — `materialization: {
sourceId?, sourceKind?, mode, workspaceRoot?, retainFailedHours? }` with `executionTargetId`
resolved from the caller's machine hint exactly as checkout linking does today. Removal reuses the
v27 `DELETE /api/projects/:id/resources/:resourceId/sources/:sourceId`.

**UI:** Project settings → Resources shows, per target, either "checkout at `<path>`" or
"materialized from `<source>` (`ephemeral`/`cached`)". Workspace settings → Execution Targets shows
a target's materialization roots as diagnostics. Neither surface is a creation path in phase 1; the
declaration stays on the machine that owns the directory.

---

## 5. Eligibility and resolution changes

`assertPrimaryResourceConnected` / `assertObjectiveResourceConnected` stop returning a bare
`workingDirectory` and return a discriminated resolution:

```ts
type LaunchResourceResolution =
  | { mode: 'attached'; resource: ProjectResourceSummary; workingDirectory: string }
  | { mode: 'materialized'; resource: ProjectResourceSummary; plan: ResourceMaterializationPlanEntry };
```

Resolution must become **explicit about precedence rather than relying on `LIMIT 1`.** Today
`findProjectResourceRow` joins one arbitrary active source and orders only by target-scoped-first
then `pr.created_at`; with two plausible sources per resource (a target-scoped policy and a global
`git` row) that ordering is no longer decidable at the resource level. The resolver loads **all**
active sources for the resolved resource and applies:

1. A target-scoped `local_checkout` source → `attached`, exactly as today, including the existing
   `status === 'missing'` check. An already-materialized machine keeps winning, so nothing regresses.
2. A target-scoped `materialized` policy whose named source (target-scoped, else global) resolves →
   `materialized`. A policy naming a source that no longer exists is a configuration error and fails
   with an actionable message rather than falling through.
3. A global `local_checkout` source → `attached` (existing fallback behavior).
4. Otherwise `primary_resource_not_connected` / `objective_resource_not_connected`, with the message
   widened to name both repairs: link a checkout (`ovld add-cwd`) **or** configure materialization
   (`ovld add-materialized`).

Related drift worth fixing in the same pass: the schema contract documents "unique active
`(resource_id, execution_target_id, source_kind)`" for `project_resource_sources`, but both shipped
migrations create only plain non-unique indexes (`idx_prs_resource_target`,
`idx_prs_project_source_kind`). The resolver must therefore tolerate duplicates deterministically
(newest active row wins within a precedence tier) even if the missing unique indexes are added
later — adding them is a separate, optional cleanup and is not a prerequisite here.

`resolveWorkingDirectory` returns `{ workingDirectory: null, resourceId, materialization }` in
materialized mode. Two call-site consequences:

- `execution_requests.resolved_working_directory` stays **null** until the claimant reports one. It
  is already a nullable column, and the contract already says it is never set for a virtual target;
  the wording becomes "set only for an attached resolution".
- The SQLite-only `existsSync` guard in `resolveWorkingDirectory` (`projects.ts:706-712`) must not
  run for a materialized resolution — the directory legitimately does not exist yet. The guard stays
  for explicit working directories and attached resources.

`OVERLORD_PROJECT_RESOURCES` / `_PATHS` are built after materialization, not before: the manifest
builder (`project-resource-manifest.ts:141`) contributes the **observed** directory for a
materialized entry and continues to contribute nothing for an unmaterialized remote source. In
practice this means the runner builds the launch env after its materialization step, from the
manifest plus its own observations.

Eligibility in project settings gains a third legible reason (§4.5's "declared + reachable + has a
source"): a target is eligible when it has an attached checkout **or** a materialization policy for
the primary resource.

---

## 6. Queue snapshots and determinism

Materialized requests get an immutable snapshot, reusing `execution_request_snapshots` and the
existing nullable `execution_requests.launch_snapshot_id` FK. No new table, no new column.

- At queue time, in the **same transaction** as the `queued` request (the rule that already governs
  virtual snapshots), the service writes one snapshot row with `schema_version = 'materialization.v1'`
  and `payload_json` = the `ResourceMaterializationPlanV1`, and `payload_digest` = SHA-256 over the
  canonical payload. The schema contract note "Null for local targets" becomes "Null unless the
  request carries a materialization plan or a virtual queue item."
- The plan pins the **ref as authored** (`main`, a tag, or an explicit SHA) — not a resolved commit.
  Overlord does not talk to the remote and must not pretend to know its head. Determinism is
  therefore "same plan every attempt", not "same commit every attempt"; a user who needs commit
  determinism pins a SHA in the source descriptor. The observed revision is recorded per attempt so
  the difference is always visible after the fact.
- **Retry reuses the snapshot** and increments `attempt_count`, exactly as virtual retries do. A
  re-queued request is a new request and gets a new snapshot — which is how a user picks up new
  commits.
- The claim response carries `snapshotDigest`; the claimant echoes it on `launching`/`launched` and a
  mismatch is rejected, mirroring the existing virtual digest verification.

---

## 7. Credentials and grants

**Phase 1: no credential crosses any boundary.** The plan carries the repository URL and ref (data a
project member can already read in project settings) and, optionally, an opaque `credentialRef`
*name*. The device runner authenticates to the remote with the machine's own ambient Git credentials
— SSH agent, `credential.helper`, `gh auth`, a deploy key — which is what every CI machine already
has and what an operator expects to control. A `credentialRef` is resolved **locally** by the runner
against its own config (`ovld runner credential map <ref> <helper>`); Overlord stores only the name.

This makes the common build-box case implementable with zero secret handling, and it is the reason
this phase can ship independently.

**Phase 2 (optional, only if a real need appears): server-mediated, short-lived, single-use.** Reuse
`execution_request_grants` with the existing open-vocabulary kind `credential_reference` and add
`POST /api/runner/grants/:id/exchange`, mirroring the gateway's exchange endpoint one-for-one:

- The grant is bound to request + execution target + runner registration, is short-lived, and is
  marked `consumed_at` on first exchange; cancellation/retry revokes unconsumed grants.
- Only hashes/opaque IDs are persisted — never the bearer value — and every exchange is audited.
- The exchange never returns the user's Overlord token.
- The natural first implementation is a GitHub App installation token derived from the existing
  `github_installation_id`: installation-scoped, already stored, already short-lived, and it adds no
  new secret store. A generic secret store for arbitrary Git hosts is explicitly **not** part of
  this plan.

Invariant either way: `project_resource_sources.descriptor_json` never contains a raw credential.
That rule already exists for the gateway; it now applies to every descriptor.

---

## 8. Working-directory lifecycle, ownership, and cleanup

**The claimant owns the directory. Overlord owns the record of it.** The server never creates,
writes, or deletes a file on a target, and never issues a cleanup command; it stores observations and
retention policy only.

**Modes.**

- `ephemeral` — a fresh directory per request; a clean clone at the planned ref; removed after the
  request reaches a terminal status and its retention window passes. This is the build-box default.
- `cached` — one long-lived clone per (project, resource), reused across requests: `fetch`, then
  hard reset to the planned ref, then clean untracked files. Faster and bandwidth-cheap; the runner
  must treat a corrupt or divergent cache as a cache miss and re-clone rather than fail.

**Layout** (deterministic, so a restarted runner can find what a crashed one left):

```
<workspaceRoot>/<projectId>/<resourceKey>/ephemeral/<executionRequestId>/
<workspaceRoot>/<projectId>/<resourceKey>/cache/
```

Each materialized directory carries a runner-written marker,
`.overlord-materialized.json` = `{ executionRequestId, resourceId, planDigest, mode, createdAt }`.
The marker is the ownership proof: a runner **never** deletes or reuses a directory it cannot prove
it created, and never materializes into an existing non-empty directory without a matching marker.

**Cleanup ownership.** The runner sweeps on start and periodically: ephemeral directories whose
request is terminal and whose retention window (`retainFailedHours`, default 24h for failed, delete
immediately on success) has passed, plus any directory with a marker naming a request the backend
reports as terminal or unknown. A cache directory is never swept by age; it is removed only when the
policy is deleted or the operator asks. Removing the materialization policy row does **not** delete
anything on disk — deletion of files is always a local act, and this mirrors the identity plan's rule
that expiry never destroys user data.

**Audit.** Materialization start/finish/cleanup are appended as bounded `execution_request_observations`
of the existing open-vocabulary kinds `progress` and `lifecycle_resource`. They never change request
status by themselves — the same rule the gateway observations follow.

---

## 9. Retry, idempotency, and failure vocabulary

Idempotency key: **`(executionRequestId, planDigest)`** for `ephemeral`, and
**`(projectId, resourceKey, planDigest)`** for `cached`.

- Re-claim after a runner crash finds the marker. Same digest → reuse the directory (re-verify the
  ref, re-clean); different digest → remove and re-materialize. Never two directories for one
  attempt, never a half-materialized directory treated as ready.
- Materialization runs after claim and before launch, inside the existing claim TTL. If it outruns
  the TTL the claim expires and the request returns to the queue by the existing rules; the marker
  makes the next attempt reuse or discard deterministically.
- Failures use the existing typed columns — `failure_phase = 'source'` with these
  `failure_code` values (the vocabulary is already open; these are new documented members):
  `source_materialization_failed`, `source_unauthorized`, `source_ref_not_found`,
  `source_workspace_unavailable` (root missing, not writable, or out of space).
  `source_unauthorized` and `source_ref_not_found` are not retryable; the other two are.
- Free-text Git errors are bounded and redacted before persistence — remote URLs may embed
  credentials — and only the typed code reaches the UI. This is the existing virtual-target rule
  applied to the runner path.

---

## 10. Security boundaries

- **Plan disclosure is claim-scoped.** A materialization plan is returned only to an authorized
  claimant of the target the request is assigned to, over the surface that target authenticates on.
- **`workspaceRoot` is a local-target concept and never crosses the gateway boundary.** A
  materialization policy carrying `workspaceRoot` may only be scoped to a `local` target; the
  service rejects it for a `virtual` target, and `VirtualExecutionQueueItemV1` continues to carry
  opaque handles (`targetRelativeRef`) with no paths and no raw secrets. Nothing in this plan sends a
  filesystem path or a credential across that boundary.
- **Observed paths are display-only.** A reported `workingDirectory` is bounded, stored on the
  request, shown in that workspace's UI, and is never used by the server to make an authorization
  decision or to construct another target's path.
- **Runners refuse to escape their root.** The materialized path must resolve (after symlink
  resolution) inside the declared `workspaceRoot`; anything else is `source_workspace_unavailable`.
- **Declaration authority.** Writing a materialization policy requires project update permission
  **and** an authenticated machine-local identity for the target being scoped — the same pairing that
  guards checkout linking, so a browser cannot silently point another machine's runner at a
  repository.
- **No credentials in descriptors, no bearer values in grants, every exchange audited** (§7).

---

## 11. Local vs Cloud

| | Local (SQLite, co-located backend) | Cloud (Postgres, hosted) |
| --- | --- | --- |
| Reachable filesystem | Backend and runner share a machine, but the plan path is still used — no special case | Backend has no filesystem view; this is the only workable shape |
| `existsSync` guard | Skipped for materialized resolutions (§5) | Not applicable |
| Credentials | Ambient machine Git credentials; phase 2 unnecessary in most setups | Ambient credentials still work; GitHub App exchange is the phase-2 path |
| Gateway | None available — this plan is what makes clone-per-run possible at all | Gateway remains the right answer for foreign realization systems |

Both dialects run identical service logic; the only dialect-specific behavior is the existing
`existsSync` guard, which materialization skips.

---

## 12. Contract impact (contract-first)

One version bump, "Provider-neutral resource materialization". Land the contract and schema-contract
text before implementation, and the machine-readable files with it.

- **`CONTRACT.md` version table**: new entry describing the `ResourceMaterializationPlanV1` /
  `ResourceMaterializationObservationV1` vocabulary, the `materialized` source-kind policy
  descriptor, the additive runner claim/observation fields, and the new documented
  `failure_code` members. No closed vocabulary changes; no new tables.
- **Core service invariants** (next to the existing execution-target-provisioning and leased-target
  rules): *"For a resource whose resolved source is not a local checkout, the service resolves a
  desired materialization plan; it never resolves, constructs, or asserts a filesystem path. The
  claimant resolves the path and reports it as an observation. Materialization is opt-in per
  (execution target, resource) via an explicit target-scoped policy declared from that machine, and
  is never enabled by installing a runner, authenticating, or adding a global Git source."*
- **Runner → REST (Queue Surface)**: the claim response additively carries `materialization` (plan +
  `snapshotDigest`) and `workingDirectory` becomes null when a plan is present; add the runner
  observation write for materialization progress and the reported working directory; document
  `failure_phase = 'source'` on the runner path; document phase-2
  `POST /api/runner/grants/:id/exchange` as reserved.
- **Virtual Gateway → REST**: unchanged in behavior; add the explicit statement that a
  materialization policy scoped to a virtual target may not carry `workspaceRoot` and that the queue
  item's opaque-handle rule is unaffected.
- **CLI Layer**: `ovld add-materialized` and its validation; `ovld add-cwd`/`add-url` semantics
  unchanged; the runner performs materialization before launch, owns cleanup, and never materializes
  without a plan.
- **Runner conformance**: idempotent by `(executionRequestId, planDigest)`; never delete a directory
  without a matching marker; bound and redact Git output; refuse to escape `workspaceRoot`.
- **`contract/components.yaml` / `contract/extension-points.yaml`**: document the new
  `project_resource_sources.source_kind` member `materialized`, the materialization `mode`
  vocabulary (`ephemeral`, `cached`), and the four new `failure_code` members — all additions to
  already-open vocabularies.
- **`packages/contract`**: publish the plan/observation DTO types and the canonical digest helper, so
  backend, CLI, and any gateway share one definition.
- **`database/docs/09-database-schema-contract.md`**: amend three notes only —
  `execution_requests.resolved_working_directory` ("set only for an attached resolution"),
  `launch_snapshot_id` ("null unless the request carries a materialization plan or virtual queue
  item"), and `project_resource_sources.source_kind` (add `materialized`, and state that
  `workspaceRoot` is permitted only in a descriptor scoped to a `local` target).
- **Superseded text**: `execution-target-identity.md` §4.4's "out of scope, worth tracking
  separately" now points here.

### Schema and migrations

**No new tables and no new columns.** The design reuses `project_resource_sources` (new
`source_kind` member in an open vocabulary), `execution_request_snapshots` + `launch_snapshot_id`,
`execution_request_grants`, and `execution_request_observations`.

**Verified against both shipped dialects: no migration is required.**

- `project_resource_sources.source_kind` is constrained only to be non-empty — SQLite
  `CHECK (length(trim(source_kind)) > 0)` and Postgres
  `CHECK (char_length(btrim(source_kind)) > 0)` — so `materialized` is admissible today. This
  matches the schema contract, which already documents `source_kind` as an open vocabulary.
- `execution_requests.launch_snapshot_id` is a plain nullable FK in both dialects with no
  virtual-only constraint; only the documentation says "null for local targets", and that is text,
  not a constraint.
- `execution_request_snapshots.schema_version`, `execution_request_grants.kind`,
  `execution_request_observations.kind`, and `execution_requests.failure_code`/`failure_phase` are
  likewise unconstrained open vocabularies.

The optional unique indexes noted in §5 are the only schema work this design could motivate, and
they are not a prerequisite.

### Module impact

| Module | Impact |
| --- | --- |
| `packages/core` | discriminated launch-resource resolution; materialization plan builder + digest; snapshot write for materialized requests; skip `existsSync`; observation writers |
| `packages/contract` | plan/observation DTOs, digest helper, vocabulary constants |
| `backend` | claim response carries the plan; runner observation/failure routes accept `source` phase; phase-2 grant exchange |
| `cli` | `add-materialized`; runner materialization step, marker file, sweeper, credential-ref mapping; launch env built after materialization |
| `webapp` | resource rows show materialized vs checkout; eligibility reason; typed source failure surfacing |
| `database` | schema-contract text; migrations only if a CHECK blocks the new `source_kind` |
| `desktop` | none in phase 1 |
| gateway (`rest-consumer`) | none — behavior unchanged; contract text clarifies the boundary |

---

## 13. Phasing

| Phase | Scope | Risk |
| --- | --- | --- |
| **0. Contract + schema text** | Version bump, CONTRACT.md/machine-readable/schema-contract edits, published DTOs. Verify both dialects' CHECK constraints. | None (documentation), but it is the gate for everything else |
| **1. Resolution + plan** | Discriminated resolution, plan builder + digest, snapshot at queue time, claim response field, nullable working directory end-to-end. No runner behavior yet — a claim simply carries a plan the old runner ignores, so nothing regresses. | Low; every change is additive and unreached until a policy exists |
| **2. Declaration** | `ovld add-materialized`, REST fields, validation, actionable errors, settings display. | Low |
| **3. Runner materialization** | Clone/fetch, marker, observations, typed failures, launch env after materialization, sweeper. | Medium — the only phase that touches a filesystem; needs old-runner compatibility (a runner that ignores the plan must fail the request with a clear typed error rather than launching in the wrong directory) |
| **4. Optional credential exchange** | Runner grant exchange + GitHub App installation tokens. | Medium; only if ambient credentials prove insufficient |

Compatibility rule for phase 3: an older runner that does not understand `materialization` must not
silently launch. Because `workingDirectory` is null in a materialized claim, the existing launch path
already has nothing to enter; make that an explicit typed failure
(`source_materialization_failed`, "runner too old to materialize this resource") rather than an
undefined path error.

### Testing

- Service: resolution matrix (checkout / global git + policy / global git without policy / policy
  naming a missing source / objective-bound resource), plan digest stability, snapshot written in the
  queue transaction, retry reuses the snapshot, `existsSync` skipped.
- Postgres conformance: identical resolution and snapshot behavior in both dialects.
- Runner: fresh clone, cache reuse, crashed-attempt marker reuse vs discard, escape attempt rejected,
  sweeper retention, redaction of a credential-bearing remote URL in a failure message.
- Contract: machine-readable vocabulary members present; DTO round-trip; a virtual-scoped policy with
  `workspaceRoot` is rejected.

---

## 14. Decisions recorded

1. **Not gateway-exclusive.** Requiring a full gateway implementation to clone a repository is
   disproportionate and excludes Local mode entirely. The gateway keeps owning *foreign* realization.
2. **Never server-side.** Overlord does not clone, does not hold repository credentials by default,
   and does not construct a path for a filesystem it cannot see.
3. **Policy lives on the source, not the target.** `execution_targets` stays free of source data;
   target/source separation is preserved and the existing target-scoped precedence, soft-delete, and
   per-source DELETE route are inherited unchanged.
4. **Opt-in, declared from the machine.** Installing a runner, authenticating, or adding a global Git
   source never enables materialization — the same intent rule as target registration (§4.4, §7.2).
5. **Plans pin refs, not commits.** Overlord does not contact remotes; commit determinism is the
   user's choice via an explicit SHA, and the observed revision is always recorded.
6. **The claimant owns the filesystem, including cleanup.** Removing a policy never deletes files;
   the server never issues a deletion.
7. **Zero new tables.** If a shipped CHECK constraint does not block the new `source_kind`, this
   ships with no migration at all.
