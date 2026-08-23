# Connectors Module — Test Plan

Part of the [master test plan](../../TEST_PLAN.md). Covers the `connector`
contract component: core workflow, per-agent adapters, hook scripts, and
`ovld agent-setup`/`ovld doctor`. Normative sources:
[05-connectors-and-agent-plugins.md](05-connectors-and-agent-plugins.md) and
[agent-harness-configuration-architecture.md](agent-harness-configuration-architecture.md).

Connectors are mostly **declarative artifacts** (manifests, plugin files, hook
shell scripts) plus thin install/launch logic. They are therefore validated
**structurally** (the manifest and managed files are correct and contract-legal)
and **behaviorally** (hooks call the protocol correctly), rather than by line
coverage. The suite covers every adapter under `connectors/adapters/`.

The connector's only sanctioned surface is **Connector → Protocol** (hook scripts
invoke `ovld protocol …`). Tests enforce that it never reaches further.

---

## A. Conformance Manifest (shared with Layer 3 §3.1)

For each connector's `conformance-manifest.yaml`
(`connectors/adapters/claude/conformance-manifest.yaml`, plus
`contract/examples/connector-claude-conformance-manifest.yaml`):

- Validates against [`conformance-manifest.schema.yaml`](../../contract/conformance-manifest.schema.yaml):
  `componentType: connector`, valid `componentKey`, and a required `connector` block with
  `agentIdentifier`, `integrationShape`, `capabilityTier`, and `harnessCapabilities`.
- `integrationShape`, `capabilityTier`, and `harnessCapabilities` exactly match the generated
  projection of the fixture-backed descriptor.
- `contractVersion` is a known contract version.
- `agentIdentifier` is a documented or namespaced connector identifier (open vocab).

## B. Managed Files Integrity

> Connector owns "per-agent plugin/adapter files and managed file manifests."

- Every path in the manifest's `managedFiles` exists on disk under the connector
  adapter or under `connectors/core/overlord-mission/` when the path is a rendered
  core reference (`skills/overlord-mission/reference/*.md`).
- Conversely, the connector's installed plugin files are all declared in
  `managedFiles` (no undeclared managed file — drift between the manifest and the
  actual file set fails).
- Every descriptor capability marked `supported` cites executable evidence, and every referenced
  fixture exists and passes. The generated tier and catalog must be reproducible from that
  descriptor without hand-authored manifest claims.

## C. Hook Scripts — Connector → Protocol boundary (shared with Layer 3 §3.3)

For adapter hook scripts and installed hook paths, including the shared
`connectors/core/scripts/capture-change-hook.sh` template:

- **Protocol-only:** each script invokes `ovld protocol …` and contains **no** SQL,
  DB connection strings, or direct database access (contract: "Hook scripts must
  not write to the database directly").
- **Native registration integrity:** each script is registered only on the native harness event
  documented by its adapter and has an executable `script-io` fixture.
- **Event-type discipline:** a hook that records an event uses only contract
  `mission_events.type` values; it does not invent new event types (contract:
  "Hooks may not add new event types without contract update").
- **Behavioral (dry-run):** feed each hook a representative payload with `ovld` stubbed to
  capture args. Mutation hooks must call `capture-change` only when `OVERLORD_OBJECTIVE_ID` is
  explicit, and must not require a separate mission environment value; unbound hooks remain
  silent and write nothing. Each hook passes its connector key through `--agent`; tests reject a
  generic path parser that could misclassify a Read input as an edit. No real DB, no real agent.
- **Shared capture rendering:** Claude, Codex, and Cursor fixtures execute the one core capture
  template with their adapter key substituted. Setup tests assert that it lands at each existing
  harness-native managed path, is executable, and contains no unresolved placeholder.
- **Mutation semantics:** a `mutation-window` fixture derives `paired`, `post-only`, or
  `unsupported` from its proof. A native callback path records `declared_edit`/`direct` evidence
  only when the connector-owned codec normalizes the event as `file.edited`. Codec-normalized
  read, search, and fetch callbacks are silent; mutation-capable callbacks without a normalized
  edit path, plus shell, generic, unknown, and unmapped callbacks, record unavailable health.

## D. `ovld agent-setup` / `ovld doctor`

- `ovld agent-setup <agent>` installs exactly the manifest's `managedFiles` to the
  documented `installPath`; re-running is idempotent (no duplication, no clobbering
  user edits beyond managed files).
- `ovld doctor` reports a healthy install as healthy, and detects a missing or
  modified managed file, a stale `contractVersion`, or a descriptor digest mismatch.

## E. Connector Core Workflow

- The connector core (`connectors/core/overlord-mission/`) instructions are not
  duplicated by an adapter — adapters extend the core via a `<!-- @connector-core -->`
  marker in `skills/overlord-mission/SKILL.md`, and `ovld agent-setup` interpolates
  the core body at install time (contract constraint "extend the core, don't replace it").
  A test asserts the adapter template does not re-declare core protocol rules verbatim.
- The plugin's slash commands map 1:1 to protocol operations (cross-checked with
  the `drift-review` skill's concern); a command referencing a non-existent
  protocol subcommand fails.

## F. New-Connector Admission Gate

A new connector is admitted to the suite by passing A–D above with **no contract
change** — unless it needs a new closed capability id, integration shape, fixture kind, or
protocol surface, which requires a contract version bump first (asserted by the
[drift guard](../../TEST_PLAN.md#34-contract-drift-guard)). This is the test that
keeps connector growth contract-safe.

## Test Layout

```
connectors/
  test/
    manifest.test.ts        # A (shared w/ conformance/manifest)
    managed-files.test.ts   # B
    hooks-boundary.test.ts  # C protocol-only + event discipline
    hooks-behavior.test.ts  # C dry-run
    setup-doctor.test.ts    # D
    core-extends.test.ts    # E
    admission.test.ts       # F
```
