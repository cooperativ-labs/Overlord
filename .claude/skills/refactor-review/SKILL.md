---
name: refactor-review
description: Recurring per-area refactoring review routine. Audits one area of the Overlord codebase (backend, core, cli, webapp, desktop, database, agent-surfaces, platform-services) for structural decay — oversized modules, duplication, leaked layering, dead code — and produces a prioritized, effort-scored refactor plan. Use when asked to review an area for refactoring, run the refactor rotation, or clean up structural debt.
allowed-tools: Read, Grep, Glob, Bash, Task
user-invocable: true
---

# Refactor Review

<refactor-review>

This is a **routine**, not a one-off review: it is meant to be run repeatedly, one area at a
time, on a rotation. Each run produces a dated report in `planning/refactor-reviews/` and,
optionally, Overlord missions for the refactors worth doing.

Scope discipline is the point. A whole-repo "find refactors" pass produces an unusable list.
A single-area pass with a fixed method produces findings a human can act on this week.

## Difference from the other review skills

| Skill | Question it answers |
|-------|--------------------|
| `code-review` | Is this code correct, safe, and well written? |
| `drift-review` | Do the parallel product surfaces still agree with each other? |
| `security-audit` | Can this be attacked? |
| **`refactor-review`** | **Is this area's structure still the right shape, and what is the highest-value restructuring available?** |

Do not duplicate the others. If you find a bug, note it in one line under *Adjacent findings*
and move on — this routine is about shape, not defects.

## Step 0 — Resolve the area

The invocation argument names the area. Accepted values and their playbooks:

| Area | Playbook | Covers |
|------|----------|--------|
| `backend` | `reference/areas/backend.md` | `backend/` — REST API layer, repository, workers, extensions |
| `core` | `reference/areas/core.md` | `packages/core/`, `packages/contract/` — service layer and shared types |
| `cli` | `reference/areas/cli.md` | `cli/` — `ovld` command surface, protocol client, VCS |
| `webapp` | `reference/areas/webapp.md` | `webapp/` — React SPA, queries, components |
| `desktop` | `reference/areas/desktop.md` | `desktop/` — Electron shell and process supervision |
| `database` | `reference/areas/database.md` | `database/` — migrations, dialect parity, generated types |
| `agent-surfaces` | `reference/areas/agent-surfaces.md` | `mcp/`, `connectors/` — MCP server and connector plugins |
| `platform-services` | `reference/areas/platform-services.md` | `auth/`, `automations/`, `scripts/` |

If no area was given, do **not** review everything. Read `reference/rotation.md`, work out
which area is most overdue (oldest or missing report in `planning/refactor-reviews/`), state
the choice, and review that one.

If the user names a narrower target (a single file or directory), use the playbook for the
enclosing area and restrict the measurement and findings to that target.

## Step 1 — Read the ground rules before measuring

Every run, in this order:

1. `CONTRACT.md` — the area's entry in the Component Registry and any interaction surface it
   owns. The contract is normative: a refactor that breaks a stable interface needs a contract
   version bump and an impact list, and that cost belongs in the finding.
2. The area's `AGENTS.md` (e.g. `backend/AGENTS.md`, `cli/AGENTS.md`) and `README.md`.
3. The area playbook from Step 0.

A refactor proposal that contradicts the contract or the area's own documented conventions is
not a finding, it is a mistake. If the *documentation* is what is stale, say so explicitly and
propose the doc change as the finding.

## Step 2 — Measure before reading

Numbers first. They pick the reading list; instinct does not.

```bash
# Size distribution for the area (substitute the area's roots)
find backend -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -path '*/node_modules/*' -not -path '*/dist*/*' \
  -exec wc -l {} + | sort -rn | head -30

# Largest exported functions in a suspect file
grep -n '^export \(async \)\?function\|^export const .* = \(async \)\?(' backend/repository.ts

# Fan-in: who depends on this module (a high number raises the cost of any signature change)
grep -rl "from '.*repository" backend packages webapp cli --include='*.ts' --include='*.tsx' | wc -l

# Candidate duplication: repeated helper names across the area
grep -rhoE '\b(function|const) [a-z][A-Za-z0-9_]{6,}' backend --include='*.ts' \
  | sort | uniq -c | sort -rn | head -30

# Exports nobody imports (dead-code candidates — always verify each hit by hand)
grep -rhoE 'export (async )?(function|const) [A-Za-z0-9_]+' backend --include='*.ts' \
  | awk '{print $NF}' | sort -u | while read -r sym; do
      n=$(grep -rlw "$sym" backend packages webapp cli --include='*.ts' --include='*.tsx' | wc -l)
      [ "$n" -le 1 ] && echo "$n $sym"
    done
```

Record the measurements you ran and their headline numbers in the report. The next run of this
routine compares against them, which is how the rotation shows whether debt is growing.

## Step 3 — Analysis dimensions

Assess the area against these seven dimensions. The playbook adds area-specific checks under
each; run both.

### 1. Module size and cohesion
Files over ~800 lines and functions over ~80 lines. The finding is never "this file is long" —
it is "this file holds N unrelated responsibilities; here is the seam and here are the
extractions." Name the seam concretely (e.g. "mission read paths vs. execution-request writes").
A long file with one responsibility and a clear reading order is fine; say so.

### 2. Layering and boundary leaks
Imports that cross a boundary the contract does not sanction: transport reaching into SQL,
service code reading request-scoped ambient state, UI importing server internals, an area
reaching around its own public entry point into a sibling's internals. Check the direction of
every cross-area import you find, not just its existence.

### 3. Duplication with divergence
Two or more implementations of the same rule that have already drifted apart. Rank by drift
risk, not by line count: duplicated validation or ID resolution is far worse than a duplicated
`formatDate`. Prefer extracting to an existing shared home over inventing a new `utils` module.

### 4. Abstraction fit
Both directions. **Missing**: the same 6-step sequence open-coded at every call site.
**Excess**: a generic wrapper, options bag, or indirection layer with one caller, or a
config-driven mechanism that only ever takes one shape. Removing a wrong abstraction is a
first-class refactor finding.

### 5. Types and contracts
Parallel hand-maintained type definitions that should derive from one source (generated DB
types, `@overlord/contract`); stringly-typed values that have a closed set in the contract;
optional fields that are actually always present; `as` casts that paper over a real shape
mismatch. Check whether a closed enum in `CONTRACT.md` is being re-declared locally.

### 6. Dead and vestigial code
Unreferenced exports, superseded code paths kept "just in case", feature flags whose branch
never runs, compatibility shims for a migration that has completed, commented-out blocks.
Verify each candidate with a repo-wide search **including** `webapp`, `cli`, `desktop`,
`mcp`, `connectors`, and `scripts` before proposing deletion — dynamic dispatch tables and
string-keyed registries defeat naive grep.

### 7. Test structure
Tests are code and get reviewed as code here. Look for: setup duplicated across files that
belongs in the area's shared harness or `test-helpers`; assertions on incidental shape that
make refactoring expensive; and the inverse — a large module whose thin test coverage makes
any restructuring of it unsafe. Coverage gaps matter to this routine only as a
**precondition**: if the highest-value refactor is untested, the first step of that refactor is
characterization tests, and the finding must say so.

## Step 4 — Score every finding

Each finding gets both scores. Findings without both are not actionable and do not belong in
the report.

**Value** — what the codebase gains:
- `High` — removes a class of recurring bugs, unblocks pending work, or cuts a boundary
  violation the contract cares about
- `Medium` — meaningfully improves clarity or reduces the cost of routine changes
- `Low` — tidy, real, but nobody is currently paying for it

**Effort** — what it costs, stated in the units that actually hurt:
- `S` — contained in one file, no signature changes, existing tests cover it
- `M` — a handful of files, internal signatures change, tests need updating
- `L` — crosses module boundaries, needs new tests first, or touches many call sites
- `XL` — changes a stable interface in `CONTRACT.md` (needs a version bump and an impact list),
  or requires a data migration

Lead with `High`/`S` and `High`/`M`. Explicitly recommend **not** doing `Low`/`L` findings —
saying "leave this alone" is a useful output of this routine.

## Step 5 — Write the report

Save to `planning/refactor-reviews/YYYY-MM-DD-<area>.md`. Create the directory if missing. If
a report for that area and date already exists, append a `-follow-up` suffix.

```markdown
# Refactor Review — <area> — YYYY-MM-DD

## Metadata
- Area: <area>
- Roots reviewed: <paths>
- Contract version at review: <from CONTRACT.md>
- AI model: <model name>
- Commit: <git rev-parse --short HEAD>

## Measurements
| Metric | Value | Previous run | Delta |
|---|---:|---:|---:|
| Files | | | |
| Lines | | | |
| Files over 800 lines | | | |
| Largest file | | | |

## Summary
[3–6 sentences: what shape this area is in, and the single highest-value refactor available.]

## Findings

### F1. <Short imperative title>
- **Value / Effort**: High / M
- **Dimension**: Layering and boundary leaks
- **Evidence**: `path/to/file.ts:120-190`, `path/to/other.ts:44`
- **Problem**: [What the current structure forces, with the concrete cost.]
- **Proposed change**: [The specific restructuring — new/renamed modules, moved functions,
  signature changes.]
- **Sequenced steps**: [1..n, each independently landable and reviewable.]
- **Contract impact**: [None, or the stable interface touched and the version-bump/impact list
  required.]
- **Risk**: [What could break, and which tests or checks would catch it.]

## Recommended sequence
[Ordered list across findings, noting which are prerequisites for others.]

## Explicitly not recommended
[Findings deliberately declined, with the reason. Prevents the next run from re-litigating them.]

## Adjacent findings
[One line each: bugs, security concerns, or surface drift noticed in passing. Route these to
`code-review`, `security-audit`, or `drift-review` rather than expanding this report.]

## Verification for this area
[The exact commands a refactor in this area must pass — from the playbook.]
```

## Step 6 — Publish and land the follow-up

Do **not** start refactoring as part of this routine. The review and the refactor are separate
units of work with separate review surfaces; mixing them makes both harder to evaluate.

For an ad-hoc run, report the findings, then offer to file them. When the user agrees, create one
Overlord mission per independently landable refactor — objectives ordered as the finding's
sequenced steps:

```bash
ovld protocol create --agent claude-code --objectives-json '[
  {"title":"Extract mission read paths from repository.ts","objective":"Refactor F1 from planning/refactor-reviews/YYYY-MM-DD-backend.md: ..."},
  {"title":"Update call sites and tests","objective":"..."}
]'
```

One mission per finding, not one mission for the whole report — a mission that says "do all the
refactors" is not executable.

### Scheduled Claude Routine

A scheduled Claude web routine must publish its findings without waiting for a human reply. It
uses the connected **Overlord MCP** — never shell `ovld` commands — after saving the report to
`planning/refactor-reviews/`:

1. Call `overlord_resolve_project` to obtain an explicit `projectId`.
2. Call `overlord_create_mission` with a first objective titled **Publish refactor review**. Its
   only work is to store the completed report; it must not make code changes.
3. Call `overlord_add_objectives` once with one draft objective for each recommended finding or
   remediation. Each objective must contain that finding's evidence, proposed change, sequenced
   steps, contract impact, risk, and report path. Do not create objectives for declined or
   adjacent findings.
4. Call `overlord_attach_session` for the publish objective, then
   `overlord_deliver_session` with `noFileChanges: true` and exactly one `note` artifact whose
   `content` is the complete Markdown report. The artifact label is `Refactor review — <area> —
   <date>`.

This leaves the report visible on the monthly mission and each remediation visible as a separate,
executable draft objective. A delivery moves the publish objective to review; it does **not**
execute or complete a remediation objective. If the report has no recommended findings, still
create and publish the mission, but add no remediation objectives.

## Standing rules

- **Behavior-preserving by definition.** Every finding must be a pure restructuring. If a change
  would alter behavior, that is a separate feature or bug mission; note it and keep it out of the
  refactor plan.
- **Evidence or it does not ship.** Every finding cites file paths with line ranges. No finding
  rests on a general principle alone.
- **Fewer, better findings.** Ten scored findings a human will act on beat sixty observations
  they will skim. Merge findings that share a root cause into one.
- **Never propose a rewrite.** Propose a sequence of landable steps. If no such sequence exists,
  that is itself the finding — say why the module resists incremental change.
- **Respect house rules.** `===` / `!==` only (`eqeqeq` is an error). Import order is enforced by
  `simple-import-sort`. Never propose a refactor that fights the lint config; propose the config
  change separately.
- **Read the previous report first.** If `planning/refactor-reviews/` already has a report for
  this area, open it. Re-report what was never addressed (and note it as recurring), do not
  re-litigate what was declined, and record what got fixed.

</refactor-review>

<!-- version: 1.0.0 -->
