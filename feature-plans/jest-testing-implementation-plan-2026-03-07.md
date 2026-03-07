# Engineering Plan: Jest and Testing Baseline Repair

**Source:** Repository review finding #2
**Date:** 2026-03-07
**Status:** Planning

---

## Objective

Repair the repository's broken testing contract and establish a consistent Jest-based testing setup that matches:

- `package.json` scripts
- installed dependencies
- TypeScript configuration
- existing test file conventions
- CI expectations

## Problem Summary

The current repository is internally inconsistent:

- `package.json` advertises Jest:
  - `test: jest`
  - `test:watch: jest --watch`
- Jest is not installed.
- `tests/lib/helpers/ticket-waiting-response.test.ts` uses Jest globals like `describe`, `it`, `expect`, and `beforeEach`.
- `tests/protocol-deliver.test.mjs` uses Node's built-in `node:test`.
- `tsconfig.json` includes `tests/**/*.ts`, so Jest-style TS tests participate in the main typecheck, but no Jest types are configured.

This creates a false signal:

- `yarn test` fails immediately
- `yarn type-check` fails because test globals are unknown
- the repo currently has no trustworthy automated test baseline

---

## Decision

Adopt **Jest as the primary application test runner** for this repository.

Rationale:

- the existing package scripts already promise Jest
- at least one existing TS test file is already written in Jest style
- Jest remains a practical fit for React/Next.js unit tests and DOM-based helper tests
- moving to Jest requires less conceptual churn than rewriting the package contract around `node:test`

### What to do with the `node:test` file?

Short term:

- keep it, but make it explicit whether it is:
  - migrated into Jest, or
  - run via a separate script such as `test:node`

Recommended first pass:

- migrate `tests/protocol-deliver.test.mjs` into Jest or place it behind a separate script and exclude it from the Jest glob
- do not leave the repo in a mixed, undocumented state

---

## Target State

After this work:

- `yarn test` runs a working Jest suite
- `yarn test --watch` works locally
- `yarn type-check` passes without test-global errors
- TS and JS test files follow documented conventions
- CI runs tests consistently

---

## Implementation Plan

## Phase 1: Install and wire the actual Jest toolchain

### 1.1 Add missing dev dependencies

Install the minimum required Jest stack:

- `jest`
- `ts-jest` or `babel-jest`
- `@types/jest`
- `jest-environment-jsdom`

If the repo already leans on TS without Babel, `ts-jest` is the simpler first pass.

### 1.2 Add Jest configuration

Create a root Jest config, for example `jest.config.ts` or `jest.config.mjs`, covering:

- `testEnvironment`
- TS transform
- module alias support for `@/*`
- file extensions
- test match patterns
- setup files

Expected coverage:

- `tests/**/*.test.ts`
- `tests/**/*.test.tsx`
- optionally `tests/**/*.test.js`

Be explicit about whether `.mjs` tests are supported by Jest in this repo.

### 1.3 Add Jest setup file

Create a setup file if needed for:

- `jsdom` helpers
- custom matchers
- polyfills used by UI helpers

If React component testing is planned soon, include:

- `@testing-library/jest-dom`

---

## Phase 2: Align TypeScript with the test runner

### 2.1 Stop using the main app tsconfig as an accidental test config

Introduce a dedicated test tsconfig, for example:

`tsconfig.test.json`

Responsibilities:

- extend the main `tsconfig.json`
- add `types: ["jest", "node"]`
- include only test files and any setup files

### 2.2 Decide how the main app typecheck treats tests

Two acceptable options:

1. Exclude tests from the primary `tsconfig.json` and run a separate test-specific typecheck.
2. Keep tests included, but only if the root config cleanly supports Jest globals.

Recommended option:

- exclude tests from the main app typecheck
- add a separate `type-check:tests` command if needed

Why:

- keeps application type errors separate from test-environment typing
- avoids forcing Jest globals into non-test compilation

### 2.3 Update scripts accordingly

Potential script contract:

```json
{
  "test": "jest --runInBand",
  "test:watch": "jest --watch",
  "test:ci": "jest --ci --runInBand",
  "type-check": "tsc --noEmit",
  "type-check:tests": "tsc -p tsconfig.test.json --noEmit"
}
```

If `type-check:tests` is added, wire it into CI.

---

## Phase 3: Normalize existing tests

### 3.1 Fix `tests/lib/helpers/ticket-waiting-response.test.ts`

This file should work once Jest types and config exist, but verify:

- `jsdom` environment is correctly applied
- localStorage access works in Jest
- path alias imports resolve

### 3.2 Resolve `tests/protocol-deliver.test.mjs`

Choose one path:

#### Option A: migrate it into Jest

Pros:

- single runner
- simpler CI and contributor workflow

Work:

- rewrite imports/assertions to Jest style where useful
- keep raw HTTP server logic
- ensure timeout behavior remains deterministic

#### Option B: keep it as `node:test`

If choosing this option:

- rename scripts to make the split explicit
- add `test:jest` and `test:node`
- make `yarn test` run both
- document when each framework should be used

Recommendation:

- prefer Option A unless there is a strong reason to keep low-level protocol tests on `node:test`

### 3.3 Standardize naming and placement

Document and enforce:

- all app/unit tests live under `tests/`
- use `*.test.ts` or `*.test.tsx`
- avoid mixing test runner styles within the same folder unless explicitly documented

---

## Phase 4: Add missing baseline coverage

The repository currently has very limited automated coverage. Once Jest runs reliably, add a small set of high-value tests around the current review findings.

### 4.1 Everhour regression coverage

Add tests for:

- first manual entry creation when a ticket has no existing Everhour task
- task-id-only panel behavior
- panel refresh when task context changes

### 4.2 Packaging/security guard tests

Add tests or script-level assertions for:

- allowed Electron runtime env keys
- forbidden secret keys in generated runtime config

### 4.3 Protocol route behavior

Preserve current protocol-deliver timeout/error-path coverage after the runner migration.

---

## Phase 5: CI and developer workflow

### 5.1 Make test commands truthful

CI should run at minimum:

- `yarn lint`
- `yarn type-check`
- `yarn test`

Optionally:

- `yarn type-check:tests`

### 5.2 Document local workflow

Add a short testing section to project docs or `CLAUDE.md` covering:

- which runner is canonical
- how to run all tests
- where new tests should live
- when to use `jsdom` vs plain Node environment

### 5.3 Prevent silent regressions

Add a CI check that fails if:

- `package.json` references `jest` but Jest is not installed
- test files use Jest globals without Jest typing
- unsupported test extensions/runners appear without config updates

---

## Proposed File Changes

Expected files to create or modify:

- `package.json`
- `jest.config.ts` or `jest.config.mjs`
- `jest.setup.ts` if needed
- `tsconfig.json`
- `tsconfig.test.json`
- `tests/protocol-deliver.test.mjs` or its migrated replacement
- `tests/lib/helpers/ticket-waiting-response.test.ts`
- project docs referencing test commands

---

## Acceptance Criteria

- `yarn test` executes a real Jest suite successfully.
- Jest globals resolve correctly in TS tests.
- The repo no longer mixes undocumented test runners by accident.
- CI can rely on test commands as a true health signal.

---

## Risks and Mitigations

### Risk: Next.js aliasing and ESM/TS config make Jest setup noisy

Mitigation:

- keep the first config minimal
- only support the file types and aliases currently in use

### Risk: mixed `node:test` and Jest coverage becomes confusing

Mitigation:

- either consolidate on Jest immediately or formalize two separate commands
- avoid an undocumented hybrid state

### Risk: fixing test infra expands into broad refactors

Mitigation:

- phase the work:
  1. make commands truthful
  2. align configs
  3. migrate edge-case tests
  4. add new coverage

---

## Recommended Execution Order

1. Install Jest and add config.
2. Create `tsconfig.test.json`.
3. Decide the fate of the `node:test` file.
4. Make `yarn test` and `yarn type-check` pass.
5. Add regression coverage for current high-priority issues.
