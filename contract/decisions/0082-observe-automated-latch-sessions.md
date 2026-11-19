# ADR 0082: Observe Latch sessions from launches without a requester

Status: accepted  
Date: 2026-11-19  
Amends: 0064

## Context

An automated Run Queue launch can have no requesting member. The terminal
observer used that missing member to look up eligible targets and marked the
session lost without sending an inspection to its runner.

## Decision

For launches with a requester, retain the requester's target eligibility check.
For launches without one, look up the recorded claiming local target in the
request's workspace. Require the stored terminal mapping to resolve to that
target and require its owner to be an active member of the same workspace. Check
the owner's current target access, project eligibility and target reachability
through the existing eligibility service.

The worker sends only the existing read-only inspection to the recorded target.
It keeps system attribution for the probe and observation. Missing claim or
access evidence leaves the session unconfirmed. Confirmed exits and absent
session handling follow the existing lifecycle rules.

## Consequences

Contract impact: patch. The observer can correct an existing false lost state
on the next successful probe. Clients consume the same terminal projection.
Runner commands, user-facing permissions and stored formats remain compatible.
