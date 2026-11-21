#!/bin/bash
# Overlord post-tool capture callback. `capture-change --agent __OVERLORD_ADAPTER_KEY__`
# applies the connector-owned codec; only a normalized `file.edited` path whose outcome is
# `ok` (decoded from the payload, or guaranteed by a success-only hook) becomes
# objective-bound, non-exclusive `declared_edit` evidence. Every scoped callback, including a
# harmless read, records callback observation. Failed/cancelled edits record outcome_partial,
# unknown outcomes outcome_unavailable, shell calls shell_activity_unverified, and other
# no-path callbacks direct_path_unavailable; none of them appends a path.

# A harness process an Overlord control-plane supervisor drives (for example a private
# `codex app-server`) carries OVERLORD_CONTROL_PLANE_SURFACE. The supervisor observes, decides
# and captures for it, so this callback must not report a second time.
[ -z "${OVERLORD_CONTROL_PLANE_SURFACE:-}" ] || exit 0

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
