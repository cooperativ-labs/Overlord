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
  PAYLOAD=$(printf '%s' "$BODY" | python3 -c "
import base64
import json
import os
import re
import sys
import tempfile
from pathlib import Path

UUID_RE = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I)


def detect_codex_session_id_from_disk():
    # Codex does not reliably export CODEX_THREAD_ID/CODEX_SESSION_ID, so fall
    # back to the active rollout file under ~/.codex/sessions. Prefer the most
    # recent rollout whose recorded cwd matches ours.
    try:
        sessions_dir = Path.home() / '.codex' / 'sessions'
        if not sessions_dir.is_dir():
            return None
        cwd = os.getcwd()
        candidates = []
        for entry in sessions_dir.rglob('rollout-*.jsonl'):
            try:
                candidates.append((entry.stat().st_mtime, entry))
            except OSError:
                continue
            if len(candidates) > 1000:
                break
        if not candidates:
            return None
        candidates.sort(key=lambda item: item[0], reverse=True)
        fallback_id = None
        for _, entry in candidates[:25]:
            meta_id = None
            meta_cwd = None
            try:
                with entry.open('r', encoding='utf-8', errors='replace') as handle:
                    first_line = handle.readline()
                obj = json.loads(first_line)
                meta = obj.get('payload') if isinstance(obj.get('payload'), dict) else obj
                if isinstance(meta, dict):
                    raw_id = meta.get('id')
                    if isinstance(raw_id, str):
                        match = UUID_RE.search(raw_id)
                        meta_id = match.group(0) if match else None
                    if isinstance(meta.get('cwd'), str):
                        meta_cwd = meta.get('cwd')
            except Exception:
                meta_id = None
            if not meta_id:
                match = UUID_RE.search(entry.name)
                meta_id = match.group(0) if match else None
            if not meta_id:
                continue
            if fallback_id is None:
                fallback_id = meta_id
            if meta_cwd and meta_cwd == cwd:
                return meta_id
        return fallback_id
    except Exception:
        return None


body = json.load(sys.stdin)
external_session_id = (
    os.environ.get('CODEX_THREAD_ID')
    or os.environ.get('CODEX_SESSION_ID')
    or detect_codex_session_id_from_disk()
    or None
)
session_key = os.environ.get('SESSION_KEY') or ''

if not session_key:
    encoded = base64.urlsafe_b64encode(os.getcwd().encode()).decode().rstrip('=')
    session_file = Path(tempfile.gettempdir()) / f'.overlord-session-{encoded}'
    try:
        persisted = json.loads(session_file.read_text(encoding='utf-8'))
        if persisted.get('ticketId') == os.environ.get('TICKET_ID'):
            session_key = persisted.get('sessionKey') or ''
    except Exception:
        session_key = ''

payload = {
    'hookType': 'UserPromptSubmit',
    'ticketId': os.environ['TICKET_ID'],
    'prompt': body.get('prompt', ''),
    'turnIndex': body.get('turn_number', 0),
}
if external_session_id:
    payload['externalSessionId'] = external_session_id
if session_key:
    payload['sessionKey'] = session_key
print(json.dumps(payload))
" 2>/dev/null || echo '')
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
