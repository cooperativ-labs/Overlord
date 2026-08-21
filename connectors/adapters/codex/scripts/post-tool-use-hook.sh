#!/bin/bash
# Overlord Codex PostToolUse hook. Records exact file and shell-mediated changes
# in the per-session touched-files log used by `ovld protocol deliver` for
# concurrent-work attribution. The CLI owns mission resolution and path
# normalization, so this adapter only forwards Codex's native hook payload.

BODY=$(cat -)
HOOK_NAME="codex-post-tool-use"
LOG_DIR="${HOME:-}/.ovld/logs"
LOG_FILE="${LOG_DIR}/codex-post-tool-use-hook.log"

log_hook() {
  mkdir -p "$LOG_DIR" 2>/dev/null || return 0
  printf '%s [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$HOOK_NAME" "$1" >>"$LOG_FILE" 2>/dev/null || true
}

# The stderr redirect below prevents a hook failure from writing into Codex's
# conversation, but Bash resolves it before invoking `ovld`; create the parent
# directory first so first-run installations can still record attribution.
mkdir -p "$LOG_DIR" 2>/dev/null || true

if ! command -v ovld >/dev/null 2>&1; then
  log_hook "ovld not on PATH; skipping"
  exit 0
fi

RESULT=$(printf '%s' "$BODY" | ovld protocol record-touched 2>>"$LOG_FILE")
log_hook "record-touched: ${RESULT:-<no output>}"

exit 0
