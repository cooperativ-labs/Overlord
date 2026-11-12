# Overlord contract

> Contract version: **168.0.3**

This directory is the normative, versioned specification of how Overlord's
components interact. It defines what each component owns, the only sanctioned
communication paths between components, the stable interfaces that cannot
change without a version increment, the sanctioned ways to extend Overlord,
and what a shipped component must satisfy before integration. Code, tests,
migrations, generated artifacts, conformance manifests and operational
configuration must conform to it.

Agents and developers MUST read this document and the contract documents
relevant to their work before implementing any change that crosses module
boundaries. See `.claude/skills/component-contract/SKILL.md` for the enforced
agent workflow.

## 1. Scope

The contract governs, for both editions (Overlord Local and Overlord Cloud,
[architecture.md](architecture.md) "Editions"):

- the component registry: what each component owns and must not own;
- interaction surfaces between components, including the REST API, the
  `ovld protocol` agent protocol, realtime events, the MCP server and the
  connector hook surface;
- authentication, authorization, workspace and organization isolation, tokens
  and hosted MCP OAuth;
- persistent data ownership, meaning, constraints, controlled vocabularies and
  migration rules;
- extension points and conformance requirements for shipped components; and
- shared deterministic algorithms that more than one component implements.

Implementation details that do not alter any of those concerns are not
contractual unless this contract expressly says otherwise.

## 2. Normative documents

The contract consists of:

- [architecture.md](architecture.md): editions, component registry,
  interaction surfaces, shared deterministic algorithms and extension points;
- [protocol.md](protocol.md): the agent protocol and session lifecycle;
- [authorization.md](authorization.md): authentication, RBAC, tokens and
  hosted MCP OAuth;
- [conformance.md](conformance.md): conformance requirements, manifests and
  controlled vocabularies;
- [data/README.md](data/README.md): the database schema contract;
- [api/rest-notes.md](api/rest-notes.md): the REST API Layer and REST route
  detail, a normative holding file until `api/openapi.yaml` replaces it;
- the machine-readable files listed below; and
- accepted records in [decisions/](decisions/README.md).

[CHANGELOG.md](CHANGELOG.md) records every version. Its entries at or below
`168` are provenance carried over verbatim from the former single-file contract
and are not normative.

The keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** express requirement strength. Unqualified declarative statements in
these documents are also normative.

### Machine-readable contract files

- [`contract/components.yaml`](components.yaml) — Component registry with capabilities and interface declarations
- [`contract/protocol-commands.yaml`](protocol-commands.yaml) — Protocol command names, required flags, and response shape versions
- [`contract/extension-points.yaml`](extension-points.yaml) — Sanctioned extension points and approved capability flags
- [`contract/conformance-manifest.schema.yaml`](conformance-manifest.schema.yaml) — JSON Schema (YAML) for conformance manifests
- [`contract/harness-capabilities.schema.yaml`](harness-capabilities.schema.yaml) — JSON Schema (YAML) for the per-adapter agent-session capability descriptor. Referenced from the connector block of the conformance-manifest schema and from the `agentSession` vocabulary in `contract/extension-points.yaml`
- [`contract/branch-planning-vectors.json`](branch-planning-vectors.json) — Golden input→output vectors pinning the duplicated per-mission branch/worktree planning algorithm (see "Shared Deterministic Algorithms")

The REST surface will be described by `api/openapi.yaml`, with its own
`info.version`, from phase 4 of the migration in
`planning/feature-plans/contract-adr-openapi-migration.md` (ADRs 0006–0008).
Until then [api/rest-notes.md](api/rest-notes.md) holds that text; phase 4
moves anything OpenAPI cannot express back into the topic documents before
deleting it.

## 3. Precedence and conflicts

When sources disagree, use this precedence order:

1. The current contract documents and machine-readable schemas.
2. Accepted Architecture Decision Records (ADRs), with a later accepted ADR
   superseding an earlier one only when it says so explicitly.
3. Executable tests and implementation.
4. Planning notes, tickets, comments, changelog provenance entries, and all
   other documentation.

Machine-readable schemas control wire shape where prose and schema differ.
Security and isolation requirements control when an apparent ambiguity could
weaken access control. A conflict is a defect; it is not permission to choose
the most convenient interpretation.

The files under `planning/` are source material only. They are not normative
and cannot override this contract.

## 4. Versioning

The contract version is stored in [VERSION](VERSION) as strict Semantic
Versioning, `MAJOR.MINOR.PATCH`: three non-negative integers without leading
zeroes and without a prerelease or build suffix. `VERSION` is the sole source
of truth for the contract version. The header of this document, the current
(first) version heading in [CHANGELOG.md](CHANGELOG.md), `contractVersion` in
[components.yaml](components.yaml) and, once it exists, the OpenAPI
`info.x-overlord-contract-version` extension MUST equal it.

The number line continues from the former integer versions: `168.0.0` is
version 168, and the next major version is `169.0.0` (ADR 0002).

The next version is computed from the current one by
`yarn version:contract patch|minor|major`, which classifies compatibility under
section 5. It is the only supported writer: it updates exactly `VERSION`, this
header, a changelog skeleton, `components.yaml` and the OpenAPI extension
together, and it MUST NOT write any other version value. A contract version
MUST NOT be typed by hand.

Other version values have their own owners. No check may require any of them
to equal the contract version, although they may coincide.

| Value | Owner | Changes when | Checked by |
| --- | --- | --- | --- |
| Conformance manifest `contractVersion` | The shipping component | The component is validated against a contract version. Manifests generated by `yarn connectors:capabilities` take the current version. | `yarn check:conformance-versions`: strict Semantic Versioning, the same MAJOR as `VERSION`, and not newer than it (ADR 0009). A major increment therefore requires restamping every manifest. |
| OpenAPI `info.version` (phase 4) | API description | `api/openapi.yaml` changes other than its `x-overlord-contract-version` line. | Strict Semantic Versioning format; the release range check requires it to move when the description changed. |
| Root and CLI `package.json` `version` | Application release (`yarn version:update:minor`) | The release process chooses to bump it. Contract tooling never writes it. | Strict Semantic Versioning format only. |
| `contractVersion` in `protocol-commands.yaml`, `extension-points.yaml` and JSON fixtures | That file | The file's authors record the version at which it last changed. | Not checked. |
| `schema_migrations.contract_version` (`SCHEMA_CONTRACT_VERSION` in `database/src/constants.ts`) | Database schema contract | The migration ledger format changes. | Database tests. |

Released version meanings are immutable and are never silently rewritten.

## 5. Change protocol

Every proposed implementation plan MUST declare `Contract impact: none`,
`patch`, `minor`, or `major` before implementation begins, and every material
change summary repeats it. The classification is also the version bump: `none`
leaves `VERSION` unchanged, and `patch`, `minor`, or `major` is the component
that `yarn version:contract` increments.

| Impact | Next version | Use when | Examples |
| --- | --- | --- | --- |
| `patch` | `MAJOR.MINOR.(PATCH + 1)` | Correcting an error or clarifying an existing obligation without changing compatible behavior or a consumer's valid use. | Correct inaccurate prose to the already-enforced wire shape; clarify an invariant without broadening or narrowing it. |
| `minor` | `MAJOR.(MINOR + 1).0` | Adding a backwards-compatible obligation, interface, response field, protocol command, capability, or supported behavior. Existing valid consumers, connectors and stored data continue to work. | Add an optional response property, a new endpoint or protocol command, or a new open-vocabulary core value. |
| `major` | `(MAJOR + 1).0.0` | Breaking a guarantee, wire or protocol compatibility, data meaning, authorization behavior, isolation rule, role meaning, or a closed vocabulary; changing a shared deterministic algorithm or its fixture. | Remove or rename an API field or a protocol flag; rename an MCP tool; add a closed-vocabulary value; narrow access; change migration semantics. |

`Contract impact: none` requires a brief justification. It is appropriate only
when interfaces, invariants, security properties, data meaning, boundaries, and
observable behavior remain unchanged.

Use this table to find what a change must update:

| Change                                 | Contract update required?                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| New component added                    | Yes — add to component registry and `contract/components.yaml`                                                                            |
| New interaction surface                | Yes — add to interaction surfaces and `contract/components.yaml`                                                                          |
| Protocol command added/renamed         | Yes — update `contract/protocol-commands.yaml`                                                                                            |
| Protocol command flag changed          | Yes — update `contract/protocol-commands.yaml`; bump version if breaking                                                                  |
| Database table/column added            | Yes — update `contract/data/README.md`                                                                                                    |
| Closed vocabulary value added          | Yes — requires contract version bump                                                                                                      |
| Open vocabulary value promoted to core | Yes — add to `contract/data/README.md` Controlled Vocabularies                                                                            |
| New extension point                    | Yes — add to `contract/extension-points.yaml` and `contract/architecture.md`                                                              |
| New agent-session capability id        | Yes — add to `agentSession.capabilityIds` in `contract/extension-points.yaml` and the descriptor schema; requires a contract version bump |
| Connector capability status change     | No contract update — but a `supported` claim requires a passing fixture, and generated descriptor artifacts must be regenerated           |
| New connector shipped                  | Conformance manifest only; no contract update unless new capabilities needed                                                              |
| Extension shipped                      | Conformance manifest only; no contract update unless new extension points needed                                                          |

A contract-changing change set MUST include:

1. edits to every affected normative document and machine-readable file;
2. the `VERSION` increment produced by `yarn version:contract` and a completed,
   dated entry in [CHANGELOG.md](CHANGELOG.md);
3. updated tests, fixtures, generated artifacts (`yarn connectors:capabilities`,
   `yarn connectors:mcp-tools`) and migrations;
4. restamped conformance manifests when the increment is `major`;
5. an ADR for architecture, security, isolation, data-meaning, migration,
   foundational technology, or service-boundary decisions, and for retiring a
   surface; and
6. a migration and compatibility explanation for breaking changes.

Contract and code changes MUST land together (ADR 0010). "Update the contract
later" is not an acceptable implementation state, and neither is updating the
contract in one change and implementing it in a later one.

Pushes and pull requests run only mechanical alignment checks, none of which
requires a declaration: `scripts/check-contract.sh` (`yarn contract:check`),
the unit tests of the contract tooling, and
`yarn check:conformance-versions`, through
`.github/workflows/contract.yml`.

### Release gate (introduced in phase 5; not yet enforced)

Overlord has no staging promotion. Releases are manual: publish the CLI,
publish the desktop app, deploy the backend, then push, which deploys the web
app. Phase 5 of the migration plan adds a release gate around those steps; until
it exists, the rules below are the intended gate and are not enforced.

1. A release is always of a committed SHA with a clean tree.
2. `yarn release:preflight <none|patch|minor|major>` runs `contract:check`, the
   generated API check, and `scripts/contract-impact.mjs` over the range from
   the `production` tag to `HEAD` with the declared impact, and on success
   writes an untracked stamp (SHA, impact, contract version).
3. The CLI publish, desktop publish and `yarn server:deploy` steps refuse to run
   unless the tree is clean and the stamp's SHA equals `HEAD`.
4. `yarn release:finish` moves the `production` tag to the released SHA,
   fast-forwards a `prod` branch to it, and pushes both; the web app's
   production branch becomes `prod`.

The range check refuses a release unless:

1. the declared impact equals the impact computed from `VERSION` at the range
   start and at the released SHA: a different MAJOR is `major`; otherwise a
   different MINOR is `minor`; otherwise a different PATCH is `patch`; equal
   versions are `none`. Several increments in one range are compared by their
   combined delta;
2. the contract version does not decrease, and every `VERSION` value in the
   range is strict Semantic Versioning;
3. under `none`, nothing under `contract/` changed; otherwise `CHANGELOG.md`
   has a current heading for the released `VERSION`;
4. when [architecture.md](architecture.md), [protocol.md](protocol.md),
   [authorization.md](authorization.md), [data/README.md](data/README.md),
   [api/rest-notes.md](api/rest-notes.md), or a
   migration under `database/sqlite/migrations/`,
   `database/postgres/migrations/` or `backend/postgres/migrations/` changed,
   the range adds at least one new record under `decisions/`; and
5. when `api/openapi.yaml` changed other than its
   `x-overlord-contract-version` line, OpenAPI `info.version` differs.

These checks are mechanical. Reviewers remain responsible for whether the
declared classification, the changelog entry, and any ADR are semantically
adequate.

## 6. Conformance

A change is complete only when:

- implementation and tests conform to the current contract;
- machine-readable schemas, fixtures and generated artifacts agree with
  runtime code;
- every affected conformance manifest passes `ovld contract check` and
  `yarn check:conformance-versions`;
- migrations preserve the data contract and isolation guarantees;
- `yarn contract:check` passes; and
- unresolved contract divergence is reported as a blocker.

The contract validator is a minimum structural gate, not proof of semantic
conformance. Reviewers remain responsible for evaluating the declared impact.
Component conformance requirements are in [conformance.md](conformance.md).
