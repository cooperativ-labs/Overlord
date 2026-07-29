# Refactor Review — agent-surfaces — 2026-07-29

## Metadata

- Area: `agent-surfaces`
- Roots reviewed: `mcp/`, `connectors/core/`, `connectors/adapters/{claude,codex,cursor,antigravity,pi}/`, `connectors/VERSION`, `scripts/sync-connector-versions.mjs`, `cli/src/connector-core-render.ts`
- Contract version at review: `35` (see F3 — `CONTRACT.md` states both `34` and `35`)
- AI model: claude-opus-5
- Commit: `5603a7bd`
- Rotation slot: 5. Chosen out of order as the first run of this routine — the smallest area, so
  the playbook's measurement commands and report format could be validated end to end in one pass.

## Measurements

| Metric | Value | Previous run | Delta |
|---|---:|---:|---:|
| Files (all types, excl. node_modules) | 100 | — | — |
| Lines (all types) | 7,083 | — | — |
| Files over 800 lines | 0 | — | — |
| Largest file | `connectors/adapters/*/scripts/overlord-mcp.mjs` — 479 | — | — |
| Core skill body | `connectors/core/overlord-mission/SKILL.md` — 425 | — | — |
| Adapter skill overlays | 23–29 lines each | — | — |
| Open findings carried over | 0 (first run) | — | — |

## Summary

This area is in good shape structurally, with one clear exception. The core-plus-overlay design
is working exactly as intended: a 425-line shared skill core against adapter overlays of 23–29
lines each, rendered through a single marker-substitution path
(`cli/src/connector-core-render.ts`). Lifecycle rules are not restated per harness, which is the
failure mode this design exists to prevent.

The hosted MCP server is likewise well factored — `mcp/tool-catalog.ts` declares tools and
`mcp/server.ts` validates the catalog-to-handler mapping in **both** directions at module load,
so a tool cannot be half-added.

The one real finding is the local MCP shim: three copies of a 479-line file that differ by exactly
two lines. That is 958 lines of pure duplication on the surface agents actually execute, and it is
already half-managed — `scripts/sync-connector-versions.mjs` reaches into all three to patch
`serverInfo`. Second, conformance manifests have gone stale: three of five adapters and the MCP
server declare contract versions far behind the current one, which defeats the purpose of
declaring a version at all.

## Findings

### F1. Generate the local MCP shims from one source instead of maintaining three copies

- **Value / Effort**: High / M
- **Dimension**: Duplication with divergence
- **Evidence**:
  - `connectors/adapters/codex/scripts/overlord-mcp.mjs` (479 lines)
  - `connectors/adapters/cursor/scripts/overlord-mcp.mjs` (479 lines)
  - `connectors/adapters/antigravity/scripts/overlord-mcp.mjs` (479 lines)
  - `diff` between any pair yields exactly two hunks: line 9 (`const DEFAULT_AGENT`) and line 436
    (`serverInfo: { name: 'overlord-<adapter>', … }`)
  - `scripts/sync-connector-versions.mjs` already lists all three under
    `MCP_SERVER_INFO_TARGETS`, i.e. tooling already treats them as one artifact with per-adapter
    substitutions
- **Problem**: Every change to the shim tool list, argument mapping, or error handling must be
  applied three times by hand. The shim is the surface that Codex, Cursor, and Antigravity agents
  execute, so a copy that is missed does not fail loudly — that harness's agents simply behave
  differently. The three copies happen to be identical today, which means this has been maintained
  correctly so far by discipline alone; the finding is that the structure does not enforce it.
- **Proposed change**: Move the shim body to `connectors/core/scripts/overlord-mcp.mjs` with the
  two adapter-specific values as substitution points, and render per-adapter copies the same way
  skills are already rendered. Reuse the existing marker/managed-file mechanism in
  `cli/src/connector-core-render.ts` (`CONNECTOR_CORE_MARKER`,
  `resolveManagedFileContents`) rather than introducing a second templating scheme. The shipped
  artifact must stay a standalone runnable `.mjs` — these files are copied into user homes
  (`~/.ovld/<adapter>/scripts/`) and started directly by the harness, so no bundler or import of
  repo-local modules may appear at runtime.
- **Sequenced steps**:
  1. Add `connectors/core/scripts/overlord-mcp.mjs` as an exact copy of the current Codex shim with
     `DEFAULT_AGENT` and the `serverInfo` name parameterized by the substitution mechanism.
  2. Extend `connector-core-render.ts` to recognize the script as a managed core file, and add a
     test asserting each rendered adapter output is byte-identical to today's committed file
     (this is the safety net for steps 3–4).
  3. Replace the three adapter copies with rendered output; confirm
     `connector-core-render.test.ts` and `yarn test:cli` pass.
  4. Update `MCP_SERVER_INFO_TARGETS` in `scripts/sync-connector-versions.mjs` to patch the core
     file, and re-run `--check`.
  5. Update `connectors/docs/05-connectors-and-agent-plugins.md` to describe the shim as generated,
     so the next contributor does not edit a rendered file.
- **Contract impact**: None. Contract §4 governs the connector surface's behavior, not where its
  source lives; the rendered output is unchanged.
- **Risk**: A rendering mistake ships a broken MCP server to three harnesses, and the failure
  appears only when a user's agent starts. Step 2's byte-identity test is what makes this safe, and
  it must land before step 3. Also verify the installed-path patching for Antigravity
  (`patchAntigravityInstalledPaths`, referenced by the drift-review skill) still resolves against
  the rendered file.

### F2. Bring conformance manifests up to the current contract version, or make staleness fail a check

- **Value / Effort**: High / S
- **Dimension**: Types and contracts
- **Evidence**:
  - `connectors/adapters/pi/conformance-manifest.yaml` → `contractVersion: "0"`
  - `connectors/adapters/antigravity/conformance-manifest.yaml` → `contractVersion: "0"`
  - `connectors/adapters/codex/conformance-manifest.yaml` → `contractVersion: "0"`
  - `mcp/conformance-manifest.yaml` → `contractVersion: "2"`
  - `connectors/adapters/{claude,cursor}/conformance-manifest.yaml` → `contractVersion: "35"`
  - `desktop/conformance-manifest.yaml` → `contractVersion: '35'`
  - `CONTRACT.md` current version: `35`
- **Problem**: `CONTRACT.md` requires every shipped component to declare the contract version it
  was validated against. A manifest reading `"0"` while its adapter ships working code carries no
  information: a reviewer cannot tell an unvalidated component from a neglected file. Because two
  adapters and the desktop shell *are* current, the field looks maintained, which is worse than it
  being obviously unused.
- **Proposed change**: Decide per component whether it has actually been validated at v35. Update
  those that have. For any that have not, keep the older version and note the gap in the
  component's README so the number is a real signal. Then close the loop: add a check that
  compares every `conformance-manifest.yaml` against the current `CONTRACT.md` version and reports
  the delta, wired into `yarn check` alongside `check:workspace-scoping`.
- **Sequenced steps**:
  1. Validate each adapter against the v35 surfaces and record the real version in its manifest.
  2. Add `scripts/check-conformance-versions.mjs` reading the version from `CONTRACT.md` and
     comparing every manifest; report, and fail only on a manifest that cannot be parsed or names a
     version above current.
  3. Add it to the `check` script.
- **Contract impact**: None to stable interfaces. This enforces an existing conformance
  requirement rather than changing it.
- **Risk**: Low. A too-strict check (failing on any lag) would block routine work — the check
  should report drift and fail only on impossible values.

### F3. Reconcile the two contract version numbers in `CONTRACT.md`

- **Value / Effort**: Medium / S
- **Dimension**: Types and contracts
- **Evidence**: `CONTRACT.md:3` — ``Contract Version: `34` ``; `CONTRACT.md:36` — ``Current
  version: `35` ``
- **Problem**: The document declaring the version every component must cite states two different
  versions 33 lines apart. Any automated check (including F2's) has to pick one, and the wrong
  pick silently validates against a superseded contract.
- **Proposed change**: Keep exactly one authoritative statement of the version and have the other
  location reference it, or delete the duplicate header line. Whichever survives is what F2's check
  reads.
- **Sequenced steps**:
  1. Confirm with the contract owner that `35` is current (the most recent commit,
     `5603a7bd`, bumped it, and `desktop`/`claude`/`cursor` manifests agree).
  2. Remove or correct the stale line; state the single source in the *Maintenance rules* section.
- **Contract impact**: Editorial only — no stable interface changes. Do not bump the version for
  this fix.
- **Risk**: None to code. Coordinate with anything already parsing line 3 of `CONTRACT.md`.

### F4. Document the deliberate adapter asymmetries instead of leaving them to inference

- **Value / Effort**: Medium / S
- **Dimension**: Abstraction fit
- **Evidence**: adapter capability matrix as committed —

  | Adapter | commands | hooks | MCP shim | MCP config | extensions | rules |
  |---|---|---|---|---|---|---|
  | claude | yes | `hooks/hooks.json` | no | no | no | no |
  | codex | no | `scripts/*-hook.sh` | yes | no | no | no |
  | cursor | yes | `hooks/` | yes | `mcp.json` | no | `rules/` |
  | antigravity | no | `hooks.json` + `scripts/*.sh` | yes | `mcp_config.json` | no | no |
  | pi | no | no | no | no | `extensions/overlord.ts` | no |

- **Problem**: Some of these gaps are certainly intentional — `claude` uses a plugin with hosted
  MCP so it needs no local shim, and `pi` integrates through a TypeScript extension. Others
  (`codex` having no `commands/` while `cursor` and `claude` do) read as never-ported rather than
  declined. As written, a contributor adding an adapter cannot tell which is which, and neither can
  this routine on its next run.
- **Proposed change**: Add a short capability table to `connectors/README.md` listing each
  adapter's mechanisms with one line per intentional omission. Note per-adapter specifics in the
  adapter README. Where an omission turns out to be accidental, file it as its own mission — do not
  fold feature work into this finding.
- **Sequenced steps**:
  1. Confirm each gap's status with the adapter owner or the harness docs.
  2. Write the table into `connectors/README.md`; add omission notes to each adapter README.
  3. Reference the table from `connectors/docs/agent-harness-configuration-architecture.md`.
- **Contract impact**: None.
- **Risk**: None. Documentation-only; the value is that the next review can distinguish signal from
  neglect.

## Recommended sequence

1. **F3** (minutes, and F2's check depends on a single authoritative version).
2. **F2** steps 1–2 — cheap, and makes the area's conformance claims meaningful.
3. **F1** — the substantive refactor. Land steps 1–2 (core file plus byte-identity test) as one
   reviewable change, then steps 3–5 as a second.
4. **F4** — do alongside F1 step 5, since both touch connector docs.

## Explicitly not recommended

- **Splitting `mcp/server.ts` (379 lines).** It is under the size threshold and its structure is
  already correct: JSON-RPC method dispatch, a handler map, and load-time validation that the
  catalog and handler map agree in both directions. Nothing to gain.
- **Deriving MCP tool input schemas from `@overlord/contract`.** Tempting on paper, but MCP input
  schemas are JSON Schema shaped for model consumption (descriptions, examples), not TypeScript
  DTOs. Coupling them would constrain both. The playbook's check fires here and the answer is no.
- **Deduplicating the five `prompt-wrapper.md` files.** They are genuinely harness-specific and
  short. Sharing them would add a render step for no reduction in drift risk.
- **Collapsing the per-adapter hook shell scripts.** Their bodies are small and their invocation
  contracts differ per harness; the coupling cost exceeds the duplication cost.

## Adjacent findings

- `mcp/tool-catalog.ts` declares 10 hosted tools and the local shims declare the same 10 (plus
  `serverInfo`), so the surfaces agree today — but nothing enforces it. A catalog-vs-shim parity
  assertion belongs in the `drift-review` routine, not here.
- Positive control worth preserving through any refactor: `mcp/server.ts:244-255` throws at module
  load both for a catalog entry with no handler and for a handler with no catalog entry. This is
  the pattern F1 should imitate for shim rendering.

## Verification for this area

```bash
yarn lint
node scripts/sync-connector-versions.mjs --check
yarn test:cli                # includes connector-core-render.test.ts
node cli/bin/ovld.mjs protocol help
```

Ran during this review: `sync-connector-versions.mjs --check` → *"Connector versions are in sync at
0.3.6."* The remaining commands were not run — this pass changed no code.
