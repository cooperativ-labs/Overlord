#!/bin/bash
# Overlord UserPromptSubmit hook — fires before Codex processes each user turn.

BODY=$(cat -)
OVERLORD_BASE_URL="${OVERLORD_URL:-}"
OVERLORD_TOKEN="${OVERLORD_ACCESS_TOKEN:-}"
OVERLORD_LOCAL_SECRET="${OVERLORD_LOCAL_SECRET:-}"
HOOK_NAME="codex"
LOG_DIR="${HOME:-}/.ovld/logs"
LOG_FILE="${LOG_DIR}/user-prompt-submit-hook.log"

log_hook() {
  mkdir -p "$LOG_DIR" 2>/dev/null || return 0
  printf '%s [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$HOOK_NAME" "$1" >>"$LOG_FILE" 2>/dev/null || true
}

TURN=$(printf '%s' "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('turn_number', 0))" 2>/dev/null || echo "0")
PROMPT_LEN=$(printf '%s' "$BODY" | python3 -c "import json,sys; print(len((json.load(sys.stdin).get('prompt') or '').strip()))" 2>/dev/null || echo "0")
log_hook "received submit turn=$TURN prompt_len=$PROMPT_LEN ticket_present=$([ -n "${TICKET_ID:-}" ] && echo yes || echo no)"
if [ "$TURN" = "0" ]; then
  log_hook "skipping initial submit turn=0"
  exit 0
fi

if [ -z "$OVERLORD_BASE_URL" ] || [ -z "$OVERLORD_TOKEN" ] || [ -z "${TICKET_ID:-}" ]; then
  log_hook "missing required env base_url=$([ -n "$OVERLORD_BASE_URL" ] && echo yes || echo no) token=$([ -n "$OVERLORD_TOKEN" ] && echo yes || echo no) ticket=$([ -n "${TICKET_ID:-}" ] && echo yes || echo no)"
  exit 0
fi

if [ -n "$OVERLORD_BASE_URL" ] && [ -n "$OVERLORD_TOKEN" ] && [ -n "$TICKET_ID" ]; then
  PAYLOAD=$(printf '%s' "$BODY" | python3 -c "import json,sys; body=json.load(sys.stdin); print(json.dumps({'hookType': 'UserPromptSubmit', 'ticketId': __import__('os').environ['TICKET_ID'], 'prompt': body.get('prompt', ''), 'turnIndex': body.get('turn_number', 0)}))" 2>/dev/null || echo '')
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
