# Contract Directory

This directory is Overlord's normative, versioned contract: how the modules
interact, what each component owns, which surfaces are stable, and how
extensions plug in.

**Start with [`CONTRACT.md`](CONTRACT.md)**, the entry point. It lists the
normative documents, their precedence, how the version works and the change
protocol.

## Table of Contents

- [For Users](#for-users)
  - [Understanding the contract](#understanding-the-contract)
- [For Developers](#for-developers)
  - [Files](#files)
  - [How to Use](#how-to-use)
  - [For shipped components](#for-shipped-components-connectors-extensions-adapters)
  - [For agents](#for-agents)

## For Users

### Understanding the contract

If you are configuring or extending Overlord (custom connectors, auth
providers, schema extensions), start with [`CONTRACT.md`](CONTRACT.md) and
[`architecture.md`](architecture.md). The YAML files in this directory are the
machine-readable version of the same specification, used by tooling and
agents.

## For Developers

### Files

| File | Purpose |
| --- | --- |
| `CONTRACT.md` | Entry point: scope, normative documents, precedence, versioning, change protocol, conformance |
| `VERSION` | The contract version (strict Semantic Versioning); written only by `yarn version:contract` |
| `CHANGELOG.md` | One entry per version, newest first; entries at or below `168` are non-normative provenance |
| `architecture.md` | Editions, component registry, interaction surfaces, shared deterministic algorithms, extension points |
| `protocol.md` | Agent protocol and session lifecycle |
| `authorization.md` | Auth, RBAC, tokens, native sign-in and hosted MCP OAuth |
| `conformance.md` | Conformance requirements, manifests and controlled vocabularies |
| `data/README.md` | Database schema contract |
| `decisions/` | Architecture Decision Records, indexed in `decisions/README.md` |
| `components.yaml` | Component registry — capabilities, ownership, interaction surface declarations |
| `protocol-commands.yaml` | Protocol command names, required flags, and response shape versions |
| `extension-points.yaml` | Sanctioned extension points, approved capability flags, open/closed vocabularies |
| `conformance-manifest.schema.yaml` | JSON Schema (YAML format) for component conformance manifests |
| `harness-capabilities.schema.yaml` | JSON Schema (YAML format) for per-adapter agent-session capability descriptors |

### How to Use

#### For implementors

Before writing code that crosses a module boundary, read `CONTRACT.md`, the
topic document for the component or surface you are changing, and the relevant
YAML file.

If your change extends or modifies the contract, in the same change:
1. Declare `Contract impact: none|patch|minor|major` in your plan and summary
2. Update the topic documents and YAML file(s)
3. Run `yarn version:contract <patch|minor|major>` and complete the `CHANGELOG.md` entry
4. Add an ADR under `decisions/` when the change is architectural, security, isolation, data-meaning, migration or service-boundary
5. Implement the code change, tests and generated artifacts
6. Run `yarn contract:check`

### For shipped components (connectors, extensions, adapters)

Every component that ships against Overlord must provide a `conformance-manifest.yaml` in its root. The manifest must validate against `conformance-manifest.schema.yaml`.

Run `ovld contract check <manifest-file>` to validate, and `yarn check:conformance-versions` to check that every manifest in this repository declares the current contract major.

### For agents

See `.claude/skills/component-contract/SKILL.md` for the enforced agent workflow. Invoke it before any cross-module change.
