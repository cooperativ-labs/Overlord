# Execution Target Identity, Control, and Onboarding

**Mission:** coo:522
**Status:** Architecture-reviewed and implemented through Phase 4 (contract v41). See §5 for what
each phase shipped.
**Contract at time of writing:** 37 (shipped through 41)
**Open questions 1–3 answered by the PM** — see §7 (Decisions). §4.2, §4.4, and §4.6 reflect those answers.

---

## Architecture review verdict

The diagnosis is correct and Phase 1 remains the right first move: target creation must disappear
from read paths. The first draft of the solution, however, put adoption on the wrong row and
underestimated the registration schema needed for more than one runner:

- An adopted pod shares the host's `execution_targets` row, so `identity_mode` and
  `adopted_host_target_id` cannot describe the pod on that row without incorrectly describing the
  host itself. Adoption is a property of a **runner instance attached to a target**.
- `execution_target_registrations` is not already a multi-runner table. It is gateway-specific and
  has a unique active index on `execution_target_id`, so it permits exactly one active registration
  per virtual target. Reusing it would silently break the proposed "host + many pods" model and
  weaken the existing gateway boundary.
- `execution_requests.execution_target_id` selects a target, not a runner instance. When several
  equivalent runners serve one adopted target, any healthy one may claim. Selecting one specific
  runner is a different feature and is not required to solve this mission.
- A runner heartbeat may create or refresh a **runner registration**, but it must never create an
  `execution_targets` row. The earlier wording conflated those two kinds of registration.

The reviewed design therefore keeps `execution_targets` as the user-controlled routing identity,
adds a separate one-to-many local-runner registration model, leaves virtual gateway registrations
unchanged, and moves unrelated type cleanup out of the critical path. That is both smaller and more
faithful to the existing component contract.

---

## 1. The complaint, restated precisely

> "The backend seems to be trying to associate devices with user-interface clients, but the whole
> point of devices and device fingerprints is to allow the user to direct where an agent is launched
> (execution targets). The user-facing client (webapp, desktop app, mobile app) isn't relevant
> because it's not an execution target."

That is exactly what the code does today, and it is not an accident of one function — it is a
structural consequence of having **one identity channel** used for **two unrelated questions**:

| Question                                                                            | Who should answer it                     | What the code actually uses   |
| ----------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------- |
| _Who is making this API call?_ (auth, audit)                                        | the authenticated **profile/credential** | Auth Layer session/token      |
| _Where did a machine-local operation originate?_ (cwd hints, "is this my machine?") | an optional **execution-host hint**      | `x-overlord-device-*` headers |
| _Where should this agent run?_                                                      | an **execution target** the user chose   | `x-overlord-device-*` headers |

The device header is not and must never become an authentication or audit identity; it is
caller-controlled metadata. The bug is that the backend promotes that optional location hint into a
durable execution target. It therefore has no way to distinguish "a browser tab asking for its
settings page" from "a machine volunteering to run agents", treats every caller as a candidate
target, and then bolts on special cases to exclude the ones it knows are wrong.

---

## 2. How it is structured today

### 2.1 The single identity channel

`backend/auth.ts:171` runs on **every authenticated request**:

```ts
setClientDeviceIdentity(clientDeviceFromRequest(req));
```

`clientDeviceFromRequest` (`backend/http/client-device.ts`) reads three headers —
`x-overlord-device-fingerprint`, `-label`, `-platform` — into ambient `ctx.clientDevice`. Every
client sends them:

- **CLI** — `cli/src/device-identity.ts`: `sha256(hostname:platform)`, or `OVERLORD_DEVICE_FINGERPRINT` verbatim.
- **Desktop** — `desktop/src/device-identity.ts`: the same `sha256(hostname:platform)` via the shared helper.
- **Webapp** — `webapp/web/lib/device-identity.ts`: `window.overlord.getDeviceIdentity()` when running
  inside the desktop shell; otherwise **a random UUID persisted in `localStorage`** with
  `devicePlatform: 'browser'`.

That last one is the smoking gun. A browser profile has no machine identity at all, so the webapp
_invents_ a device fingerprint just to have something to put in the header. Clearing site data mints
a new "device".

### 2.2 Provisioning happens as a side effect of reading

`ensureActingDeviceTarget()` (`packages/core/service/execution-targets.ts:470`) does not just look a
target up — it **creates** a `devices` row, an `execution_targets` row, a
`workspace_user_execution_targets` access row, and a `user_execution_target_preferences` row. It is
called from:

| Call site                                                                          | Nature of the operation                                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `backend/execution/launch.ts:461` (`getLaunchSettings`)                            | **read** — opening a settings page                              |
| `packages/core/service/projects.ts:102` (`preferredExecutionTargetIdForDiscovery`) | **read** — project discovery                                    |
| `packages/core/service/projects.ts:256` (`addResource`)                            | **write** — and the one legitimate case in this list (see §4.4) |
| `backend/repository.ts:657` (`resolveResourceExecutionTargetId`)                   | resource mutation defaulting to the caller                      |
| `packages/core/service/protocol.ts:340,378`                                        | session/resource attribution fallback                           |
| `packages/core/service/project-execution-target.ts:853`                            | launch-config resolution                                        |
| `target-resource-observations.ts:162`, `mission-branch-observations.ts:160`        | observation attribution                                         |

So merely _browsing_ creates execution targets. With one exception (`addResource` — linking a
checkout **is** a user saying "this machine holds this code"), nothing in that list is a user saying
"this machine should run agents."

### 2.3 The special cases that paper over it

Because provisioning is implicit, the codebase accumulated guards rather than a model:

- `ensureClientDeviceTarget` throws `browser_not_execution_target` when `devicePlatform === 'browser'`.
- `listWorkspaceExecutionTargets` filters `AND NOT (et.type = 'local' AND d.platform = 'browser')` —
  which only exists because browser device rows _did_ get created historically.
- `listEligibleProjectExecutionTargets` re-filters browser rows **and** backend-host rows.
- `isBackendHostFingerprint` exists so the hosted Railway container doesn't register itself as a
  place to run agents (`ensureActingDeviceTarget` throws `backend_not_execution_target`).
- `execution-target-migration.ts` + `execution-target-migration-doctor.ts` are an entire diagnostic
  subsystem whose only job is to find targets that were mistakenly stamped with the backend host's
  fingerprint, and to tell the user to go re-select things in the web app.
- `softDeleteOrphanDevices` (contract v34) sweeps up the device rows the implicit path leaves behind.

Every one of these is a workaround for "the caller is not the target."

### 2.4 Liveness is inferred, not reported

`isTargetReachable` treats a target as online when `devices.last_seen_at` is within 5 minutes. But
`last_seen_at` is bumped by `ensureDeviceTargetForFingerprint` on _any_ call from that fingerprint —
`ovld create`, a settings page load, a protocol update. So a machine with **no runner installed**
shows as reachable simply because someone ran a CLI command on it, and work queued to it sits
forever. Conversely the honest liveness signal already exists for virtual targets
(`execution_target_registrations.health` + `last_heartbeat_at`) and is not used for local ones.

### 2.5 Containers are an undocumented env var

`OVERLORD_DEVICE_FINGERPRINT` lets an agent-pod container adopt its host's identity. This is the
right _idea_ — a container on my laptop working in a mounted checkout should be "my laptop" for
routing purposes — but:

- It is set by whoever launches the pod, invisible to the user in any UI.
- There is no stored fact that target X is "a container adopting host Y". You cannot tell, from the
  workspace targets list, whether two entries are two machines or one machine and its pod.
- The opposite case (a genuinely independent container/sandbox that should be its own target with
  its own lifetime) has no first-class representation either — it either collides onto the host or
  churns a new hostname-derived device per container start, which is what `softDeleteOrphanDevices`
  was written to clean up.

### 2.6 Onboarding is a manual, separate step

`ovld add-et --name <name>` (contract v26, `cli/src/commands.ts:1204` →
`POST /api/protocol/register-target`) is the _only_ explicit "this machine is an execution target"
action, and nothing calls it for you. `ovld auth login`, `ovld setup`, and `ovld runner install`
never register a target.

The result is not that users get no target — it is that they get an **accidental** one, minted later
by whichever side-effecting read they happen to hit first (§2.2). The target exists, but nobody
chose it, nothing verifies a runner is there, and its label is a hostname. Onboarding is
simultaneously too implicit (targets appear unbidden) and too manual (the one honest command is
undiscoverable).

Note what the fix is _not_: making `auth login` or `runner install` register. §7.2 rules those out —
they fire inside containers that must never register. The fix is to attach registration to an act
that carries intent, and §4.4 identifies which acts those are.

---

## 3. Design principles for the fix

1. **Execution targets are declared, never inferred.** A row in `execution_targets` exists because a
   human performing setup announced it — by linking a checkout on that machine or running
   `ovld add-et`. No read path may create one, and neither may a runner starting up.
2. **Authentication, host hints, targets, and runners are distinct.** Auth identifies the caller.
   An optional host hint helps a machine-local command find an already-declared target. A target is
   the user-controlled routing identity. A runner registration is a live process capable of serving
   that target. None may be inferred from another.
3. **A target is only usable while something is running there.** Liveness comes from a runner
   heartbeat, not from incidental API traffic.
4. **Adoption is a declared property of a runner registration,** persisted and visible, not an
   env-var collision on the shared target row.
5. **Onboarding follows intent, not capability.** Registration is triggered by a human setup act,
   never by the presence of credentials, an installed CLI, or a started process. **Possessing a
   valid token is not a declaration of intent to be an execution target.** AgentPod images ship both
   the CLI and an `OVERLORD_USER_TOKEN` precisely so agents inside containers can run `ovld`
   commands — a fully authenticated, fully capable client that must never register itself. It adopts
   its host (§4.2). Any trigger that fires on "authenticated" or "running" is wrong for exactly this
   reason (§7.2).

---

## 4. Proposal

### 4.1 Make the existing host hint read-only (the core change)

Do not introduce a new unauthenticated "client identity" header family. Authentication already
answers who is calling, and a browser/mobile installation id has no execution meaning. The smallest
safe change is to narrow the existing channel:

| Input                                                             | Meaning                                                                  | Sent by                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| Auth session / user token                                         | Who is calling; source of authorization and audit attribution            | every authenticated client      |
| `x-overlord-device-*` (legacy name)                               | Optional machine-local hint used only to find an already-declared target | CLI and desktop local bridge    |
| explicit `executionTargetId` + `runnerInstanceId` on runner claim | Which declared target this runner serves, and which process is claiming  | local runner only               |
| gateway-scoped credential                                         | Which virtual target the gateway serves                                  | virtual gateway only; unchanged |

The webapp running in an ordinary browser and the mobile app stop sending device headers entirely.
The desktop bridge and CLI may continue sending the host fingerprint because local settings,
resource linking, and project discovery legitimately need to find a co-located target. The header is
still only a hint: the backend validates the authenticated actor's access before using the resolved
target, and never creates a row from it on a read.

Most of the read primitive already exists:
`findActingDeviceExecutionTargetId()` in `execution-targets.ts` performs a read-only lookup. Phase 1
should use and tighten that function rather than inventing a parallel abstraction.

- Delete `ensureActingDeviceTarget()` after replacing its call sites with one of two explicit paths:
  - `registerExecutionTarget(...)` creates or revives a target only for `register-target` and an
    eligible local-checkout link (§4.4).
  - `findActingDeviceExecutionTargetId(...)` is read-only and returns `null` when no declared target
    matches.
- Runner claim resolves an existing target and upserts only its runner-registration heartbeat
  (§4.3). No runner route may create a target.
- Protocol attach/resource attribution first trusts the execution request's stamped target, then an
  explicit authorized `executionTargetId`, then the read-only host hint, then `null`.
- Every other read call site in §2.2 switches to the nullable lookup and handles `null`.
- The browser special case, backend-host provisioning guard, browser SQL filter, and
  `execution-target-migration*` become removable only after tests prove no remaining write path can
  consume a browser/backend hint. The orphan-device sweep may remain as legacy cleanup.

**Correction recorded during Phase 1 implementation.** §4.1's instruction that "every other read call site in §2.2 switches to the nullable lookup" contradicts §2.2's own exception and §4.4/§7.2, for two entries in that table:

- `backend/repository.ts:657` (`resolveResourceExecutionTargetId`) is not a read. It is the **webapp/desktop counterpart of `projects.addResource`** — an omitted `executionTargetId` on a `local_checkout` source means "the machine I am calling from holds this path". §4.4 trigger 1 names exactly this act (including "the desktop local bridge") as a legitimate declaration. Converting it to a nullable lookup would break first-run project creation in Local edition, where linking a directory is the act that declares the machine. It therefore stays on the declaration path; Phase 2 replaces the incidental `ensureActingDeviceTarget` with an explicit `registerExecutionTarget(...)` and adds the actionable rejection for callers with neither an explicit target id nor a machine-local hint.
- The launch-settings **mutations** (`updateAgentLaunchConfig`, `updateTerminalProfile`) are not listed in §2.2 at all, but they reach the same provisioning function. They persist `user_execution_target_preferences` keyed to the acting machine's fingerprint, so they cannot be satisfied by a nullable lookup. They stayed on the declaration path in Phase 1; whether a settings toggle should count as a declaration is an onboarding-trigger question that belonged to Phase 2 (§7.2).

  **Resolved in Phase 2 (contract v39): no.** §7.2 admits only acts a human performs _during setup_, and configuring a terminal or a per-agent pre-command is something you do to a machine you have already chosen, not the act of choosing it. Both mutations now call `requireActingDeviceTarget` and fail with `no_execution_target_registered`; they are a third kind of caller — a write that _needs_ a target — rather than a third declaration path. `resolveResourceExecutionTargetId` did stay a declaration, now made explicit as `declareActingDeviceTarget({ declaration: 'local_checkout_link' })` with the actionable rejection §4.4 requires.

`getLaunchSettings` (the read half of the same module) does convert, which is the change that matters: opening a settings page no longer mints a target, and `LaunchSettingsDto.executionTargetId` / `.deviceLabel` become nullable.

Compatibility is semantic rather than a flag-day header rename: existing CLI/Desktop clients keep
sending `x-overlord-device-*`, but the backend stops treating those headers as permission to
provision. A clearer header name can be introduced later if worthwhile, without coupling it to the
correctness fix.

### 4.2 Model adoption on the runner, not the target

An `execution_targets` row is always the independent routing identity the user selects. Adoption
does not create a second target and therefore cannot be represented by `identity_mode` or
`adopted_host_target_id` columns on `execution_targets`. Those columns are removed from the plan.

Instead, local runner registrations carry the relationship:

| Shape                       | Setup                                                                                                                     | Persisted result                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Physical machine            | `ovld add-et --name "Jake's MBP"` followed by its runner                                                                  | one target; runner relation `native`                        |
| Container adopting its host | AgentPod is given the host's target id and starts with explicit adoption configuration                                    | no new target; runner relation `adopted` on the host target |
| Independent sandbox / VM    | run `ovld add-et --name "ci-sandbox-3"` inside it (with a stable explicit fingerprint/id when its hostname is disposable) | its own target; runner relation `native`                    |

Prefer the stable target id over copying a raw fingerprint into the pod. An explicit
`OVERLORD_EXECUTION_TARGET_ID` (or equivalent runner config) can be validated against the
authenticated actor's target access and reused by project discovery/protocol context. AgentPod also
supplies a stable runner-instance id and an explicit `adopted` relation. Bare
`OVERLORD_DEVICE_FINGERPRINT` remains a compatibility hint during migration, not the durable
adoption model.

**Adoption is row-sharing, not inheritance** (PM decision, §7.1). The consequence that matters is
unchanged: there is no resource copy, mapping, or inheritance step because **the resources are the
host's resources**. The pod mounts the host checkout, so resolving the host target's
`project_resource_sources` is literally correct. Every target-level consumer follows:

- `project_resource_sources.execution_target_id` continues to point at the host target.
- `.overlord/project.json`, target eligibility, project target preference, execution-request
  targeting, changed-file attribution, and observations all use that one target id.
- The UI shows one target with several runner instances, for example
  "MacBook Pro — host runner; AgentPod runner (adopted)".

Any healthy runner registered to that target may claim its work. A target override does **not**
select a specific runner. Runner-specific routing would require another request field and claimant
contract and is deliberately out of scope; the shared-filesystem adoption case should not need it.

Automatic deletion for an `--ephemeral` flag is also deferred. Heartbeat expiry should make a target
offline, not destroy its resource links, preferences, and access rows. If leased targets are needed,
define a separate lifecycle policy with a grace period and explicit cleanup semantics rather than
overloading identity adoption.

### 4.3 Make liveness honest

Do not widen `execution_target_registrations`. Despite its generic name, the contract and schema make
it gateway-owned: its columns are gateway-specific and
`idx_etr_active_target` allows exactly one active row per target. Changing it to one-to-many local
runners would couple local runner rollout to the stable virtual-gateway boundary.

Add a separate core table (working name `execution_target_runner_registrations`) for device-runner
processes:

| Column                                           | Purpose                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `id`, `workspace_id`, `execution_target_id`      | normal core identity and target FK                                       |
| `runner_instance_id`                             | stable per runner installation/runtime; unique active within a workspace |
| `relation`                                       | `native` or `adopted`                                                    |
| `label`, `runner_version`                        | non-secret operator diagnostics                                          |
| `capabilities_json`, `supported_agents_json`     | what this runner can execute                                             |
| `health`, `last_heartbeat_at`, `last_error_code` | honest liveness and bounded failure reason                               |
| timestamps, `deleted_at`, `revision`             | normal lifecycle/concurrency fields                                      |

The runner claim body additively carries `executionTargetId`, `runnerInstanceId`, relation, version,
and capabilities. The backend verifies that the target already exists, is a device/local target,
is enabled, and is accessible to the authenticated workspace member; only then does it upsert the
runner registration and heartbeat. The target row is never created here. The existing 25-second
claim long poll is frequent enough to carry the heartbeat without a second polling loop; a dedicated
heartbeat endpoint is necessary only if runners must remain visible while claim polling is disabled.

For attribution, a successful local claim records the winning runner registration (prefer a new
nullable `claimed_by_runner_registration_id` FK over burying it in `metadata_json`). Virtual claims
continue using `claimed_by_gateway_instance_id`.

- `reachable` for a local target = at least one healthy active runner registration with a recent
  heartbeat, not `devices.last_seen_at`.
- An adopted target is reachable if any native or adopted runner is live.
- The selector can distinguish "no runner has registered" from "last runner offline since 14:02".
- `devices.last_seen_at` reverts to last observed machine traffic and has no scheduling effect.
- Virtual liveness continues to read `execution_target_registrations` unchanged.

### 4.4 Onboarding: registration is triggered by intent, never by installation

**Registration must never be tied to the CLI being installed or started** (PM decision, §7.2). The
CLI is baked into container images — agent-pod's `Dockerfile` ships it. Any trigger of the form
"registers on install" or "registers on first run" therefore fires at image build time or on every
container start, turning each disposable container into its own device and execution target. That is
precisely the churn `softDeleteOrphanDevices` was written to mop up. It is also the reason the
original draft of this section was wrong.

The trigger must be an act that only a human performing setup can perform. There are exactly two:

1. **Linking a local checkout from the machine that owns the path** — `ovld add-cwd`,
   `create-project --directory`, or the desktop local bridge. Registering here is _not_ the implicit
   provisioning §2.2 objects to: pointing Overlord at a checkout on this machine is a deliberate
   declaration that the machine holds that code, and the local
   `project_resource_sources.execution_target_id` needs a target scope. This path becomes an
   explicit `registerExecutionTarget(...)` call rather than an incidental
   `ensureActingDeviceTarget()`.

   A pure browser adding a local-source descriptor for an **already selected target id** does not
   register the browser or create a target; it only updates that target's source. A Git/URL source is
   global and likewise creates no target. If neither an explicit target id nor an authenticated
   machine-local bridge/CLI host hint is present, creating a local checkout source is rejected with
   an actionable error.

2. **`ovld add-et [--name <name>]`** — the explicit "this machine runs agents" declaration.

Trigger 1 is the broad one. Resource sources are **target-scoped by path**:
`findProjectResourceRow` (`projects.ts:396-401`) matches
`prs.execution_target_id = ? OR prs.execution_target_id IS NULL`, and while that global fallback
exists, `assertPrimaryResourceConnected` then rejects anything whose type is not `local_directory`.
A global source is a git URL or a bundle, which contributes no path (contract: URL/git sources
contribute nothing to `OVERLORD_PROJECT_RESOURCES_PATHS`). So a device target can be _eligible_ via
a global source and still fail at claim time with `primary_resource_not_connected` — a path on one
machine is meaningless on another. **Every device target that actually runs agents must therefore
have linked its own checkout**, which means trigger 1 fires for essentially all of them.

That makes trigger 2 the narrow one, for three cases: registering ahead of linking (so the target
can be named, selected in the UI, or adopted by a pod before any checkout exists); setting the label,
since `--name` is the only CLI way to do it; and hosts sharing a filesystem (NFS/SMB), where one
linked path genuinely resolves on several machines — the same shape as pod adoption in §4.2.

Not covered by either trigger: a build box that clones fresh per run. A git-sourced primary cannot
produce a working directory for a device runner today. That is a _materialization_ gap rather than a
registration gap, and it stays out of scope here.

It is no longer, however, assumed to belong exclusively to the gateway/virtual path. It is designed
separately in [`execution-target-materialization.md`](execution-target-materialization.md), which
concludes that materialization is a **provider-neutral** contract with the device runner as its first
implementer: Overlord resolves a resource identity and a desired materialization plan, the claimant
resolves the path and reports it back, and a gateway remains the right answer only when a _foreign_
system owns realization. That plan changes no target identity, registration trigger, adoption,
liveness, or routing semantics described here, and requires no new tables.

Everything else **stops** registering:

- **`ovld auth login`** — no registration, no prompt. Logging in is a credential act, and in a
  container it happens on every start.
- **`ovld setup`** — is the one interactive exception, and it is not a new trigger: it _asks_, and
  on yes makes the same explicit `register-target` call `add-et` makes. Setup is a human sitting at
  a machine performing setup, which is exactly what §7.2 admits; a container never runs it (it
  requires a TTY). Declining skips the terminal step, because launch settings are stored per
  execution target and there is nothing to store them against.
- **`ovld runner install` / `start` / `supervise`** — no **target** registration. The runner creates
  or refreshes only its runner-instance registration against an existing target (§4.3); if none
  exists it reports
  "no execution target registered for this machine — run `ovld add-et`" and exits non-zero rather
  than inventing one. This is the inverse of the original draft, and it is what makes the
  containerized-CLI case safe.
- **Desktop app** — never registers implicitly. It may offer a one-click "make this machine an
  execution target" button that calls `register-target`, which is just `add-et` with a GUI. The
  desktop app is not itself a target; it registers the **machine**.
- **Webapp / mobile** — never register anything, ever. They select among targets others declared.

**Agent-pod** is the case that constrains this whole design, so state it plainly: a pod image ships
the CLI _and_ an `OVERLORD_USER_TOKEN`, so the container is a fully authenticated, fully capable
`ovld` client from the moment it starts. Agents inside it run `ovld protocol attach`, `update`,
`deliver`, `discover-project` — every one of which today can reach `ensureActingDeviceTarget`. Under
the current design each pod start is therefore a candidate new device and execution target.

The pod must **adopt**, never create a target. The launcher supplies the host's stable target id,
an adopted relation, and a distinct runner-instance id. The runner registers that instance against
the existing host target, while ordinary `ovld` calls use the same explicit target id as protocol
and discovery context so they resolve the host's resources. If the host target is missing,
disabled, or inaccessible to the authenticated actor, the pod fails loudly — it never falls back to
creating one.

This is why no trigger may key off authentication, CLI presence, or process start: the pod satisfies
all three and is the one client that must not register. It is also why §4.1's read paths must
tolerate a `null` target rather than provisioning — a pod that has not yet adopted is exactly the
caller that would otherwise mint one.

Because registration no longer happens by accident, the empty state has to carry real weight. The
webapp target list becomes actionable rather than blank: _"No execution targets yet. On the machine
where you want agents to run, link a project directory
(`ovld add-cwd --project-id <project>`)"_ — with a copyable command, and `ovld add-et` offered as the
secondary path. Linking is named first because it is both the common trigger and the thing the
machine needs anyway to resolve a working directory. The first heartbeat after registration flips
the target to reachable within one poll.

### 4.5 Give the user real control

- **Workspace settings → Execution Targets** gains: runner instances with native/adopted relation,
  per-instance heartbeat and version, agent binaries detected, enable/disable toggle, and delete.
  The target itself remains the independent routing identity; adoption appears on the runner row.
  The `status = 'disabled'` database value
  already exists, but the current admin PATCH accepts only `{ label }`; making status a user control
  requires an additive REST/service mutation, authorization, queue/claim enforcement, DTO updates,
  and contract text.
- **Project settings** keeps the existing per-project selection, but eligibility now reads
  "declared + reachable + has a source for the primary resource" — three legible reasons rather
  than a silently-empty list.
- **Mission/objective level**: allow an explicit **target** override at queue time. The schema
  already supports it (`execution_requests.execution_target_id`, nullable = "any eligible target
  may claim"); it is currently populated from project selection. Add
  `LaunchObjectiveBody.executionTargetId`, validate active access + eligibility + resource
  connectivity in the objective's workspace, and stamp the selected target onto the request.
  Surfacing "run this one on the CI sandbox" needs no schema change, but it is a stable REST DTO
  change. It does not select a runner instance within that target.

### 4.6 Follow-up cleanup: `execution_targets.type` (not on the delivery path)

`type` currently conflates three axes and implements one and a half of them. Audit of every reader:

| Value     | What it actually does today                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`   | Carries the `CHECK (type <> 'local' OR device_id IS NOT NULL)` invariant and every device↔target lookup in `execution-targets.ts` (lines 147, 297, 305, 329). Means "has a device row."                                                                                            |
| `virtual` | Two real behaviors: liveness reads from `execution_target_registrations` instead of `devices.last_seen_at` (`project-execution-target.ts:213-217`), and the claimant authenticates as a gateway principal scoped to one target row with `claimed_by_device_id` left null.          |
| `ssh`     | **Nothing.** Present in the CHECK constraint in both dialects, one test fixture (`objective-resource-binding.test.ts:91`, which only needs "some other target"), and a doc comment. No code creates, resolves, authenticates, or launches an ssh target. There is no ssh provider. |

Two further symptoms of the drift:

- `local-target/default-registry.ts:32` is `if (target.type !== 'local') return null` — everything
  non-local falls through to `UnavailableProvider`. The registry documented as mapping
  target→transport implements exactly one branch, and `registry.ts:35` advertises
  `'cloud_persistent' | 'cloud_sandbox'`, values that exist nowhere.
- `execution_requests.target_kind` has `CHECK (target_kind IN ('any','local','ssh'))` and is
  hardcoded to the literal `'local'` at both insert sites (`execution-requests.ts:427`,
  `local-target-mutations.ts:156`). Nothing reads it. It is a second, fully dead copy of the
  vocabulary.

The audit is useful, but none of this is needed to stop implicit provisioning, model adoption, or
make liveness honest. Keep it as a separately landable cleanup after the target/runner model ships.
That prevents a schema vocabulary cleanup from obscuring the user-facing fix.

**Recommended follow-up (§7.3): keep the security split and remove dead vocabulary without a
rename.**

| Axis                                  | Where it lives                                                                | Values                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Who claims, and how they authenticate | `execution_targets.type`                                                      | `local` (device runner) \| `virtual` (gateway)                                   |
| Native vs adopts a host target        | local runner registration (§4.2–4.3)                                          | `native` \| `adopted`                                                            |
| How we reach it                       | resolved at runtime by the provider registry from reachability + capabilities | not persisted; `ssh`, desktop-bridge, in-process, runner-queue are **providers** |

**How we reach it, as shipped (contract 129).** The registry resolves one of three
transports and callers never branch on which: `in_process` when the caller's own
device is the target, `runner_queue` for any other reachable `local` target, and a
typed unavailable provider otherwise. `runner_queue` is a real transport, not a
stub: every capability writes an `execution_requests` row with
`requested_source = 'local_target_mutation'` and metadata
`{ kind, capability, input }`, the runner claims it off the ordinary claim loop and
dispatches generically over the capability name, and the caller awaits the stored
`CapabilityResult` (Postgres `LISTEN` on a completion channel, SQLite a bounded
poll). Two rules keep the boundary honest: `launchAgent` is excluded from the
queued vocabulary because it already owns the claim path, and the **backend is
never a local target** — it resolves the registry with no caller target id, so a
hosted or Local control plane can only reach a checkout through a runner, never
through its own filesystem. A capability call needs no mission: `mission_id` /
`objective_id` are nullable for this one `requested_source`, and such a row is
authorized by `project_id` + `execution_target_id`.

- In a dedicated migration, **drop `ssh`** as a documented core
  `execution_targets.type` and **drop `execution_requests.target_kind` entirely.** Both are
  unreferenced. A real SSH target is a transport — it wants a provider in the registry, not a
  vocabulary slot that has sat empty since `002_initial_core`.
- **Keep the `local` / `virtual` distinction**, for one reason only: it is a **security boundary**.
  A gateway credential is scoped to exactly one target row and cannot enumerate or claim another
  target's work; a device-authenticated runner claims from a workspace queue. Persisted core values
  are justified by boundaries like that one — not by transport variety.
- `execution_targets.type` is documented as an **open** extension vocabulary in `CONTRACT.md` and
  the schema contract, even though the current database CHECK permits only core values. Removing a
  core value and changing the CHECK is still a contract/schema change, but the plan should not call
  the vocabulary closed.
- Do **not** rename `local` / `virtual` in this mission. Those names appear throughout the
  contract-v3 gateway boundary and provider code; a cosmetic rename adds migration and external
  compatibility risk without improving target identity.
- Run the cleanup only after local liveness no longer branches on `devices.last_seen_at`; it then
  becomes a small, independently testable deletion.

---

## 5. Phasing

| Phase                                                  | Scope                                                                                                                                                                                                                                                                                  | Risk                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Stop implicit target creation**                   | Replace read-side `ensureActingDeviceTarget` calls with the existing nullable lookup; make legacy device headers read-only host hints; make runner claim resolve an existing target; remove ordinary-browser device headers. Keep legacy cleanup until migration tests pass.           | Low–medium. Existing targets continue to work; previously masked no-target states become explicit.                                                 |
| **2. Intentional onboarding**                          | Target creation only from `add-et` and machine-local checkout linking; distinguish explicit-target browser source edits from local linking; add actionable CLI/web errors and empty states.                                                                                            | Low. Primarily narrows writes and improves failure handling.                                                                                       |
| **3. Runner instances, adoption, and honest liveness** | Contract/schema first: add the local-runner registration table and claimed-runner attribution; extend runner claim payload; AgentPod passes host target id + adopted runner identity; local reachability derives from live runner rows. Leave virtual gateway registrations untouched. | Medium. Requires migrations in both dialects and a compatibility rollout: new CLI writes heartbeats before backend stops honoring device liveness. |
| **4. User control**                                    | Expose runner diagnostics; add authorized target enable/disable; add `LaunchObjectiveBody.executionTargetId` and target picker; preserve target-level (not runner-level) routing.                                                                                                      | Low–medium. DTO/REST contract changes but no execution-request schema change for the override.                                                     |

**Phase 1 shipped as contract v38.** Read, protocol-lifecycle, discovery, observation-attribution,
and runner-claim paths now resolve an already-declared target or report its absence;
`LaunchSettingsDto.executionTargetId`/`.deviceLabel` are nullable; the runner claim fails with
`no_execution_target_registered`; ordinary browsers send no device headers and their legacy
`localStorage` pseudo-fingerprint is cleared. The declaration paths (`register-target`,
machine-local checkout linking, per-machine launch-preference writes) still create targets — see the
correction recorded in §4.1. Legacy cleanup (`softDeleteOrphanDevices`, the browser/backend-host
guards, `execution-target-migration*`) is deliberately retained until Phase 2/3 migration tests
prove it removable.

**Phase 2 shipped as contract v39.** Provisioning now has exactly one entry point,
`declareActingDeviceTarget({ ctx, declaration })`, whose `declaration` is the named act
authorizing it — `register_target` or `local_checkout_link` — so every declaration site is
greppable and no fourth one can be added by accident. `ensureActingDeviceTarget` is gone.
Declaration additionally requires a _machine-local identity_ (`hasMachineLocalIdentity`): the
process host on a co-located backend, otherwise a non-browser, non-backend-host device hint.
Launch-settings mutations stopped declaring (see the §4.1 correction above). A `local_checkout`
source with no explicit target from a caller with no machine identity is refused rather than
silently written as a project-global source. `ovld setup` gained an explicit prompted
registration step and skips the terminal step when the user declines, `ovld runner start` and
`supervise` now exit non-zero on `no_execution_target_registered` instead of polling forever,
and `POST /api/workspaces/:id/execution-targets` was added as the desktop one-click equivalent
of `add-et` that §4.4 anticipated. CLI, webapp settings, and the workspace target list all carry
actionable no-target copy.

**Phase 3 shipped as contract v40.** Local runner processes are now first-class rows.
`execution_target_runner_registrations` is the one-to-many record of the runners serving one
`local` target (`runner_instance_id` unique among active rows per workspace, `native`/`adopted`
`relation`, non-secret label/version/capabilities, `health`/`last_heartbeat_at`/`last_error_code`),
and `execution_requests.claimed_by_runner_registration_id` records which instance won a claim.
`execution_target_registrations` is untouched — its `idx_etr_active_target` unique index is exactly
why a second table was required. `POST /api/runner/claim` additively accepts `executionTargetId`,
`runnerInstanceId`, `runnerRelation`, `runnerLabel`, `runnerVersion`, `capabilities`, and
`supportedAgents`: an explicit target id is resolved and authorized (exists, `local`, `active`,
active member access) and never created, and the claim upserts only the runner-instance row.
AgentPod adopts its host by passing the host target id, its own `OVERLORD_RUNNER_INSTANCE_ID`, and
`OVERLORD_RUNNER_RELATION=adopted`; the CLI refuses `adopted` without a target id rather than
falling back to this container's hostname.

Two implementation notes where the plan left the mechanism open. **Rollout** is per-target and
self-retiring rather than version- or flag-gated: local reachability derives from a recent
healthy/degraded runner row, and `devices.last_seen_at` is consulted only for a target that has
_never_ had a runner registration. An existing install therefore stays selectable until its
upgraded runner publishes a first heartbeat, and stops honoring device traffic the moment it does —
which satisfies "new runners publish heartbeats before reachability stops honoring device
`last_seen_at`" without a coordinated cutover. **Relation** is derived server-side when the runner
does not declare one (`native` if the named target is the acting machine's own, `adopted`
otherwise), so a workstation that pins its own `OVERLORD_EXECUTION_TARGET_ID` is not mislabeled as
adopting itself.

**Phase 4 shipped as contract v41.** The workspace target projection additively carries safe runner
diagnostics — instance id, `native`/`adopted` relation, label/version, supported agents, health,
heartbeat, and a bounded error code — plus an honest `unavailableReason`, and never exposes
capabilities blobs, credentials, or runner addressing.
`PATCH /api/workspaces/:id/execution-targets/:targetId` additively accepts
`{ status: 'active' | 'disabled' }` alongside `label` under workspace-update permission.
`LaunchObjectiveBody.executionTargetId` is an optional override that `resolveLaunchExecutionTarget`
validates in the objective's workspace for active member access, active/reachable eligibility, and
primary-resource connectivity before stamping `execution_requests.execution_target_id`. Routing
stays target-level: any healthy runner serving the selected target may claim, and no
runner-instance selection surface was introduced.

**Two defects found while verifying Phase 4 (mission objective 7), both fixed.**

- `listRunnerRegistrations` parsed `supported_agents_json` into a local variable and then dropped
  it, so `RunnerRegistration` never carried `supportedAgents` although
  `ExecutionTargetRunnerRegistrationDto` requires it and v41 promises it in the projection. The
  backend typecheck failed on it, and because `ExecutionTargetsPage` reads
  `runner.supportedAgents.length`, the workspace target page would have thrown at render for any
  target with a registered runner. The field is now on the type and populated at every construction
  site.
- Disabling a target did not stop its own runner. v41 requires both halves — disabled targets leave
  eligibility _and_ runners reject claims for them — but only the explicit-target path enforced it.
  The acting-machine path resolves through `findActingDeviceTarget`, which deliberately ignores
  status (a disabled machine is still the machine that wrote a launch preference or observed a
  branch), so a native runner kept draining the queue while an adopting pod pointed at the same row
  was refused. `resolveRunnerTarget` now asserts the target is enabled on that branch too. Queued
  work stays queued while disabled and claims resume on re-enable with no re-declaration.

Phase 1 alone resolves the original complaint. Phases 2–4 complete onboarding, adoption, liveness,
and user control. The type/`target_kind` cleanup in §4.6 and leased ephemeral-target lifecycle are
separate follow-ups, not dependencies.

## 5.1 Deferred follow-up: leased lifecycle for disposable independent targets

This follow-up is deliberately about an **independent target** (for example, a disposable VM or
sandbox which declares its own local target). It is not an adoption mechanism: an AgentPod keeps
sharing its host target and an adopted runner cannot create, convert, renew, or clean up the host's
target lifecycle.

### Policy and creation

Persistent is the default and preserves every existing declaration path. A human explicitly opts
into a leased target at `register-target` / `add-et` or the equivalent machine-local desktop
declaration by supplying `{ lifecycle: { kind: 'leased', leaseSeconds, graceSeconds } }`. The
server accepts whole-minute values in the bounded ranges 5 minutes–7 days for `leaseSeconds` and
1 hour–30 days for `graceSeconds`; no client, environment variable, runner, or heartbeat may
silently select the policy. The stable `execution_targets.id` is still created once and is the
routing identity for its entire retained lifetime.

The schema stores `lifecycle_kind` (`persistent` | `leased`), `lease_seconds`, `lease_grace_seconds`,
and `lease_expires_at` on `execution_targets`. Persistent rows have the latter three fields null;
leased rows have all three non-null. Creation sets `lease_expires_at = now + leaseSeconds` so an
unused disposable target naturally becomes offline and later eligible for cleanup.

### Renewal, offline, and recovery

Only a successful authorized local runner claim/heartbeat for that exact, active target renews a
lease, atomically setting `lease_expires_at = now + lease_seconds`. A normal runner heartbeat
continues to update its registration and is not a target creation path. Expiry is a derived
availability result (`lease_expires_at <= now`): it makes the target offline/ineligible, but does
**not** change `status`, soft-delete the target, clear resources or preferences, revoke access, or
alter queued work. A returning runner may renew before the grace deadline and the same target id,
links, preferences, and access resume normally.

`status = disabled` is an explicit user retention action: it blocks claims and lease renewal, clears
the cleanup schedule, and retains all target data until re-enabled or explicitly deleted. Re-enable
starts a fresh lease window for a leased target; it does not require a new declaration. Explicit
delete keeps today's no-active-work guard and uses the same cleanup primitive immediately. A
deleted target is never revived by a heartbeat; recovery after deletion is a new explicit
declaration with a new target id.

### Grace, queue safety, and cleanup ownership

At expiry the service schedules one idempotent `overlord.execution_target.lease_cleanup.v1`
`worker_jobs` row for `lease_expires_at + lease_grace_seconds`; the worker payload contains only
`{ executionTargetId, expectedRevision }`. The backend owns this worker and all cleanup writes;
runners, gateways, and clients never delete target-owned rows. At execution it locks and reloads
the target. A renewed lease, changed revision/policy, active status, or a deleted target makes the
job a no-op/re-schedule, preventing an old timer from deleting a recovered target.

Before soft deletion, cleanup expires stale claims using the existing request-recovery rules. It
then transitions any remaining queued request targeted at this target to `failed` with the typed,
redacted `execution_target_lease_expired` failure code; it never silently broadens a user-selected
target to another runner. Retry is explicit and queues a new request through ordinary target
selection, so a user may select a replacement target. Cleanup must not delete a target while a
claim/launch remains live; it reschedules until that claim expires or reaches a terminal state.
After queue safety is achieved it invokes the existing target deletion cascade (target access,
target-scoped resource sources, and target preferences; then orphan-device soft deletion).

Every renewal, disable/re-enable, lease-expiry observation, queued-work failure, and final deletion
emits `entity_changes`; queue transitions also append `mission_events` in the same transaction.
The workspace projection exposes only the non-secret lifecycle policy, lease expiry, and derived
`unavailableReason` (`lease_expired`), never a cleanup job payload or runner addressing.

### Migration and rollout

Add matching SQLite and Postgres migrations after the current runner-registration migration. They
add the four nullable columns and a paired CHECK enforcing the persistent/leased shapes, backfill
every existing row as `persistent`, and add a partial index for active leased targets by
`(workspace_id, lease_expires_at)`. They do not alter runner registrations, device identity,
gateway registrations, target type vocabulary, resource links, or existing request status values.
The worker is deployed only after both migrations; its retry/idempotency key is target id plus the
target revision, and its handler is safe to run repeatedly or after restart.

---

## 5.2 Evaluated and declined: runner-instance routing within a shared target

§4.2 left runner-specific routing "deliberately out of scope" with the note that the shared-filesystem
adoption case "should not need it". That was an assertion, so it was tested against the shipped code
and against every candidate workflow that could plausibly require it. **No justified case was found,
and nothing is being built.** The invariant already stated in contract v40/v41 stands: an execution
request selects a target, any healthy runner serving that target may claim it, and a runner instance
is never individually addressable.

This section records the evaluation so the question is not relitigated from intuition.

### Why the shape almost never occurs

Multiple runner instances on one target is not a general configuration — it is exactly one
configuration. `resolveRunnerInstanceId` (`cli/src/runner-identity.ts`) persists one instance id per
CLI data directory, so a second `ovld runner start` on the same machine, or the desktop runner
service alongside a manual run, upserts the *same* registration row rather than creating a rival
instance. An independent sandbox or VM gets its own target (§4.2's third row), which costs nothing.
The only way to get two competing instances on one row is deliberate adoption: a container passing
its host's `OVERLORD_EXECUTION_TARGET_ID` with `OVERLORD_RUNNER_RELATION=adopted`.

And adoption is defined by resource identity, not convenience: §7.1 permits row-sharing **because the
resources are the host's resources** — the pod mounts the host checkout, so resolving the host
target's `project_resource_sources` is literally correct. Two runners that differ in what work they
can actually do are, by that definition, not the same target. The remedy for them is the separate
target that already exists, not a selector inside a shared one.

### The candidate workflows, and what each actually resolves to

**"Run this mission inside the sandbox pod rather than directly on my laptop."** This is the strongest
candidate and it is already solved on a different axis. In the shipped product a pod is not a
competing claimer — it is a *launch wrapper* on the host runner: `preCommand: "agent-pod"`
(`connectors/docs/agent-harness-configuration-architecture.md`) with pre-launch commands such as
`agent-pod file-access set {OVERLORD_PROJECT_RESOURCES_PATHS}`
(`webapp/web/components/projects/project-settings/LaunchPage.tsx`). Isolation is therefore a launch
configuration decision, resolved per target and per agent by `resolveClaimLaunchConfig`
(`packages/core/service/project-execution-target.ts`), not a routing decision. Adding a runner
selector would create a second, competing way to express the same intent.

**"This runner has the agent binary and that one does not."** This is capability matching, not
instance addressing — and the user should never be asked to hand-pick a process to work around it.
The honest observation is that the capability channel is inert today: `capabilities` and
`supportedAgents` are accepted on the claim (`backend/http/client-device.ts`), stored
(`execution_target_runner_registrations`), and projected to the UI, but the CLI never sends them
(`runnerRegistrationPayload` omits both) and no claim predicate reads them. See the tripwire below.

**"Drain one runner without disabling the machine."** The control already exists and is the natural
one: stop that runner process. A runner that is not polling does not claim. Target `status` remains
the coarse, durable control; process lifecycle is the fine one. Neither needs a request field.

**"Which runner ran this?"** Answered by `execution_requests.claimed_by_runner_registration_id` and
the runner diagnostics in the v41 workspace projection. Provenance, not routing.

**"Steer or message the agent on a particular runner."** Independently evaluated and rejected by the
agent-interaction plan (`planning/feature-plans/agent-interaction-acp.md` §12, "Route messages to
`claimed_by_runner_registration_id`"): the winning runner opens a terminal and then loses ownership of
the agent's stdio, so interaction is keyed to an agent session channel. The one adjacent feature that
might have wanted runner addressing concluded it wanted something else.

### What the failure mode costs today

If a runner does claim work it cannot run, the failure is loud and bounded rather than silent:
`markExecutionFailed` is terminal for that request (no auto-requeue loop), `last_error` carries the
reason, and `claimed_by_runner_registration_id` names the instance. That is an acceptable cost for a
configuration a user has to opt into deliberately.

### Tripwire that would reopen this

Reopen only on evidence that two runners which *must* share one target row differ in what work they
can accept — in practice, an adopting pod that runs its own polling runner and lacks an agent binary
its host has. The correct response then is still not user-facing runner selection. It is
**capability-based claim eligibility**: have the CLI publish `supportedAgents`, and have the claim
predicate skip requests whose `requested_agent` the claiming instance cannot serve. That keeps
routing target-level and automatic, requires no request field, no UI, and no new authorization
model, and it degrades safely — an older runner publishing no capabilities keeps today's behavior.
It would be a separate opt-in feature, not this one.

### Consequences of this decision

No schema change, no migration, no contract version bump, and no UI. `LaunchObjectiveBody` keeps
`executionTargetId` as its only routing override. The invariants at `CONTRACT.md` "Claim competition
is target-level" and `contract/components.yaml` (runner instances are never an addressable routing
unit) are already correct and are left as written.

---

## 6. Contract impact

Changes required to `CONTRACT.md` (proposed as one version bump per phase, or a single bump if
shipped together):

- **REST Layer / auth**: state that authentication identifies the caller; `x-overlord-device-*` is
  only an optional machine-local lookup hint and never authorization. Ordinary web/mobile clients
  omit it. Runner claim additively accepts explicit target and runner-instance fields. This amends
  the v13 resource-derived authorization language and v26 `register-target` description.
- **Core service**: state that local `execution_targets` rows are created only by
  `register-target` or an eligible machine-local checkout-linking write — never by read, protocol
  lifecycle, or runner paths. Virtual target creation/registration remains governed by the existing
  gateway surface.
- **v34 (orphan device cleanup)**: largely obsoleted. With no implicit provisioning, orphan devices
  stop being produced; the sweep can stay as a no-op safety net but its rationale changes. Note the
  supersession rather than deleting the entry.
- **Runner → REST surface**: document runner-instance registration/heartbeat fields on claim,
  existing-target/access/status validation, target-level claim competition, and
  `claimed_by_runner_registration_id`. This is additive to the current queue surface.
- **Database schema contract**: add `execution_target_runner_registrations` and the nullable
  execution-request claimant FK in both SQLite and Postgres. Do not change
  `execution_target_registrations`; it remains one gateway registration per virtual target.
- **CLI Layer**: registration is triggered only by `add-et` and eligible local checkout linking.
  Runner install/start/supervise and auth login do not create targets. Runner config accepts an
  explicit existing target id, runner-instance id, and native/adopted relation; missing or
  inaccessible targets fail loudly. Bare `OVERLORD_DEVICE_FINGERPRINT` becomes a compatibility hint
  rather than the adoption model.
- **REST/DTO user controls**: extend workspace target mutation with status enable/disable and extend
  `LaunchObjectiveBody` with an optional target id, including authorization and eligibility rules.
- **Follow-up vocabulary cleanup** (§4.6): dropping the documented core `ssh` value and the
  `execution_requests.target_kind` column is a contract/schema change even though both are runtime
  no-ops. `execution_targets.type` is an open extension vocabulary, not a closed one. Do not couple
  this cleanup or a `local`/`virtual` rename to the identity rollout.
- **Removals**: the `execution-target-migration` doctor check and
  `developer-instructions/upgrading-client-checkout-bridge.md` guidance become obsolete once
  backend-host targets can no longer be created.

### Module impact summary

| Module                  | Impact                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend`               | narrow device-header semantics; convert `launch.ts`/`repository.ts` reads; runner claim upserts runner heartbeat only; workspace target status mutation; objective target override                                      |
| `packages/core`         | delete write-on-read usage in `execution-targets.ts`; add runner-registration service; update reachability/eligibility; preserve virtual gateway registration semantics; remove migration workaround after verification |
| `cli`                   | keep host hint for local operations; explicit existing-target + runner-instance config; claim heartbeat; no target creation from runner/auth; checkout-linking calls target registration only when appropriate          |
| `desktop`               | keep host hint through the local bridge; optional explicit "register this machine" affordance                                                                                                                           |
| `webapp`                | ordinary browser sends no device fingerprint; runner diagnostics, enable/disable, target override, actionable empty states                                                                                              |
| `database`              | runner-registration table + claimant FK migration in each dialect; no `execution_targets` adoption columns                                                                                                              |
| `mobile` (sibling repo) | no device/target headers or target semantics; no coordinated identity-header rename required                                                                                                                            |
| agent-pod               | injects host target id, stable runner-instance id, and adopted relation; no target creation                                                                                                                             |

---

## 7. Decisions

All three open questions from the first draft are resolved. Recorded here with their reasoning so a
later reader does not relitigate them.

### 7.1 Adoption granularity — **share the host's target row**

An adopting container registers an additional runner instance against the host's existing
`execution_targets` row. It does not get its own row, and there is no inheritance or copy step,
**because the resources are the host's resources** — the pod mounts the host's checkout, so
resolving the host target's `project_resource_sources` is literally correct rather than an
approximation. The adoption fact belongs on the one-to-many local runner registration, not on the
shared target row. Detail in §4.2–4.3. Execution requests select the target and any healthy runner
for it may claim; specific-runner addressing is out of scope.

### 7.2 Registration trigger — **first resource link, or explicit `add-et`; never on install**

Rejected: registering on `runner install`/`start`, and prompting on `auth login`. Both are tied to
the CLI being present, and **the CLI is baked into container images** — so every disposable
container would register itself as a distinct device and execution target, which is exactly the
churn `softDeleteOrphanDevices` exists to clean up.

The sharpest form of this: AgentPod images ship the CLI **and** an `OVERLORD_USER_TOKEN`, so agents
in containers can run `ovld` commands. That container is authenticated and capable, and it is
precisely the client that must _not_ become a target — it adopts its host. So the rule is not merely
"don't register on install"; it is that **credentials, CLI presence, and process start are all
disqualified as triggers**, because a pod has all three. Only a human setup act qualifies.

Registration is therefore triggered only by acts a human performs during setup: linking the first
project resource on the machine, or running `ovld add-et`. Linking a checkout is a genuine
declaration ("this machine holds this code") and a resource source is meaningless without a target
to scope it to, so it stays a legitimate writer — it is the one entry in §2.2's table that survives.
Because resource sources are target-scoped by path, linking is also the trigger that fires for
essentially every device target that will ever run work, which makes `add-et` the narrow case rather
than a co-equal one (§4.4). A browser edit with an explicit target id and a global Git source do not
register targets. The runner registers only its process instance against an existing target and
fails loudly when there is none.

### 7.3 `execution_targets.type` — **keep the security split; clean up separately**

`ssh` is entirely unreferenced and is dropped, as is the duplicate dead `execution_requests.
target_kind` column, but in a separate cleanup after the identity rollout. `local` / `virtual`
survives unchanged for exactly one reason: it is a **security boundary** (gateway credentials are
scoped to one target row; device runners claim from a workspace queue). Transport variety belongs
in the provider registry, not in a persisted vocabulary. The vocabulary is contractually open even
though the shipped database CHECK currently admits only documented core values. Detail in §4.6.

### 7.4 Runner-instance routing — **not justified; routing stays target-level**

Evaluated after the Phase 4 rollout rather than assumed. Every candidate workflow resolves to an
axis that already exists: pod-versus-host isolation is launch configuration (`preCommand`), draining
one runner is stopping that process, attribution is
`execution_requests.claimed_by_runner_registration_id`, and steering an agent is an agent session
channel (rejected independently in the agent-interaction plan). Two competing instances on one target
row only ever arise from deliberate adoption, and adoption is licensed by §7.1 precisely because the
two runners share the host's resources — runners that differ in what work they can do are a separate
target, which is already free.

So no request field, authorization rule, claimant identity, queue-competition rule, offline behavior,
UI, or schema change is being added, and the existing contract invariants need no amendment. The one
real gap found is capability heterogeneity, not addressing: `supportedAgents`/`capabilities` are
accepted, stored, and projected but never published by the CLI and never read by the claim predicate.
If that ever bites, the fix is automatic capability-based claim eligibility, not user-facing runner
selection. Full evaluation and tripwire in §5.2.
