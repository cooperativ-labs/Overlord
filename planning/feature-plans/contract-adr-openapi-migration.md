# Move Overlord's contract to the Clear Comply model (ADRs, changelog, versioned OpenAPI)

Status: approved in principle 2026-11-12 (section 3 decisions accepted; versions 1–94 stay in git only)
Contract impact of this plan document: none. The migration it describes ends in a
baseline version cut (section 4) with no wire or behaviour change.

## 1. What is true today

Checked against `main` at `7c4d9db` and Clear Comply at `b4696ec`.

**Overlord keeps decisions, changelog and specification in one file.**

- `CONTRACT.md` is 4,034 lines. Lines 45–3120 (76%) are 73 "Version N Change
  Summary" sections for versions 95–168. The standing specification (component
  registry, interaction surfaces, conformance, vocabularies, maintenance rules) is
  the last ~910 lines.
- The change summaries are doing three jobs at once: changelog, decision record
  (rationale, rejected options, impact per module) and specification. Much binding
  detail lives only in a summary, for example the 600-line Version 152 section. They
  are in practice normative, which is the main risk in this migration.
- There are no ADRs anywhere in the repository and no OpenAPI document. The REST
  surface (about 280 Express routes, 205 of them registered in `backend/index.ts`)
  is specified in prose bullets in the "REST API Layer" section and in
  `database/docs/09-database-schema-contract.md` (3,375 lines). Request validation
  is hand-written per handler; DTO types are hand-written in `packages/contract`
  and `packages/core`.
- The version is a bare integer (`168`), typed by hand in `CONTRACT.md` and
  `contract/components.yaml`, and copied into 15 conformance manifests plus
  `OverlordMobile/conformance-manifest.yaml`.
- Machine-readable pieces already exist and are worth keeping: `contract/*.yaml`
  (components, protocol commands, extension points, manifest schemas) and golden
  fixtures.

**Defects found while checking**

- The summaries are out of order (125 is followed by 103, 107–115, 122, 124, …) and
  versions 98, 100 and 102 are missing. Versions 1–94 are no longer in the file.
- No CI runs the contract checks. The only workflow is `claude-plugin.yml`;
  `yarn check` (which includes `check:conformance-versions`) is run by hand.
- `database/src/constants.ts` exports `CONTRACT_VERSION = '1'`, which is unrelated
  to the contract version and misleadingly named.
- `contract/components.yaml` names files under `planning/feature-plans/` as the
  `referenceSpec` of several components, so planning notes are part of the contract.
- The rule today is "contract first, code after". Clear Comply's rule is that both
  land together.

**The Clear Comply model, for reference**

- `docs/contract/CONTRACT.md` is a 186-line entry point: scope, list of normative
  documents, precedence, versioning, change protocol, conformance.
- Topic documents hold the specification: `architecture.md`, `domain.md`,
  `authorization.md`, `data/README.md`, `api/openapi.yaml`.
- `decisions/NNNN-title.md` holds one ADR per decision (361 so far) with a fixed
  format: date, status, contract version, supersedes, context, decision,
  alternatives, consequences.
- `VERSION` is the single source of the SemVer contract version.
  `yarn version:contract patch|minor|major` is the only writer; it updates
  `VERSION`, the header, a changelog skeleton and the OpenAPI extension together.
- `CHANGELOG.md` has one dated entry per version.
- `api/openapi.yaml` is hand-authored and is the source of truth. It has its own
  `info.version`. `yarn api:generate` produces the Zod and type package and the MCP
  tool catalog from it; `api:generate:check` and a runtime boundary test fail on
  drift.
- `scripts/check-contract.sh` runs on every push. `scripts/contract-impact.mjs`
  checks, at staging promotion, that the declared impact matches the `VERSION`
  delta, that a changelog entry exists, that an ADR was added when architecture,
  authorization, data or a migration changed, and that `info.version` moved when
  the API description changed.
- Every plan and change summary declares `Contract impact: none|patch|minor|major`.

## 2. Target layout in Overlord

Keep the existing root `contract/` directory as the home. It already holds the
machine-readable files and is shipped inside the CLI package; `docs/` is the Astro
site workspace and is the wrong place.

```
contract/
  CONTRACT.md            entry point (scope, documents, precedence, versioning, change protocol)
  VERSION                sole source of the contract version
  CHANGELOG.md           one entry per version
  architecture.md        editions, component registry, interaction surfaces, extension points,
                         shared deterministic algorithms
  protocol.md            agent protocol and session lifecycle (prose for protocol-commands.yaml)
  authorization.md       auth, RBAC, workspace and organization isolation, tokens, hosted MCP OAuth
  conformance.md         conformance requirements, manifests, controlled vocabularies
  data/README.md         moved from database/docs/09-database-schema-contract.md
  api/openapi.yaml       REST surface, own info.version
  decisions/README.md    ADR format and index
  decisions/NNNN-*.md
  components.yaml, protocol-commands.yaml, extension-points.yaml, *.schema.yaml, fixtures (unchanged)
```

Root `CONTRACT.md` is deleted, not left as a stub. `CLAUDE.md`, `AGENTS.md`,
`contract/AGENTS.md`, `contract/README.md`, `backend/AGENTS.md` and the
`component-contract`, `drift-review` and `refactor-review` skills are repointed.
Historical notes under `planning/` and `ai/` are left as written.

Precedence, copied from Clear Comply: current contract documents and
machine-readable schemas, then accepted ADRs, then tests and code, then planning
notes. Schemas win over prose on wire shape.

## 3. Decisions this plan recommends

Accepted 2026-11-12. Each is recorded as an ADR in phase 1.

1. **Continue the number line: the baseline is `169.0.0`.** The code, commit
   history and tickets say "contract v153" in hundreds of places; restarting at
   `1.0.0` would make every one ambiguous.
2. **Changelog keeps the old summaries verbatim.** Each "Version N Change Summary"
   becomes a `## [N]` entry in `CHANGELOG.md`, sorted, with a marked boundary: entries
   at or below 168 are provenance and are not normative. Nothing is lost and nothing
   is rewritten.
3. **ADRs are backfilled by decision, not by version.** A version gets an ADR only
   when it made a choice that still binds: architecture, security, tenancy, data
   meaning, migration semantics, service boundary, or a retired surface. Purely
   additive versions stay changelog-only. Estimate: 40–55 ADRs from 73 versions, plus
   6–10 foundational ones for standing choices that no summary explains (two
   editions, closed and open vocabularies, conformance manifests, the duplicated
   branch-planning algorithm with golden vectors).
4. **Backfilled ADRs are marked as such.** Format as Clear Comply plus one line:
   `Origin: contract v153 (coo:1042), backfilled 2026-11`. `Date` is the original
   date from git history (the clone must be unshallowed). Where the summary does not
   record alternatives, the ADR says "not recorded" rather than inventing them.
5. **OpenAPI is hand-authored and is the source of truth,** bootstrapped once from
   the code and then inverted: types and validators are generated from it.
6. **No `/api/v1` path move.** Paths stay as they are; `info.version` starts at
   `1.0.0`. Renaming every path would touch web, CLI, desktop, mobile and runner for
   no gain. The existing `/search/v2` and `/search/v3` routes stay.
7. **OpenAPI covers REST only.** `ovld protocol` stays specified by
   `protocol-commands.yaml` and MCP tools by the generated tool catalog, all under
   the one contract `VERSION`.
8. **Manifests pin the major version.** A conformance manifest declares the version
   it was validated against; the check requires the same major and a version not
   newer than `VERSION`. Otherwise every patch touches 16 manifests in two
   repositories.
9. **Code and contract land together.** Replaces "contract first".

## 4. Phases

Phases 3 and 4 are independent and can run in parallel. Sizes are my estimates of
agent working time, not measurements.

### Phase 1 — Scaffold and tooling (about 1 day, one mechanical change)

- Create the layout in section 2. Move the registry and later sections into the
  topic documents without rewording. Move the summaries into `CHANGELOG.md`.
- Port from Clear Comply, adapting paths and names: `scripts/version-contract.mjs`,
  `scripts/check-contract.sh`, `scripts/contract-impact.mjs` and their unit tests;
  package scripts `version:contract`, `contract:check`.
- `version-contract.mjs` also writes `contractVersion` in `components.yaml`.
  `check-conformance-versions.mjs` reads `contract/VERSION` and applies decision 8.
- Add `.github/workflows/contract.yml` running `contract:check` on every push and
  pull request. This is the first CI gate the contract has had.
- Write ADR 0001 (adopt this model) and the ADRs for section 3.
- Rewrite the `component-contract` skill on the pattern of Clear Comply's
  `code-contract` skill, including the `Contract impact:` declaration.
- Rename `database/src/constants.ts` `CONTRACT_VERSION` to a name that says what it
  versions.

Exit: `yarn contract:check` passes in CI; no file outside `planning/` and `ai/`
refers to root `CONTRACT.md`; version is still 168 in the new `VERSION` file as
`168.0.0`.

### Phase 2 — Make the topic documents stand alone (1–2 days)

- Remove version-history phrasing ("since v153", "(v168)") from normative text where
  it carries no meaning, keeping it only where a retired behaviour is named.
- Replace every `referenceSpec` that points into `planning/` by hoisting the binding
  content into a topic document.
- Split the REST prose out of `data/README.md` and the "REST API Layer" section into
  a holding file `api/rest-notes.md`, to be consumed by phase 4 and then deleted.

Exit: each topic document can be read without the changelog.

### Phase 3 — Reconciliation and ADR backfill (3–5 days)

The risk is binding text that exists only in a change summary.

- Build `contract/decisions/backfill-register.md`: one row per version 95–168 with
  columns: binding statements found, where each now lives (document and section),
  ADR number or "changelog only", superseded by, checked by.
- For each version: extract binding statements; confirm each is in a topic document
  or add it; write the ADR if decision 3 calls for one; mark statements that a later
  version reversed as superseded and say by which.
- Work newest to oldest so supersession is known before the older record is written.
- A second pass by a different reviewer samples the register against the code for
  the 10 largest versions (152, 153, 165, 166, 104, 156, 159, 154, 155, 129).

Exit: every row of the register is complete; the changelog boundary note is in
place; the register is kept as the audit record.

### Phase 4 — OpenAPI (5–10 days, the largest piece)

1. **Inventory.** A script loads the Express app and lists method and path from the
   router. Output is the skeleton: one operation per route with a stable
   `operationId`. Provider-owned Better Auth routes under `/api/auth/*` are excluded
   by an explicit list, as in Clear Comply.
2. **Schemas.** Translate the DTOs in `packages/contract` and `packages/core` into
   `components.schemas`, and each handler's hand-written checks into request
   schemas. A single `ErrorEnvelope` is specified from `backend/errors.ts`.
3. **Extensions.** `x-overlord-contract-version` (written by `version:contract`),
   `x-overlord-permission` (the RBAC action, for example `attachment:create`),
   `x-overlord-edition` (`local`, `cloud`, `both`), `x-overlord-consumers`
   (`webapp`, `cli`, `desktop`, `mobile`, `runner`, `gateway`) and
   `x-overlord-extension` for the Everhour and GitHub extension routes.
4. **Generation.** Port `generate-api-contract.mjs`. `yarn api:generate` writes
   `packages/contract/src/generated/api.ts` (Zod v4 schemas, types, operation
   table, `contractVersion`). The hand-written DTO files are deleted as each is
   covered, so there is one definition.
5. **Enforcement.**
   - Route parity test: every registered route has an operation and the reverse.
   - `api:generate:check` in CI.
   - Request bodies validated at the boundary with the generated schemas, replacing
     per-handler `typeof` checks.
   - The backend test HTTP helper validates every response against the operation's
     schema, so the existing ~560 backend tests become conformance tests.
6. **Ratchet while in progress.** Operations may be marked
   `x-overlord-schema-status: stub`. CI fails if the stub count rises. The
   production gate requires zero.

Exit: zero stubs; parity, generation and response checks green; `api/rest-notes.md`
deleted; REST prose in other documents reduced to what OpenAPI cannot express.

### Phase 5 — Baseline cut and production gate (1 day)

- `yarn version:contract major` → `169.0.0`. Changelog entry states that nothing on
  the wire changed. `info.version` `1.0.0`.
- Update all 15 manifests, the generated harness capability artifacts, and
  `OverlordMobile` (`conformance-manifest.yaml`,
  `scripts/check-contract-conformance.mjs`).
- Build the release gate in section 5a.
- Tag the baseline and record the register and approvals under
  `contract/releases/169.0.0/`.

Exit, and the condition for pushing to production: `CONTRACT.md` at the root is
gone, phases 1–4 exits hold, and the range check passes from the baseline tag.

## 5a. Release gate for the manual deploy

Today a release is four manual steps in this order: publish the CLI to npm, publish
the desktop app to GitHub, `railway up`, then commit and push, which deploys the web
app through Vercel. Two consequences matter here: production can run code that is
not yet committed, so there is no SHA to check a range against, and the web app
ships on every push to `main` whether or not the backend was released.

The gate keeps the release manual and adds one command before and one after.

1. **Commit first.** A release is always of a committed SHA with a clean tree.
2. **`yarn release:preflight <none|patch|minor|major>`** runs `contract:check`,
   `api:generate:check`, and `contract-impact.mjs` over the range from the
   `production` tag to `HEAD` with the declared impact. On success it writes an
   untracked stamp (`.release/preflight.json`: SHA, impact, contract version).
3. **Publish steps refuse without a matching stamp.** `scripts/publish-cli.ts`,
   `scripts/publish-desktop-release.ts` and a new `yarn server:deploy` (a wrapper
   around `railway up`) each check that the tree is clean and the stamp SHA equals
   `HEAD`. A bare `railway up` cannot be blocked; the wrapper is the supported path.
4. **`yarn release:finish`** moves the `production` tag to the released SHA,
   fast-forwards a `prod` branch to it, and pushes both.
5. **Vercel's production branch becomes `prod`.** The web app then ships with the
   release, not with every push to `main`. This is a setting in the Vercel project
   and is the only step that cannot be done from the repository.

The first `production` tag is placed on the `169.0.0` baseline commit.

## 5. Impact on modules

No runtime behaviour or wire shape changes. Impact is on files, checks and
generated code.

| Module | Impact |
| --- | --- |
| Protocol, `packages/core` | Prose moves to `protocol.md`. DTOs used on REST become generated. |
| Database | `09-database-schema-contract.md` moves to `contract/data/README.md`. Migrations become an ADR trigger in the range check. Constant renamed. |
| CLI | Packaged `contract/` copy gains new files. `ovld contract check` and the stale-install comparison in `cli/src/connectors.ts` handle SemVer and decision 8. |
| Connectors (6) | Manifests and generated capability artifacts restamped once. |
| Runner, gateway | None beyond consuming generated types. |
| Backend / REST | Route parity test, boundary validation from generated schemas, response validation in tests. Largest code change. |
| Auth | Prose moves to `authorization.md`. Better Auth routes listed as provider-owned. |
| Automations, extensions | Manifests restamped. Extension routes tagged in OpenAPI. |
| Desktop | Manifest restamped. |
| MCP | Manifest restamped. Tool catalog generation unchanged. |
| Web app | Imports generated types in place of hand-written DTOs. |
| `packages/contract` | Gains the generated API module; loses duplicated DTOs. |
| Docs site | Links to the contract repointed. |
| OverlordMobile | Manifest and conformance script updated for SemVer. Swift type generation from the OpenAPI is possible later and is out of scope. |
| overlord-marketplace | None found. |

## 6. Risks

- **Binding text lost in the move.** Covered by the phase 3 register and by keeping
  the summaries verbatim in the changelog.
- **Contract churn during migration.** The contract changes several times a week.
  Phase 1 is a single mechanical change so the window is hours; after it, new work
  already uses the new process while backfill continues.
- **Backfilled ADRs that read as invented history.** Covered by decision 4.
- **OpenAPI describing intent, not behaviour.** Covered by response validation in
  the existing tests; where spec and code disagree during bootstrap, the code is
  what ships, so the spec is corrected and the disagreement is listed for review.
- **Generator limits.** Clear Comply's generator supports a subset of JSON Schema.
  Overlord's DTOs may need constructs it lacks (discriminated unions, records);
  extend the generator and contribute the change back so the two stay the same.

## 7. Resolved questions

1. Production deploy is manual; the gate is section 5a.
2. The baseline is `169.0.0`.
3. Versions 1–94 are not recovered; they remain in git history.
