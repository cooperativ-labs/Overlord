#!/bin/bash
# Overlord UserPromptSubmit hook — fires before Antigravity CLI processes each user turn.
# Uses file-based turn tracking keyed by session_id (falling back to turn_number if
# the payload provides it) so the first submit (turnIndex 0 — the initial injected
# ticket/objective prompt) is skipped by POST /api/protocol/hook-event.

BODY=$(cat -)
OVERLORD_BASE_URL="${OVERLORD_URL:-}"
OVERLORD_TOKEN="${OVERLORD_ACCESS_TOKEN:-}"
OVERLORD_LOCAL_SECRET="${OVERLORD_LOCAL_SECRET:-}"
HOOK_NAME="antigravity"
LOG_DIR="${HOME:-}/.ovld/logs"
LOG_FILE="${LOG_DIR}/antigravity-user-prompt-submit-hook.log"

log_hook() {
  mkdir -p "$LOG_DIR" 2>/dev/null || return 0
  printf '%s [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$HOOK_NAME" "$1" >>"$LOG_FILE" 2>/dev/null || true
}

PROMPT_LEN=$(printf '%s' "$BODY" | python3 -c "import json,sys; print(len((json.load(sys.stdin).get('prompt') or '').strip()))" 2>/dev/null || echo "0")
SESSION_ID=$(printf '%s' "$BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id') or d.get('sessionId') or 'unknown')" 2>/dev/null || echo "unknown")
log_hook "received submit session_id=$SESSION_ID prompt_len=$PROMPT_LEN ticket_present=$([ -n "${TICKET_ID:-}" ] && echo yes || echo no)"

if [ -z "$OVERLORD_BASE_URL" ] || [ -z "$OVERLORD_TOKEN" ] || [ -z "${TICKET_ID:-}" ]; then
  log_hook "missing required env base_url=$([ -n "$OVERLORD_BASE_URL" ] && echo yes || echo no) token=$([ -n "$OVERLORD_TOKEN" ] && echo yes || echo no) ticket=$([ -n "${TICKET_ID:-}" ] && echo yes || echo no)"
  exit 0
fi

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

text = (body.get('prompt') or '').strip()
if not text:
    sys.exit(0)

# Support both session_id (file-based tracking) and turn_number (direct from payload)
turn_number = body.get('turn_number')
if turn_number is not None:
    try:
        turn_index = int(turn_number)
    except (TypeError, ValueError):
        turn_index = None
else:
    turn_index = None

if turn_index is None:
    # Fall back to file-based turn tracking keyed by session_id
    sid = body.get('session_id') or body.get('sessionId') or 'unknown'
    state_dir = os.path.join(os.path.expanduser('~'), '.ovld', 'antigravity-user-prompt-hook')
    os.makedirs(state_dir, exist_ok=True)
    path = os.path.join(state_dir, hashlib.sha256(sid.encode()).hexdigest())
    last_posted = -1
    try:
        with open(path, encoding='utf-8') as handle:
            raw = (handle.read() or '').strip()
            if raw != '':
                last_posted = int(raw)
    except Exception:
        last_posted = -1
    turn_index = last_posted + 1
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(str(turn_index))

tid = os.environ.get('TICKET_ID', '')
print(json.dumps({'hookType': 'UserPromptSubmit', 'ticketId': tid, 'prompt': text, 'turnIndex': turn_index}))
" 2>/dev/null
  )
  if [ -z "$PAYLOAD" ]; then
    log_hook "failed to build hook-event payload from submit body"
    exit 0
  fi

  PAYLOAD_TURN=$(printf '%s' "$PAYLOAD" | python3 -c "import json,sys; print(json.load(sys.stdin).get('turnIndex', 'unknown'))" 2>/dev/null || echo "unknown")
  log_hook "built payload turn=$PAYLOAD_TURN posting hook-event"
  (
    RESPONSE_FILE=$(mktemp "${TMPDIR:-/tmp}/overlord-hook-event.XXXXXX")
    HTTP_CODE=$(curl -sS -m 5 -o "$RESPONSE_FILE" -w "%{http_code}" \
      -X POST "$OVERLORD_BASE_URL/api/protocol/hook-event" \
      -H "Authorization: Bearer $OVERLORD_TOKEN" \
      -H "X-Overlord-Local-Secret: $OVERLORD_LOCAL_SECRET" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD")
    CURL_EXIT=$?
    RESPONSE_PREVIEW=$(python3 -c "from pathlib import Path; import sys; p=Path(sys.argv[1]); text=p.read_text(encoding='utf-8', errors='replace') if p.exists() else ''; text=' '.join(text.split()); print(text[:200])" "$RESPONSE_FILE" 2>/dev/null || echo '')
    rm -f "$RESPONSE_FILE"
    if [ "$CURL_EXIT" -eq 0 ]; then
      log_hook "hook-event POST finished exit=0 http_status=$HTTP_CODE response_preview=$RESPONSE_PREVIEW"
    else
      log_hook "hook-event POST failed exit=$CURL_EXIT http_status=${HTTP_CODE:-none} response_preview=$RESPONSE_PREVIEW"
    fi
  ) >/dev/null 2>&1 &
    disown
fi

exit 0
