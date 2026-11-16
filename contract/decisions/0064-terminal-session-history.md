# ADR 0064: Confirmed terminal lifecycle and retained history

- Date: 2026-11-16
- Status: accepted
- Contract version: 173.5.0
- Supersedes: none
- Amends: 0062

## Context

Logical agent delivery and terminal exit are independent. The mission screen needs
previous terminal sessions without interpreting lost contact as termination.

## Decision

Keep the existing closed wire states: running, stopping, lost and exited. Exited
means ended with confirmed process termination; lost means no reliable contact or
no retained session evidence. Lost has no endedAt or endReason, can recover to
running, and never becomes ended merely through age or objective delivery.
Confirmed exit is monotonic. No objective state or automatic stop is added.

Store additive endedAt, endReason, endRequestedAt and lastObservedAt on the existing
execution request providerSession metadata. endedAt uses Latch's exit time when
available, otherwise the first confirmation time. Legacy exited mappings without
that metadata read with last request update time and unknown reason; the time is
an observation fallback, not a reconstructed exact process exit.

End reasons are an open vocabulary: ended_by_person, exited, objective_delivered,
machine_went_away and unknown. The explicit end operation records human intent
before dispatch, so concurrent observation preserves ended_by_person. An already
exited session is not relabelled by a later end call. Ordinary confirmed exits use
exited. objective_delivered and machine_went_away require positive causal evidence;
this implementation never invents either from delivery or lost contact.

A backend PollLoop observes up to twenty oldest-observed non-ended mappings every
thirty seconds through the existing read-only inspectLatchSession runner queue
capability, with a ten-second result deadline. Replicas in one time bucket share
an inspection key. Observation uses the launch requester's existing target access;
removed access yields lost. State transitions append status_change mission events
and execution_request/mission_event entity changes; timestamp-only refreshes do
not flood clients. More than twenty sessions and offline runners can delay detection.
A timeout does not prove process exit. Restarting the backend resumes observation.

Mission detail includes its existing live mappings and at most five recent ended
mappings. GET /api/missions/:id/terminal-sessions/history requires mission:read in
the mission workspace and returns ended-only pages (default 20, maximum 100),
ordered by execution request created_at and id descending. Its cursor is a
mission-scoped execution request id. Existing forget hides the mapping from mission
detail; an ended mapping is archived as endedTerminalSession in the same request
metadata so history survives. Retain metadata until mission deletion subject to
its deletion policy. This retains no terminal recordings or credentials.

Latch already reports spontaneous child exit with retained exit time. Its linked
change handles clean daemon termination outside signal context, allows the reader
to retain confirmed child exit before removing the socket, and lets inspect use
that retained evidence after the daemon exits. A bounded shutdown that cannot
confirm child termination, abrupt daemon death and machine disappearance stay lost.
No callback endpoint, client gateway token, or exclusive attachment is needed.

## Consequences

Contract impact: minor. REST gains optional endedAt/endReason fields and a history
read. Older clients and runners remain valid; older runners fall back to observation
time. Core persistence and backend observer change together; the runner inspection
result adds optional endedAt. No database migration or closed vocabulary change.
The Latch improvement needs its binary update to distinguish its clean shutdowns.

## Alternatives considered

A new push-only Latch callback would duplicate authenticated runner routing and
lose events while offline. Keeping all history in mission detail would grow the
common read without bound. Inferring ended from objective delivery or heartbeat
expiry contradicts the approved mission behavior and can misrepresent live processes.
