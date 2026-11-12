# Contract Directory — Agent Extension Guide

This file tells agents how to update the contract when extending any Overlord module. The `contract/` directory is the contract: the entry point [`CONTRACT.md`](CONTRACT.md), the topic documents, the changelog, the ADRs under `decisions/`, and the machine-readable files. Read `CONTRACT.md` first.

---

## What "extending the contract" means

You update the contract when a module change:
- Adds a new component or component capability
- Adds or changes an interaction surface between components
- Adds or changes a protocol command or required flag
- Changes a stable interface (requires a version bump)
- Adds a new sanctioned extension point
- Adds a new closed agent-session capability id, integration shape, or fixture kind
- Adds a value to a closed vocabulary

You do **not** update the contract for:
- Adding a new connector (conformance manifest only)
- Adding a new extension (conformance manifest only)
- Adding an open vocabulary value that stays extension-specific
- Internal refactors that don't cross module boundaries

---

## Code and Contract Land Together

Every plan and material change summary declares exactly one of `Contract impact: none`, `patch`, `minor`, or `major` (`CONTRACT.md` section 5). A contract-changing change carries, in the same change set, the contract edits, the `yarn version:contract <patch|minor|major>` increment, a completed `CHANGELOG.md` entry, the implementation, tests, generated artifacts and any required ADR ([ADR 0010](decisions/0010-code-and-contract-land-together.md)). Never implement behavior that contradicts the contract and defer the contract update, and never type a contract version by hand.

---

## Files in This Directory

| File | What it describes | When to update |
| --- | --- | --- |
| `CONTRACT.md`, `architecture.md`, `protocol.md`, `authorization.md`, `conformance.md`, `data/README.md` | The normative specification (see `CONTRACT.md` section 2); REST rules that `api/openapi.yaml` cannot express live in `architecture.md` ("REST API Layer", "REST API → Database (HTTP Surface)") and `data/README.md` ("REST API Boundary") | Any contract change touching that topic |
| `api/openapi.yaml`, `api/openapi-ratchet.json` | The REST surface: one operation per registered route, with `x-overlord-permission`, `-edition`, `-consumers`, `-extension` and `-schema-status`; the stub ratchet (ADR 0048) | Any REST route added, removed or changed; move `info.version` with every change to the description; `yarn contract:parity` enforces route parity |
| `VERSION`, `CHANGELOG.md` | Contract version and its history | Every version increment, through `yarn version:contract` |
| `decisions/` | ADRs | Architecture, security, isolation, data-meaning, migration or service-boundary decisions |
| `components.yaml` | Component registry: capabilities, ownership, interaction surfaces, contract version (written by `yarn version:contract`) | New component, new surface, new capability |
| `protocol-commands.yaml` | `ovld protocol` subcommand names, required/optional flags, response shape versions | New protocol command, changed command flag |
| `extension-points.yaml` | Sanctioned extension points and open/closed vocabularies, including agent-session capability ids, integration shapes, and fixture kinds | New extension point or vocabulary value |
| `conformance-manifest.schema.yaml` | JSON Schema (YAML) that every shipped component's conformance manifest must validate against | New required manifest field |

---

## Procedure: Adding a New Component

1. Add an entry to `components.yaml` under `components:` with:
   - `stableId`: lowercase identifier
   - `label`: human-readable name
   - `owns`: list of capabilities
   - `doesNotOwn`: list of delegated concerns
   - `interactionSurfaces`: list of surfaces this component participates in
2. Add the component to the Component Registry section of `architecture.md`.
3. If the component introduces a new interaction surface, add that surface to both `architecture.md` and `components.yaml`.
4. Run `yarn version:contract minor` (or `major` if it changes an existing guarantee) and complete the `CHANGELOG.md` entry.
5. Add an ADR under `decisions/`: a new component is a service-boundary decision.

---

## Procedure: Adding or Changing a Protocol Command

1. Add/update the command in `protocol-commands.yaml`:
   ```yaml
   - name: <subcommand>
     requiredFlags: [--session-key, --mission-id, ...]
     optionalFlags: [--summary, ...]
     responseShapeVersion: "1"
   ```
2. A new command is `minor`. If the change modifies a required flag or response shape on an existing command, it is **breaking** — `major`. Run `yarn version:contract <level>` and complete the `CHANGELOG.md` entry.
3. Update the Protocol Layer section of `protocol.md`.

---

## Procedure: Adding a New Extension Point

1. Add the extension point to `extension-points.yaml` under `extensionPoints:`.
2. Add it to the Extension Points table in `architecture.md`.
3. If it requires a new agent-session capability id, add it to `agentSession.capabilityIds` in `extension-points.yaml` and update the descriptor schema.

---

## Procedure: Contract Version Bump

The version in `VERSION` is strict Semantic Versioning (`CONTRACT.md` section 4). A **major** increment is required for any **breaking** stable-interface change:
- Protocol command name renamed or required flag removed/renamed
- Database column renamed, type changed, or NOT NULL added without default
- Closed vocabulary value removed
- Response shape field removed or renamed

Backwards-compatible additions are **minor**; corrections and clarifications are **patch**.

**Steps:**

1. Run `yarn version:contract <patch|minor|major>`. It updates `VERSION`, the `CONTRACT.md` header, `contractVersion` in `components.yaml` and a `CHANGELOG.md` skeleton together.
2. Complete the new `CHANGELOG.md` entry.
3. Run `yarn connectors:capabilities` to restamp the generated connector manifests.
4. On a **major** increment, restamp every hand-maintained conformance manifest to the new version ([ADR 0009](decisions/0009-manifests-pin-major-version.md)); `yarn check:conformance-versions` fails otherwise.
5. Run `yarn contract:check`.

---

## Validating a Conformance Manifest

Every shipped connector, extension, database adapter, auth provider, or REST module must have a `conformance-manifest.yaml`. Validate it with:

```sh
ovld contract check <path-to-conformance-manifest.yaml>
```

The manifest schema is in `contract/conformance-manifest.schema.yaml`. Required fields:
- `contractVersion`: the contract version validated against, as strict Semantic Versioning with the current major
- `componentType`: one of `connector`, `extension`, `database-adapter`, `auth-provider`, `rest-module`
- `componentKey`: stable lowercase identifier
- The component-specific block required by its `componentType`

---

## Example: Minimal Conformance Manifest

```yaml
contractVersion: "168.0.0"
componentType: connector
componentKey: my-agent
label: "My Agent Connector"
connector:
  agentIdentifier: my-agent
  integrationShape: callback
  capabilityTier: 0
  harnessCapabilities:
    path: connectors/adapters/my-agent/harness-capabilities.yaml
    schemaVersion: 1
    digest: "0000000000000000000000000000000000000000000000000000000000000000"
```

---

## Cross-Module Checklist

- [ ] Read `CONTRACT.md` before touching any contract file
- [ ] Declare `Contract impact: none|patch|minor|major` in the plan and summary
- [ ] New component → update `components.yaml` + `architecture.md` component registry
- [ ] New surface → update `components.yaml` + `architecture.md` interaction surfaces
- [ ] New protocol command → update `protocol-commands.yaml`
- [ ] Any contract change → `yarn version:contract <level>` + complete the changelog entry
- [ ] New extension point → update `extension-points.yaml` + `architecture.md`
- [ ] New capability id, integration shape, or fixture kind → update `extension-points.yaml` and the descriptor schema
- [ ] Contract and implementation land in the same change; `yarn contract:check` passes
