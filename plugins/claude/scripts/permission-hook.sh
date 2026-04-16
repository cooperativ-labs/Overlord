#!/bin/bash
# Overlord PermissionRequest notification hook (plugin-managed).
#
# Prefers plugin userConfig values (CLAUDE_PLUGIN_OPTION_*) when set, and falls
# back to the raw OVERLORD_URL / AGENT_TOKEN env vars Overlord-launched shells
# already export. Silently no-ops if we can't authenticate — the hook must
# never block the user or leak errors into the Claude session.
BODY=$(cat -)
OVERLORD_BASE_URL="${CLAUDE_PLUGIN_OPTION_OVERLORD_URL:-$OVERLORD_URL}"
OVERLORD_TOKEN="${CLAUDE_PLUGIN_OPTION_AGENT_TOKEN:-$AGENT_TOKEN}"
if [ -n "$OVERLORD_BASE_URL" ] && [ -n "$OVERLORD_TOKEN" ] && [ -n "$TICKET_ID" ]; then
  curl -sf -m 5 \
    -X POST "$OVERLORD_BASE_URL/api/protocol/permission-request?ticketId=$TICKET_ID" \
    -H "Authorization: Bearer $OVERLORD_TOKEN" \
    -H "X-Overlord-Local-Secret: $OVERLORD_LOCAL_SECRET" \
    -H "Content-Type: application/json" \
    -d "$BODY" \
    >/dev/null 2>&1 &
  disown
fi
exit 0
