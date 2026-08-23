#!/bin/bash
# Overlord post-tool capture callback. `capture-change --agent __OVERLORD_ADAPTER_KEY__`
# applies the connector-owned codec; only a normalized `file.edited` path becomes
# objective-bound, non-exclusive `declared_edit`/`direct` evidence. Normalized reads,
# searches, and fetches are ignored. Mutation-capable callbacks without a normalized edit
# path, plus shell, generic, unknown, and unmapped callbacks, record unavailable health.

OBJECTIVE_REF="${OVERLORD_OBJECTIVE_ID:-}"

# Scope before reading stdin or spawning. Cwd and native session ids are never
# objective-selection authority.
if [ -z "$OBJECTIVE_REF" ] || ! command -v ovld >/dev/null 2>&1; then
  exit 0
fi

ovld protocol capture-change \
  --agent __OVERLORD_ADAPTER_KEY__ \
  --objective-id "$OBJECTIVE_REF" >/dev/null 2>&1 || true

exit 0
