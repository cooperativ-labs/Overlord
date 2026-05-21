#!/bin/bash
# Overlord PermissionRequest notification hook (plugin-managed).
#
# Notifies Overlord when Codex is about to show a permission prompt. Exits 0
# immediately so Codex continues its normal approval flow; Overlord only adds UI
# notification on top.

BODY=$(cat -)
OVERLORD_BASE_URL="${OVERLORD_URL:-}"
OVERLORD_TOKEN="${OVERLORD_ACCESS_TOKEN:-}"
OVERLORD_LOCAL_SECRET="${OVERLORD_LOCAL_SECRET:-}"

if [ -n "$OVERLORD_BASE_URL" ] && [ -n "$OVERLORD_TOKEN" ] && [ -n "${TICKET_ID:-}" ]; then
  (
    curl -sf -m 5 \
      -X POST "$OVERLORD_BASE_URL/api/protocol/permission-request?ticketId=$TICKET_ID" \
      -H "Authorization: Bearer $OVERLORD_TOKEN" \
      -H "X-Overlord-Local-Secret: $OVERLORD_LOCAL_SECRET" \
      -H "Content-Type: application/json" \
      -d "${BODY:-{}}" \
      >/dev/null 2>&1
  ) &
  disown
fi

exit 0
