# Deliver Stalling in Sandbox: Analysis and Recommendations

Date: February 26, 2026  
Project: Overlord  
Ticket context: protocol `deliver` intermittently hangs in sandbox while `attach` succeeds.

## Executive Summary

`npx overlord protocol attach` succeeds inside the coding-agent sandbox, but `npx overlord protocol deliver` hangs indefinitely (spinner) in the same environment. The same `deliver` command succeeds immediately when run with escalated permissions outside the sandbox.

This strongly indicates an environment-level networking/execution constraint in the sandbox path, combined with insufficient timeout/error handling in the CLI `deliver` implementation.

## Observed Evidence

1. `attach` succeeded multiple times in sandbox, returning session metadata.
2. `deliver` from sandbox repeatedly hung and never returned.
3. Direct `curl` from sandbox to `http://localhost:56612` failed with connection error (`curl: (7)`), indicating at least some local networking paths were blocked/unreachable in sandbox.
4. Running `deliver` with escalation (outside sandbox) succeeded quickly and moved ticket state to `review`.

## Working Understanding

There are two overlapping issues:

1. **Reachability/policy variance in sandbox**
- The sandbox can execute some local protocol traffic (`attach`) but is not reliably completing the `deliver` path.
- This can happen when command execution, networking namespace, or local-port access differs by process/runtime path.

2. **CLI behavior under failure is not resilient enough**
- `deliver` appears to stall rather than fail fast with a clear timeout/error.
- This makes transient or policy failures look like indefinite hangs.

## Why Attach Can Work While Deliver Fails

Even if both target the same base URL, they may differ in ways that expose sandbox limits:

- `deliver` sends a larger payload (summary + artifacts).
- `deliver` can trigger more server work before response.
- `deliver` can be more sensitive to request-body handling, response latency, or timeout policy.

So endpoint parity (`/attach` and `/deliver`) does not guarantee equal reliability inside constrained runtimes.

## Recommendations (Prioritized)

## 1) Make `deliver` fail fast in CLI (high priority)

Add explicit timeout and surfaced diagnostics:

- Add request timeout (e.g., 10-20 seconds) to protocol CLI network calls.
- On timeout, return explicit actionable error (include URL and endpoint).
- On non-2xx, print response status + compact body.

Expected benefit: no more indefinite spinner; immediate operator guidance.

## 2) Make server `deliver` response fast (high priority)

Refactor endpoint handling to acknowledge quickly:

- Persist minimal deliver event first.
- Return `200`/`202` immediately.
- Push expensive work (artifact expansion, post-processing) to background job/queue.

Expected benefit: reduces sensitivity to restricted runtimes and request timeouts.

## 3) Add protocol endpoint observability (high priority)

At minimum for `/attach` and `/deliver`, log:

- request start time
- endpoint + method
- content-length
- response status
- duration

Use correlation IDs to connect CLI attempt to server request.

Expected benefit: quickly distinguishes “request never arrived” vs “arrived and stalled”.

## 4) Support file-based artifacts input in CLI (medium priority)

Add `--artifacts-file <path>` to `overlord protocol deliver`.

Expected benefit: avoids shell-escaping and oversized inline JSON bodies.

## 5) Harmonize sandbox reachability strategy (medium priority)

For sandboxed agents, use a URL guaranteed reachable from that network context (not assuming host `localhost` semantics). Options:

- bind protocol service on `0.0.0.0` with controlled local access,
- provide a sandbox-reachable alias,
- or route through an approved bridge endpoint.

Expected benefit: stable behavior across all protocol subcommands.

## 6) Add automated regression coverage (medium priority)

Create tests for CLI protocol client:

- timeout path,
- large `deliver` payload,
- retry/backoff behavior,
- consistent error formatting.

Expected benefit: prevents reintroduction of silent hangs.

## Validation Plan

1. Instrument logs and deploy locally.
2. Run from sandbox:
- `attach` (baseline)
- `deliver` with minimal artifacts
- `deliver` with larger artifacts
3. Confirm whether `/deliver` requests hit server logs.
4. If hits are present but slow: optimize server path.
5. If hits absent: solve sandbox route/URL reachability.
6. Verify CLI now exits with explicit timeout error under forced network block.

## Practical Immediate Fix

If urgent operational reliability is required today:

1. Keep using escalated execution for `deliver` when sandbox hangs.
2. Implement CLI timeout + clear error output first.
3. Refactor server `deliver` into fast-ack + async processing next.

## Final Conclusion

The stall is not likely an auth/token issue. It is a combination of sandbox reachability/path constraints and insufficient timeout/error behavior in the `deliver` client flow. Addressing both (network path stability + fail-fast protocol client behavior) should make `deliver` as operationally reliable as `attach`.
