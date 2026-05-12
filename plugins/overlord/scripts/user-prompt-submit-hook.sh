#!/bin/bash
# Overlord UserPromptSubmit hook — fires before Codex processes each user turn.

BODY=$(cat -)
OVERLORD_BASE_URL="${OVERLORD_URL:-}"
OVERLORD_TOKEN="${OVERLORD_ACCESS_TOKEN:-}"
OVERLORD_LOCAL_SECRET="${OVERLORD_LOCAL_SECRET:-}"

TURN=$(printf '%s' "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('turn_number', 0))" 2>/dev/null || echo "0")
if [ "$TURN" = "0" ]; then
  exit 0
fi

if [ -n "$OVERLORD_BASE_URL" ] && [ -n "$OVERLORD_TOKEN" ] && [ -n "$TICKET_ID" ]; then
  PAYLOAD=$(printf '%s' "$BODY" | python3 -c "import json,sys; body=json.load(sys.stdin); print(json.dumps({'hookType': 'UserPromptSubmit', 'ticketId': __import__('os').environ['TICKET_ID'], 'prompt': body.get('prompt', ''), 'turnIndex': body.get('turn_number', 0)}))" 2>/dev/null || echo '')
  if [ -n "$PAYLOAD" ]; then
    curl -sf -m 5 \
      -X POST "$OVERLORD_BASE_URL/api/protocol/hook-event" \
      -H "Authorization: Bearer $OVERLORD_TOKEN" \
      -H "X-Overlord-Local-Secret: $OVERLORD_LOCAL_SECRET" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      >/dev/null 2>&1 &
    disown
  fi
fi

exit 0
