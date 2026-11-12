# ADR 0025: Local-target capabilities reach remote targets through the runner queue

- Date: 2026-08-27
- Status: accepted
- Contract version: 129
- Supersedes: none
- Origin: contract v129 (coo:833), backfilled 2026-11

## Context

A control-plane backend is never a local target, but branch actions, Latch probes and repository reads must run on the execution target that owns the checkout.

## Decision

Every `LocalTargetCapabilities` method reaches a non-co-located target by queueing an `execution_requests` row with `requested_source = 'local_target_mutation'` and awaiting the stored `CapabilityResult`; the runner dispatches over a closed allowlist (`LOCAL_TARGET_UNSUPPORTED` otherwise) and `launchAgent` keeps its own claim path. `LOCAL_TARGET_TIMEOUT` means still running, never failed and never a reason to re-queue. Mission and objective ids are nullable only for that source, enforced by a CHECK. Answers to agent questions are delivered through Latch's v2 Conversation Hub (`sendLatchMessage`) over a loopback-only gateway; `AgentRequestDto.delivery` is the sole answerability projection, and human resolve fails `409 request_not_deliverable` unless delivery is `latch`. `mission_events.type` gains `answer`.

## Consequences

- An ambiguous Latch send is never resent.
- The conversation channel is not an attach and never takes the terminal surface.

## Alternatives considered

Not recorded.
