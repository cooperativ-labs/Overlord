# Engineering Plan: Agent Launch Reliability Testing

**Date:** 2026-03-14
**Status:** Planning
**Author:** AI Engineering Agent

---

## Objective

Build a practical automated test strategy that makes agent launching reliable across:

- ticket header launch actions
- ask-mode launch actions
- org-scoped token resolution
- preloaded agent flags
- Electron IPC and preload plumbing
- external terminal launch behavior
- failure handling and user-visible errors

The immediate goal is to prevent regressions like:

- launch enters loading state but no terminal opens
- token exists in settings but launch still sends an empty bearer token
- org-specific token is not the one used for a ticket
- flags configured for an agent are missing from the launched command
- Electron shell and hosted frontend drift out of contract

---

## Problem Summary

The current launch path crosses several boundaries:

1. server-rendered ticket data
2. client components
3. Electron preload API
4. IPC handler
5. Electron-side launch preparation
6. remote protocol API
7. local external terminal execution

That makes agent launch correctness a contract problem, not just a component problem.

Today the repo has very limited automated coverage for this flow. That means regressions can hide in:

- prop wiring
- async token creation and reuse
- org scoping
- Electron API signature changes
- terminal launcher behavior
- error handling when launch partially fails

---

## Testing Goals

The test suite should verify these invariants:

1. Launching from a ticket always uses a non-empty bearer token.
2. The token used for a ticket belongs to the correct org.
3. Agent flags configured for the selected agent are included in the launch request.
4. The frontend and Electron shell agree on the `launchAgent(...)` argument contract.
5. Terminal-launch failures surface a visible error instead of silently resetting.
6. Successful launches produce the expected IPC payload and terminal invocation.
7. Web deploys and Electron builds cannot drift without a failing test.

---

## Recommended Testing Stack

## Unit and component tests

Use **Jest** as the primary unit/component runner, consistent with the existing repo direction and the prior plan in [feature-plans/jest-testing-implementation-plan-2026-03-07.md](/Users/jake/Development/Cooperativ/Overlord/feature-plans/jest-testing-implementation-plan-2026-03-07.md).

Add:

- `jest`
- `@types/jest`
- `jest-environment-jsdom`
- `@testing-library/react`
- `@testing-library/user-event`
- `@testing-library/jest-dom`

## Network mocking

Use **MSW** for browser/server boundary tests where the UI or server helpers need stable mocked protocol responses.

Add:

- `msw`

## End-to-end tests

Use **Playwright** for both:

- browser E2E
- Electron E2E via Playwright's Electron support

Add:

- `@playwright/test`

This is the best fit because it can cover the hosted frontend plus the packaged Electron shell with one framework.

---

## Proposed Test Pyramid

## Layer 1: Pure unit tests

Fast tests around deterministic logic.

Targets:

- `lib/actions/agent-tokens.ts`
- `electron/services/agent-launcher.ts`
- `electron/ipc/terminal.ts`
- helper modules involved in agent type and flag selection

## Layer 2: Component and integration tests

React tests that render the real launch controls with mocked actions and mocked Electron APIs.

Targets:

- `components/features/AgentSplitButton.tsx`
- `components/features/AskTicketButton.tsx`
- `components/features/TicketHeaderAction.tsx`
- `components/modals/settings/AgentsAndMcpPage.tsx`

## Layer 3: Web app E2E

Browser tests that verify the hosted app renders correct token/org state and calls the expected launch path.

Targets:

- settings workflow
- ticket page workflow

## Layer 4: Electron E2E

End-to-end tests that launch the actual Electron app, exercise the UI, and assert IPC payloads plus terminal-launch behavior through controlled stubs.

Targets:

- preload contract
- IPC payload integrity
- launch success
- launch failure

---

## Unit Test Proposal

## 1. Agent token actions

File target:

- `lib/actions/agent-tokens.ts`

Tests:

- `getAgentTokenAction(orgId)` returns only a token for that org.
- `ensureAgentTokenAction(orgId)` reuses an existing active token.
- `ensureAgentTokenAction(orgId)` creates a token when none exists.
- `ensureAgentTokenAction(orgId)` does not revoke other active tokens.
- `rotateAgentTokenAction(orgId)` revokes only tokens for that org.
- token creation fails cleanly when the user is not a member of the target org.
- expired tokens are treated as unusable.

Implementation notes:

- mock Supabase server client and service-role client
- assert exact query filters for `user_id` and `organization_id`

## 2. Electron launch preparation

File target:

- `electron/services/agent-launcher.ts`

Tests:

- throws a clear error when no token is available
- sends `Authorization: Bearer <token>` when fetching context
- includes `X-Overlord-Local-Secret` when configured
- uses `launchMode=ask` correctly in the context URL
- includes agent-specific flags in the final command
- maps `claude`, `codex`, `cursor`, `gemini` to the correct command shape
- falls back to POST command generation when GET context fetch fails
- uses API-provided working directory when no explicit `cwd` is passed

Implementation notes:

- stub `global.fetch`
- stub temp file writes
- assert built command strings and env payloads

## 3. External terminal launcher

File target:

- `electron/ipc/terminal.ts`

Tests:

- writes a launch script containing `cwd`, env, and command
- rejects when terminal app startup fails
- uses fallback app-open commands for Ghostty/Alacritty/Kitty
- resolves on successful AppleScript terminal open
- surfaces a useful error for missing custom terminal app

Implementation notes:

- mock `child_process.exec`
- mock `fs.writeFileSync`
- mock settings store values for each terminal type

## 4. Contract tests for preload and terminal provider

File targets:

- `electron/preload.ts`
- `components/features/terminal/TerminalProvider.tsx`
- `types/electron.d.ts`

Tests:

- `TerminalProvider.launchAgent(...)` forwards arguments in the expected order
- preload `terminal.launchAgent(...)` serializes `ticketId`, `agent`, `cwd`, `agentToken`, `launchMode`, and `flags`
- a contract snapshot verifies the payload keys so Electron/frontend signature drift fails loudly

This specifically guards against the class of bugs where the hosted UI expects a newer preload signature than the installed Electron shell.

---

## Component and Integration Test Proposal

## 5. Agent split button behavior

File target:

- `components/features/AgentSplitButton.tsx`

Tests:

- clicking launch in Electron mode calls `launchAgent(...)` with selected agent, token, and flags
- if `agentToken` prop is missing, it resolves a token for the provided org before launch
- copy-local and copy-cloud paths do not call Electron launch
- disabled state blocks launch when working directory access is unavailable
- launch failures show the toast error
- loading state clears after both success and failure
- dropdown agent selection updates the launched agent

## 6. Ask button behavior

File target:

- `components/features/AskTicketButton.tsx`

Tests:

- ask launch calls `launchAgent(...)` with `launchMode='ask'`
- ask launch includes token fallback and flags
- browser mode copies the ask prompt instead of calling Electron
- error state and toast render correctly on failure

## 7. Ticket header wiring

File target:

- `components/features/TicketHeaderAction.tsx`

Tests:

- passes `organizationId`, `agentToken`, and `agentFlags` through to launch controls
- Electron mode renders launch controls
- browser mode renders copy-based fallback controls

## 8. Settings org-scoped token UI

File target:

- `components/modals/settings/AgentsAndMcpPage.tsx`

Tests:

- defaults token selector to the selected org
- loading the org selector triggers `ensureAgentTokenAction(orgId)`
- rotating a token only targets the selected org
- copied env snippet uses the currently selected org's token
- token label clearly reflects the selected workspace

---

## End-to-End Test Proposal

## 9. Browser E2E: Settings token workflow

Use Playwright against the web app.

Scenarios:

- open `Agents & MCP`, switch orgs, verify token panel updates
- rotate token in org A, verify org B token is unchanged
- copy env snippet and verify clipboard contents match selected org

Test data:

- seeded user with membership in at least two orgs
- one token present in org A, none in org B

## 10. Browser E2E: Ticket launch wiring

Use Playwright with the Electron API mocked into the page or with a browser-only diagnostic harness page.

Scenarios:

- ticket page with existing token launches selected agent with expected payload
- ticket page with no preloaded token still resolves a token and launches successfully
- ticket page includes configured flags in the launch payload

Assertions:

- `agentToken` is non-empty in the launch request
- `flags` contain the configured values
- `organizationId` used for token resolution matches the ticket org

## 11. Electron E2E: Successful launch

Use Playwright Electron mode.

Scenarios:

- open a real ticket in Electron
- click Run on `AgentSplitButton`
- intercept IPC or stub terminal launcher
- assert:
  - `terminal:launch-agent` is invoked
  - payload includes non-empty `agentToken`
  - payload includes selected agent flags
  - external terminal launch path is reached

Implementation options:

- expose a test-only Electron hook that records the most recent `terminal:launch-agent` payload
- or run Electron in a test mode where `launchScriptInExternalTerminal(...)` is stubbed and writes payload details to a temp JSON file

## 12. Electron E2E: Launch failure behavior

Scenarios:

- stub external terminal open to fail
- click Run
- verify:
  - loading state ends
  - visible toast appears
  - error message is meaningful

## 13. Electron E2E: Version skew detection

This is critical.

Create one test that boots the current Electron shell against the current hosted frontend bundle and verifies that a launch from the UI results in a payload containing:

- `agentToken`
- `launchMode`
- `flags`

If the preload or provider signature drifts, this test should fail immediately.

---

## Required Test Fixtures

## Seed data

Add stable test fixtures for:

- user with two org memberships
- at least one project per org
- at least one ticket per org
- one org with a pre-existing active token
- one org with no token
- per-agent config rows with flags for `claude` and `codex`

## Test helpers

Create helpers for:

- authenticated web session bootstrap
- authenticated Electron session bootstrap
- creating a fake `window.electronAPI`
- mocking `sonner` toasts
- mocking clipboard writes
- mocking protocol context responses
- capturing Electron IPC launch payloads

---

## Suggested Repository Additions

## Jest structure

Add:

- `jest.config.ts`
- `jest.setup.ts`
- `tsconfig.test.json`

Recommended test locations:

- `tests/unit/electron/*.test.ts`
- `tests/unit/lib/*.test.ts`
- `tests/components/features/*.test.tsx`
- `tests/contracts/*.test.ts`

## Playwright structure

Add:

- `playwright.config.ts`
- `tests/e2e/web/*.spec.ts`
- `tests/e2e/electron/*.spec.ts`

## Electron test mode

Add a test-only mode, for example:

- `OVERLORD_E2E=1`

In that mode:

- external terminal execution is stubbed
- launch payloads can be recorded
- app update checks are disabled
- noisy network integrations are turned off

This will make Electron E2E feasible and stable.

---

## Rollout Plan

## Phase 1: Repair baseline testing

Build on the existing Jest plan and get green local unit/component tests.

Deliverables:

- Jest config
- RTL setup
- first unit tests for token and launcher logic

## Phase 2: Add launch-flow component coverage

Deliverables:

- `AgentSplitButton` tests
- `AskTicketButton` tests
- `AgentsAndMcpPage` tests

## Phase 3: Add Playwright web coverage

Deliverables:

- settings token E2E
- ticket launch wiring E2E

## Phase 4: Add Playwright Electron coverage

Deliverables:

- successful launch E2E
- failure handling E2E
- version-skew contract E2E

---

## Minimum Viable Test Set

If we want the fastest path to meaningful protection, implement these first:

1. unit tests for `ensureAgentTokenAction(orgId)` and `rotateAgentTokenAction(orgId)`
2. unit tests for `prepareAgentLaunch(...)`
3. component tests for `AgentSplitButton`
4. component tests for `AgentsAndMcpPage`
5. one Electron E2E test that clicks Run and asserts the launch payload contains a non-empty token and expected flags

That set alone would have caught the recent launch regressions.

---

## Success Criteria

This effort is successful when:

- `yarn test` covers the agent launch core logic
- `yarn test:e2e:web` verifies org-scoped token behavior
- `yarn test:e2e:electron` verifies real launch payload integrity
- CI blocks merges when token, flag, or Electron launch contracts regress
- a user-visible launch regression can be traced to a failing automated test instead of production debugging

