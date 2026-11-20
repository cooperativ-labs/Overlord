# ADR 0086: People delete mission artifacts

Date: 2026-11-20
Status: accepted
Contract version: [179.1.0](../CHANGELOG.md#17910---2026-11-20)
Supersedes: none
Contract impact: minor

## Context

People could edit a mission's artifacts but not remove one that is wrong,
duplicated or obsolete. The `artifacts` table already had a `deleted_at`
tombstone, and every artifact read already excluded tombstoned rows, but no
surface set it. People also had no first-party way to add an artifact, although
`postMissionsByIdArtifacts` already accepted one without a delivery.

## Decision

Add `DELETE /api/missions/{id}/artifacts/{artifactId}`. It requires
`mission:update`, the same permission as editing an artifact, sets
`deleted_at`, `updated_at` and the next `revision`, and records an `artifact`
change with operation `delete`. A missing or already deleted artifact answers 404. The web app and mobile app delete artifacts through it and create them
through the existing `postMissionsByIdArtifacts`.

## Consequences

A deleted artifact leaves the mission's artifact list, the attach and load
context and later edits. Its row remains, so the delivery that produced it keeps
its provenance, and webhook payloads already sent are not affected. No
migration is needed. There is no restore surface; one can be added without
changing this rule.

## Alternatives considered

A hard delete would remove the provenance a delivery points to and could not be
undone by an operator. Requiring `expectedRevision` on delete would stop a
person from deleting an artifact an agent had just revised, without protecting
anything a delete needs to preserve.
