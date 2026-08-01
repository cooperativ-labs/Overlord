# Agent Session Module — Objective 7 Review

Mission: `coo:562`  
Plan reviewed: `planning/feature-plans/agent-session-module.md`  
Date: 2026-08-01

## Summary

The durable channel, normalized event, request, input, connector descriptor, and adapter codec
foundations are implemented and have substantial SQLite, route-authentication, CLI, and fixture
coverage. This review corrected a security-relevant ownership drift in the decision path: native
request decoding and response encoding had been hard-coded in the CLI, while the contract says
native dialects belong to connectors. Connector-owned decision declarations now run through one
pure redacting interpreter, and executable fixtures pin both the safe card and exact native bytes.

The review also found several plan acceptance conditions that are implemented as isolated
functions or declarations but are not wired into production lifecycle paths. They remain listed
below so generated capability pages and user documentation are not mistaken for end-to-end
proof.

Severity summary: **0 critical, 4 high, 3 medium, 0 low**.

## Corrected in this objective

### Connector-owned decision codecs

- **Category:** component ownership, security, maintainability
- Native Claude, Codex, Cursor, and Pi request paths and response bodies now live under each
  connector's `codec/` directory.
- The CLI selects a generated registry and delegates to the pure core. It no longer branches on
  adapter names or constructs native decision objects itself.
- Request descriptions use the existing deterministic formatters and secret redaction before
  REST. Recorded AWS-style credentials are forbidden by the fixtures from appearing in the
  request card.
- `decision-codec` is a contract fixture kind. A supported callback/extension `decide.*` claim
  must execute the shipped interpreter and prove exact allow, deny, and defer bytes.

### Honest callback deadline

- **Category:** potential race, user trust
- The callback now persists the same deadline it actually observes: 80% of the native harness
  timeout (or the bounded fallback when the payload has none). A request card can no longer
  advertise an answer window longer than its waiting hook.

### Documentation drift

- **Category:** maintainability, consistency
- Added user-facing observe/decide/inject and channel concepts, exact CLI examples, and explicit
  conflict guidance for competing hooks, fail-closed settings, timeout stacking, duplicate side
  effects, shared config namespaces, and stdout corruption.
- Added a per-adapter troubleshooting page for Claude, Codex, Cursor, Pi, OpenCode, and
  Antigravity.
- Corrected stale adapter READMEs that referred to the removed `ovld protocol
  permission-request` command or described Pi as input-only.

## High-priority open findings

### 1. Channel sentinel is never started

- **Location:** `cli/src/agent-session/sentinel.ts:31`; no production call site
- **Category:** reliability, incomplete integration
- **Impact:** the 180-second channel/credential lease is not renewed for an otherwise idle,
  healthy launched agent. Hook activity does not heartbeat the channel. Long-running sessions
  can therefore lose their scoped credential while the harness is still alive, and clean harness
  exit does not call the channel end transition.
- **Recommendation:** add a supervised sentinel to both inline and external-terminal launch
  lifecycles. It must live as long as the harness process, heartbeat without blocking the harness,
  and call `/end` with the observed exit result.

### 2. Server-side request/channel sweeps have no production scheduler

- **Location:** `packages/core/service/agent-session/requests.ts:476`,
  `packages/core/service/agent-session/channels.ts:524`; test-only call sites
- **Category:** race safety, stale state
- **Impact:** the waiter-lease and channel-lease safety functions are tested but never invoked by
  the backend. A killed callback can leave an open request answerable, and an expired channel can
  continue to be projected as live in human surfaces. Credential authentication eventually
  fails, but durable state does not make the corresponding terminal transition.
- **Recommendation:** add one backend maintenance worker that iterates authorized workspace
  contexts and repeatedly calls both bounded sweep functions. Add a process-kill integration test
  that observes the production worker, not only direct service calls.

### 3. Effective live capabilities are neither computed nor trusted

- **Location:** `packages/core/service/agent-session/channels.ts:121`,
  `packages/core/service/agent-session/channels.ts:376`,
  `backend/agent-session-routes.ts:215`
- **Category:** authorization-adjacent correctness, product gating
- **Impact:** a channel starts with `{}` and the adapter heartbeat can replace
  `capabilities_json` with arbitrary input. There is no `capabilities.ts` service that intersects
  the fixture-backed catalog with installed-version evidence, runtime probes, connector drift,
  and workspace/project policy. The mission input UI gates only on the existence of a channel,
  so it can offer an instruction to a tier-0 or non-injecting adapter.
- **Recommendation:** generate a backend-readable static maximum, accept only downgrade probe
  facts from the adapter, compute the effective snapshot server-side, and return/gate on that
  snapshot in human DTOs. Never let the adapter widen its own capabilities.

### 4. The Phase 2 web decision surface is absent

- **Location:** human REST routes exist in `backend/agent-session-routes.ts`; no request component
  exists under `webapp/web`
- **Category:** incomplete feature
- **Impact:** a second terminal can list and resolve requests with `ovld requests`, but the plan's
  web/mobile approval workflow and presence source do not exist. End-to-end acceptance such as
  “web approval pre-empts the terminal prompt” is therefore not demonstrated.
- **Recommendation:** ship the request inbox/card UI only after findings 1–3 are closed. Gate
  controls on the live effective snapshot and revision/window state, then add browser-versus-hook
  race tests.

## Medium-priority open findings

### 5. Presence policy is pure and tested, but unused by the callback runtime

- **Location:** `packages/core/service/agent-session/pure/window.ts`; runtime deadline in
  `cli/src/agent-session/request.ts:64`
- **Category:** incomplete policy integration
- **Impact:** active/away/unknown and project-zero sizing do not currently influence live
  callback requests. The newly persisted callback deadline is honest, but it is based only on the
  harness timeout.
- **Recommendation:** make the server the decision-window authority once a real presence source
  exists; return a clamped deadline to the waiter and release immediately on idle-to-active.

### 6. Push diagnostics and degraded heartbeat are promised but not implemented

- **Location:** `cli/src/agent-session/event.ts:140`
- **Category:** error handling, diagnosability
- **Impact:** all push failures are intentionally silent to the harness, but scoped failures do
  not increment a bounded local diagnostic and do not degrade channel health as the plan states.
  Operators see missing activity without a durable reason code.
- **Recommendation:** add a bounded, secret-free diagnostic counter after scope succeeds and
  include only allowlisted health codes in the next heartbeat. Preserve total silence before the
  scope gate.

### 7. Optional Pi policy and OpenCode supervision lack product wiring

- **Location:** Pi checks environment variables only in
  `connectors/adapters/pi/extensions/overlord.ts`; OpenCode has a sidecar command but no bundled
  agent-catalog launch entry
- **Category:** incomplete launch/policy integration
- **Impact:** Pi's declared workspace ceiling/project opt-in is not projected by a policy service,
  and a normal Overlord launch does not automatically supervise OpenCode's sidecar. The runtime
  pieces can be tested directly, but users cannot infer that they are active from connector setup
  alone.
- **Recommendation:** model Pi enablement as explicit workspace/project settings supplied by the
  runner, and add an OpenCode launch mapping that starts and stops the sidecar with the harness.

## Positive observations

- Channel credentials are a separate, hash-only, one-channel credential family; user tokens and
  protocol session keys are rejected by adapter routes.
- Native event reduction occurs locally through an allowlisted pure envelope; raw payloads do not
  become the default transport.
- Event replay, request CAS, input no-retry-after-emission, and honest delivery labels are covered
  by focused tests.
- OpenCode binds loopback and uses a per-launch control-port secret.
- Capability claims distinguish supported, unsupported, not implemented, and unverified, and the
  generator refuses fixture-free supported claims.

## Verification

- Connector capability and conformance checks pass at contract version 52.
- Core agent-session tests pass; the full core suite currently has three unrelated
  `postgres-conformance.test.ts` SQLite setup failures caused by an invalid pre-existing
  `execution_requests` test insert.
- CLI suite passes: 334 passed, 9 skipped.
- Backend suite passes: 275 passed.
- Documentation build passes: 38 pages.
- Lint completes with zero errors; the repository retains pre-existing warnings.

