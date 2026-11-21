#!/bin/bash
# Overlord PermissionRequest notification hook (plugin-managed).
#
# Uses the protocol CLI so the hook stays behind the Connector → Protocol
# boundary. Silently no-ops if the mission or CLI is unavailable — the hook must
# never block the user or leak errors into the Codex session.
# A harness process an Overlord control-plane supervisor drives (for example a private
# `codex app-server`) carries OVERLORD_CONTROL_PLANE_SURFACE. The supervisor observes, decides
# and captures for it, so this callback must not report a second time.
[ -z "${OVERLORD_CONTROL_PLANE_SURFACE:-}" ] || exit 0

BODY=$(cat -)
if [ -n "${MISSION_ID:-}" ] && command -v ovld >/dev/null 2>&1; then
  (
    USER_TOKEN="${Overlord_USER_TOKEN:-${OVLD_USER_TOKEN:-}}"
    if [ -n "$USER_TOKEN" ]; then
      export Overlord_USER_TOKEN="$USER_TOKEN"
    fi
    printf '%s' "$BODY" | ovld protocol permission-request \
      --mission-id "$MISSION_ID" \
      --payload-file - \
      >/dev/null 2>&1
  ) &
  disown
fi
exit 0
