#!/bin/bash
# Overlord Cursor beforeSubmitPrompt hook — posts user composer prompts to the ticket activity feed.
# Cursor does not expose Claude's turn_number; we send a monotonic turnIndex per conversation (always >= 1)
# so POST /api/protocol/hook-event records the event (the API skips only turnIndex === 0).

BODY=$(cat -)

OVERLORD_BASE_URL="${OVERLORD_URL:-${OVERLORD_CONNECTOR_URL:-}}"
OVERLORD_TOKEN="${OVERLORD_ACCESS_TOKEN:-}"
TICKET_ID="${TICKET_ID:-}"
OVERLORD_LOCAL_SECRET="${OVERLORD_LOCAL_SECRET:-}"

if [ -n "$OVERLORD_BASE_URL" ] && [ -n "$OVERLORD_TOKEN" ] && [ -n "$TICKET_ID" ]; then
  PAYLOAD=$(
    printf '%s' "$BODY" | python3 -c "
import hashlib
import json
import os
import sys

try:
    body = json.load(sys.stdin)
except Exception:
    sys.exit(0)

text = (body.get('prompt') or body.get('message') or '').strip()
if not text:
    sys.exit(0)

cid = body.get('conversation_id') or 'unknown'
state_dir = os.path.join(os.path.expanduser('~'), '.ovld', 'cursor-user-prompt-hook')
os.makedirs(state_dir, exist_ok=True)
path = os.path.join(state_dir, hashlib.sha256(cid.encode()).hexdigest())
try:
    with open(path, encoding='utf-8') as handle:
        n = int((handle.read() or '0').strip() or '0')
except Exception:
    n = 0
n += 1
with open(path, 'w', encoding='utf-8') as handle:
    handle.write(str(n))

tid = os.environ.get('TICKET_ID', '')
print(json.dumps({'hookType': 'UserPromptSubmit', 'ticketId': tid, 'prompt': text, 'turnIndex': n}))
" 2>/dev/null
  )
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

printf '%s\n' '{"continue":true}'
exit 0
