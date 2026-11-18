# ADR 0077: Lead mission terminal controls with the newest session

Status: accepted
Date: 2026-11-18

## Context

Mission-level Latch controls can lead to an older session when an older objective
is executing or a newer session is no longer reported running. People expect the
mission's latest session when opening Latch.

## Decision

Mission-level terminal controls lead with the most recently created mapped
session, regardless of its objective or observed state. The state remains visible;
other mappings remain accessible. Objective-specific controls retain their scope.
This changes only selection and does not imply a session is running or reachable.

## Consequences

Contract impact: major. The former active-objective-first guarantee changes.
Web, desktop and mobile clients must adopt the new selection rule together;
the backend projection and wire format are unchanged. Older clients continue to
decode responses but may lead with a different session until upgraded.
