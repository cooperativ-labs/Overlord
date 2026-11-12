---
name: component-contract
description: Enforce the Overlord component interaction contract. Invoke before any cross-module implementation or change that touches a component interface — every plan and material change summary must carry a "Contract impact:" declaration.
---

# Component Contract

`contract/CONTRACT.md` is the normative contract for this repository. **You MUST
read it, plus every contract document relevant to the work, before planning or
implementing any change that crosses module boundaries or modifies Overlord's
component interfaces.** Planning notes and implementation details never
override it.

| Document | Covers |
| --- | --- |
| `contract/CONTRACT.md` | Entry point: scope, normative documents, precedence, versioning, change protocol |
| `contract/architecture.md` | Editions, component registry, interaction surfaces, shared algorithms, extension points |
| `contract/protocol.md` | `ovld protocol`, session lifecycle, hook and agent-session surfaces |
| `contract/authorization.md` | Auth Layer, tokens, RBAC, native sign-in, hosted MCP OAuth |
| `contract/conformance.md` | Conformance requirements and controlled vocabularies |
| `contract/data/README.md` | Database schema contract |
| `contract/api/openapi.yaml` | The REST surface: one operation per registered route with permission, edition, consumers and extension (ADR 0048); `info.version` moves with every change |
| `contract/api/rest-notes.md` | REST API Layer and route detail OpenAPI does not yet express (holding file until phase 4d) |
| `contract/*.yaml`, `*.schema.yaml` | Machine-readable registry, protocol commands, extension points, manifest schemas |
| `contract/decisions/` | ADRs |
| `contract/VERSION`, `contract/CHANGELOG.md` | Current version and history (entries at or below `168` are non-normative provenance) |

---

## When This Skill Applies

Invoke this skill whenever you are about to:

- Implement a new `ovld protocol` command or change an existing one
- Add or modify a database table, column, index, or constraint
- Add a new connector (agent harness adapter)
- Modify connector capabilities or hook types
- Create or modify a REST API endpoint or MCP tool
- Implement an extension that uses Overlord extension points
- Add a new value to any controlled vocabulary
- Add a new interaction surface between two components
- Create a conformance manifest for a shipped component

If you are unsure whether your change crosses a module boundary, read the
component registry in `contract/architecture.md`.

---

## Declare Contract Impact

Every implementation plan and material change summary must contain exactly
one of:

```text
Contract impact: none
Contract impact: patch
Contract impact: minor
Contract impact: major
```

- `none` — explain why the work alters no documented interface, invariant,
  security property, data meaning, dependency boundary, or observable behavior.
- `patch` — a correction or clarification of an existing obligation.
- `minor` — a backwards-compatible addition: a new endpoint, response field,
  protocol command, capability, or core open-vocabulary value.
- `major` — a breaking change: a removed or renamed field, flag, command or MCP
  tool; changed data meaning or migration semantics; narrowed access; a closed
  vocabulary change; a change to a shared deterministic algorithm or its
  fixture.

The classification is the bump level (`contract/CONTRACT.md` sections 4 and 5).
For `patch`, `minor`, or `major`, name the affected contract sections and land,
in the same change as the implementation:

1. the edits to every affected contract document and `contract/*.yaml` file;
2. the version increment from `yarn version:contract <patch|minor|major>` and a
   completed `contract/CHANGELOG.md` entry;
3. tests, fixtures, migrations and generated artifacts
   (`yarn connectors:capabilities`, `yarn connectors:mcp-tools`);
4. on a `major` increment, every conformance manifest restamped to the new
   version (manifests must share the contract's major and not be newer); and
5. an ADR under `contract/decisions/` for architecture, security, isolation,
   data-meaning, migration, foundational technology or service-boundary
   decisions, and for retiring a surface.

---

## Rules

- **Code and contract land together.** Never implement behavior that
  contradicts the current contract and defer the contract update, and never
  land a contract change whose implementation follows later. The contract may
  be drafted first in a plan; it merges with the code.
- Never type a contract version by hand. `yarn version:contract` is the only
  writer of `contract/VERSION`, the `CONTRACT.md` header, the changelog
  skeleton and `contractVersion` in `contract/components.yaml`.
- Never edit or reinterpret a provenance changelog entry or a released
  version. Amend with a new version and changelog entry.
- A change to `architecture.md`, `protocol.md`, `authorization.md`,
  `data/README.md`, `api/rest-notes.md` or a migration needs a new ADR; the release range check
  refuses the range otherwise (introduced in phase 5).
- Treat changes to authentication, authorization, workspace or organization
  isolation, roles, public APIs, persistent data meaning, migrations, security
  guarantees, foundational technology, or service boundaries as contract
  changes unless the contract expressly leaves the behavior unspecified.

---

## Pre-Implementation Checklist

**1. Which component does this change belong to?**
- Check `contract/components.yaml` and the component registry in `contract/architecture.md`.
- If the change belongs to a component not yet listed, the change adds it (and an ADR).

**2. Which interaction surface does this change use or create?**
- Is the surface already defined under "Interaction Surfaces" in `contract/architecture.md` (or `protocol.md` / `authorization.md`)?
- If the change creates a NEW surface, add it to the document and `contract/components.yaml` in the same change.

**3. Does this change modify a stable interface?**
These are breaking (`major`):
- Protocol command names or required flags
- Database column names, types, or NOT NULL constraints
- Closed vocabulary values
- Response shape versioned fields

**4. Does this use an extension point?**
- Is the extension point listed in `contract/extension-points.yaml`?
- If using `database-extension`: are table names prefixed `ext_<name>_`? Is migration component `ext:<name>`?
- If using `custom-connector`: are all capability flags from `approvedConnectorCapabilities`? Are hook types from `approvedHookTypes`?
- If using `open-vocabulary-value`: are values namespaced?

**5. Does the shipped component need a conformance manifest?**
Any connector, extension, database adapter, auth provider, or REST module that
ships must have a `conformance-manifest.yaml` in its root, validated against
`contract/conformance-manifest.schema.yaml` (`ovld contract check`) and
declaring a `contractVersion` with the current major
(`yarn check:conformance-versions`).

---

## Where to Update

| Your Change | What to Update |
| --- | --- |
| New component | `contract/components.yaml` + `contract/architecture.md` component registry + ADR |
| New interaction surface | `contract/components.yaml` + interaction surfaces in `contract/architecture.md` (or `protocol.md` / `authorization.md`) |
| New protocol command | `contract/protocol-commands.yaml` + `contract/protocol.md` |
| Changed command flag (breaking) | `contract/protocol-commands.yaml` + `contract/protocol.md` + `major` |
| New REST endpoint | An operation in `contract/api/openapi.yaml` (bump its `info.version`; `yarn contract:parity` fails without it) and any rule it cannot express in `contract/api/rest-notes.md` |
| New database table/column | `contract/data/README.md` |
| New extension point | `contract/extension-points.yaml` + `contract/architecture.md` |
| New connector capability flag | `contract/extension-points.yaml` `approvedConnectorCapabilities` list |
| New hook type | `contract/extension-points.yaml` `approvedHookTypes` list |
| Closed vocabulary change | `contract/extension-points.yaml` + `contract/conformance.md` + `contract/data/README.md` + `major` |
| Open vocabulary new core value | `contract/data/README.md` Controlled Vocabularies + `contract/conformance.md` |
| New connector shipped | Conformance manifest only (no contract update unless new capabilities needed) |
| New extension shipped | Conformance manifest only (no contract update unless new extension points needed) |

Every row except the last two also needs `yarn version:contract` and a
changelog entry.

---

## Before Completion

Run `yarn contract:check`, `yarn check:conformance-versions` and the relevant
test suites. Verify that implementation, tests, schemas, generated artifacts
and the contract version agree. Report any unresolved divergence explicitly as
a blocker.

---

## Delivery Reminder

When delivering a ticket that involved contract-touching changes, state the
`Contract impact:` declaration, the contract version, and the interface changes
(contract documents, any updated `contract/*.yaml`, ADRs, and the impact on
other modules) in the delivery summary. These are first-class behavioral
changes, not documentation noise. If a contract file was written from a shell
command rather than a native edit tool, declare it with `--paths` so it appears
among the objective's changed files.

<!-- version: 2.0.2 -->
