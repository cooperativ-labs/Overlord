# Agent File-Change Submission Hardening Specification

## Status

- Status: Approved implementation spec
- Owner: Overlord desktop + protocol surface
- Primary goal: prevent local agent deliveries from reaching review without durable `file_changes` rows when the workspace has meaningful git-tracked edits

## Problem Statement

Overlord now persists structured file attribution through `public.file_changes`, created from `changeRationales` supplied on `update`, `record-change-rationales`, and `deliver`. That is the correct durable model.

The remaining failure mode is operational:

- local agents still see stale examples that tell them to submit `file_changes` artifacts
- local CLI delivery does not validate that changed files in the workspace are represented in `changeRationales`
- a ticket can therefore move to review with a narrative summary but no durable structured file changes

This spec closes that gap for local CLI-driven sessions.

## Goals

- Make local agent instructions unambiguous: `changeRationales` are the structured file-change submission mechanism.
- Block `ovld protocol deliver` when the current workspace has changed files but the delivery omits matching `changeRationales`.
- Keep runtime overhead negligible by using local git inspection only at deliver time.
- Preserve the current `public.file_changes` model and current protocol payload shape.

## Non-Goals

- Do not reconstruct file changes from agent transcript logs in this work.
- Do not add server-side repo inspection.
- Do not require exact equality between all changed files and all rationale file paths.
- Do not change remote MCP-only execution behavior in this pass.
- Do not reintroduce `file_changes` as a supported artifact type.

## Source of Truth

For local agent sessions, the following become authoritative:

1. Git working tree state in the current repository at deliver time
2. `changeRationales[].file_path` submitted with the deliver command
3. Persisted `public.file_changes` rows created from those `changeRationales`

Narrative `summary` text and ordinary `artifacts` are not sufficient substitutes for structured file changes.

## Required Product Behavior

### Instruction Contract

All local bundle and setup instructions that mention file changes must state all of the following:

- Overlord persists structured file changes via `changeRationales`
- `file_changes` must not be sent as an artifact
- every meaningful git-tracked file change should be represented in `changeRationales` before `deliver`
- ordinary artifacts are limited to non-file-change outputs such as `next_steps`, `test_results`, `migration`, `decision`, `note`, and `url`

### Deliver Guardrail Contract

When `ovld protocol deliver` runs inside a git repository:

- if git reports no changed files, delivery proceeds normally whether or not `changeRationales` are supplied
- if git reports changed files and no `changeRationales` are supplied, delivery must fail
- if git reports changed files and `changeRationales` are supplied but none of their `file_path` values match the changed files, delivery must fail
- if at least one supplied `changeRationales.file_path` matches a changed file, delivery proceeds

This is intentionally a minimum-overlap rule, not a perfect-coverage rule.

### Escape Hatch

The deliver command must support:

- `--skip-file-change-check`

When present, the CLI skips all git reconciliation logic and proceeds with delivery.

This flag is required for intentional exceptions and operational recovery. It must not be the default.

## Scope of Code Changes

The implementation must update these areas:

- `electron/services/agent-bundle/templates.ts`
- `lib/overlord/ticket-prompt.ts`
- `bin/_cli/protocol.mjs`
- `packages/overlord-cli/bin/_cli/protocol.mjs`
- `packages/overlord-cli/bin/_cli/setup.mjs`
- tests covering CLI deliver behavior and instruction examples

If additional prompt or setup copies exist in the repo, they must be updated in the same change set. No stale `file_changes` artifact examples may remain in agent-facing local instructions.

## Detailed Requirements

### 1. Prompt and Bundle Hardening

#### 1.1 Local bundle templates

Update all local agent bundle templates so that every deliver example uses `changeRationales` for structured file changes.

Required wording:

- `changeRationales` persist file changes
- do not send `file_changes` as an artifact
- every meaningful git-tracked file change must be represented in `changeRationales` before delivery

Required example shape:

```json
{
  "summary": "Narrative summary",
  "artifacts": [
    { "type": "note", "label": "Architecture note", "content": "..." }
  ],
  "changeRationales": [
    {
      "label": "Add retry backoff",
      "file_path": "lib/api.ts",
      "summary": "Added bounded retry handling for transient failures.",
      "why": "Requests were failing on temporary upstream errors.",
      "impact": "The API client now retries transient failures before surfacing an error.",
      "hunks": [{ "header": "@@ -22,4 +22,18 @@" }]
    }
  ]
}
```

The exact prose can vary, but the semantics above are mandatory.

#### 1.2 Slim prompt

Add one explicit instruction to the slim local prompt emitted by `lib/overlord/ticket-prompt.ts`:

> Before delivering, ensure every meaningful git-tracked file change is represented in `changeRationales`. Do not submit `file_changes` as an artifact.

This sentence is mandatory. Equivalent wording is acceptable only if it preserves both requirements exactly.

#### 1.3 Setup / doctor text

Update local setup or doctor output so that:

- newly installed bundles contain the corrected contract
- upgrade messaging clearly tells users to refresh local agent instructions if their installed bundle predates this change

If bundle versioning exists, bump it. If bundle versioning does not exist, add the smallest viable version marker or refresh signal necessary to force users onto the corrected templates.

### 2. CLI Deliver Preflight

#### 2.1 Command surfaces

Implement the same deliver preflight behavior in both CLI copies:

- `bin/_cli/protocol.mjs`
- `packages/overlord-cli/bin/_cli/protocol.mjs`

Behavior must remain functionally identical across both files.

#### 2.2 Git repo detection

At deliver time, unless `--skip-file-change-check` is present:

1. run `git rev-parse --show-toplevel`
2. if the command succeeds, treat the current working directory as inside a git repo and continue reconciliation
3. if the command fails, skip reconciliation and proceed with delivery

Failure to detect a git repo is not an error condition. The guard applies only when the workspace is a git repository.

#### 2.3 Changed-file discovery

When inside a git repo, discover changed files using git status, not diff parsing.

Required command:

- `git status --porcelain=v1 -z`

Required file classes:

- modified
- added
- deleted
- renamed
- copied if emitted by git status
- untracked

Submodule edge cases do not need special treatment beyond what `git status` reports.

#### 2.4 Path normalization

Normalize both git paths and `changeRationales[].file_path` before comparison.

Normalization rules:

- convert backslashes to `/`
- trim whitespace
- remove a leading `./`
- resolve absolute paths inside the detected repo root to repo-relative POSIX paths
- leave already repo-relative POSIX paths unchanged
- compare case-sensitively

Paths outside the repo root must never count as matches.

#### 2.5 Match rule

Let:

- `changedFiles` be the normalized set from git
- `rationaleFiles` be the normalized set from `changeRationales[].file_path`

Reconciliation outcome:

- if `changedFiles.size === 0`, pass
- if `changedFiles.size > 0 && rationaleFiles.size === 0`, fail
- if `changedFiles.size > 0 && intersection(changedFiles, rationaleFiles).size === 0`, fail
- otherwise, pass

No fuzzy matching is allowed in this implementation. Matching is exact after normalization.

#### 2.6 Error messaging

When blocking delivery because no rationale files were supplied, the CLI must print an actionable error that includes:

- git found changed files in the workspace
- Overlord persists file changes through `changeRationales`
- `file_changes` artifacts are not valid
- how to provide `--change-rationales-json` or `--change-rationales-file`
- how to bypass with `--skip-file-change-check`

When blocking delivery because rationale files do not overlap, the CLI must print:

- the first few git-changed files
- the first few supplied rationale files
- a statement that none matched after normalization
- the same remediation guidance

The error must be concise enough to fit in a normal terminal without wrapping into unreadable output. Cap example file lists at 10 entries each.

#### 2.7 Parsing resilience

If `changeRationales` is malformed and the existing deliver command would already reject it, preserve that existing failure path.

This feature must not silently coerce invalid rationale payloads into an empty set.

### 3. Server-Side Behavior

No server API contract changes are required.

Do not change:

- `deliver` payload shape
- `update` payload shape
- `record-change-rationales` payload shape
- `public.file_changes` schema in this work

This is a local instruction and CLI validation change only.

### 4. Testing Requirements

All new behavior must be covered by automated tests.

#### 4.1 Deliver preflight tests

Add or update tests to cover:

1. delivery succeeds outside a git repo with no `changeRationales`
2. delivery succeeds inside a git repo with no changed files and no `changeRationales`
3. delivery fails inside a git repo with changed files and empty `changeRationales`
4. delivery fails inside a git repo with changed files and no overlap between changed files and rationale files
5. delivery succeeds inside a git repo with at least one overlapping path
6. delivery succeeds with `--skip-file-change-check` even when changed files exist and no `changeRationales` are present
7. absolute rationale file paths inside the repo normalize and match correctly
8. rationale file paths outside the repo do not match
9. Windows-style path separators normalize correctly

#### 4.2 Instruction regression tests

Update tests and fixtures so that:

- no local agent-facing example uses `file_changes` as an artifact type
- examples show `changeRationales` for file changes
- any stale snapshots are updated

The test suite must fail if a future example reintroduces `file_changes` as an artifact in local instructions.

### 5. Rollout and Compatibility

#### 5.1 Rollout order

Implement in this order:

1. update bundle templates and prompt text
2. update setup / refresh messaging
3. add deliver preflight in both CLI copies
4. add or update tests
5. verify no stale agent-facing examples remain in the repo

#### 5.2 Compatibility expectations

Expected behavior after rollout:

- freshly installed or refreshed local bundles instruct agents correctly
- old local bundles remain wrong until refreshed, but the CLI preflight still blocks bad deliveries
- remote MCP-only flows are unaffected

#### 5.3 Versioning / refresh

The change is not complete unless there is a clear mechanism for local bundle refresh visibility. One of the following must be implemented:

- a bundle version bump consumed by setup/install logic
- doctor output that detects an out-of-date bundle version
- explicit reinstall messaging emitted during setup or launch

At least one mechanism is mandatory.

## Acceptance Criteria

This work is complete only when all of the following are true:

- no local Overlord instruction source tells agents to submit `file_changes` artifacts
- slim prompt text explicitly requires `changeRationales` for meaningful git-tracked file changes
- `ovld protocol deliver` blocks local deliveries with changed files and no matching rationale file paths
- `ovld protocol deliver --skip-file-change-check` bypasses the guard
- both CLI copies behave identically
- automated tests cover the required pass/fail cases
- the repo contains no stale local example that reintroduces the obsolete artifact contract

## Explicit Rejections

The implementation must not:

- require rationale coverage for every changed file
- read raw agent transcript logs
- add network calls to validate git state
- mutate server-side schema
- block delivery outside git repositories
- accept `file_changes` artifacts as a fallback success path

## Follow-Up Work

The following are intentionally deferred and should not be folded into this change:

- desktop review warnings based on linked repo state after delivery
- transcript-log ingestion for evidence-based rationale generation
- server-side quality scoring of file-change submissions
- coverage scoring between changed files and rationale rows
- prompt improvements for remote MCP clients

## Implementation Notes

- Prefer a small shared helper for changed-file discovery and normalization inside each CLI copy, or extract a shared module if both CLIs can consume it without creating packaging risk.
- Reuse existing rationale parsing logic if present; do not duplicate JSON parsing behavior unnecessarily.
- Keep deliver-time git invocations to the minimum required commands.
- Use repo-relative POSIX paths for all comparison and debug output.

## Verification Checklist

Before merging, verify:

- `rg "file_changes" electron/services/agent-bundle packages/overlord-cli/bin/_cli lib/overlord -n` shows no stale artifact instructions
- deliver guard fails when expected in a local dirty repo
- deliver guard passes when rationale paths overlap
- `--skip-file-change-check` works
- test suite covering protocol deliver behavior passes
