# ADR 0073: Agent mission item inspection and standalone closure

Status: accepted
Date: 2026-11-17

## Decision

Add mission-items and close-items to the existing protocol transport and both MCP
surfaces. Reuse mission resolution, live session validation and the item lifecycle
service. Item reads return full detail, a total and live offset pagination; the
baseline prioritizes blocking actions. Standalone closure reuses delivery validation
and warnings with agent objective provenance and a null delivery reference.

## Consequences

This is an additive minor interface change across core, backend, CLI and MCP.
No migration or new permission is needed. Existing clients keep working. Offset
pages can shift with concurrent writes, so callers restart inspection after changes
and inspect before closing. Closure never publishes prose or ends the session.
