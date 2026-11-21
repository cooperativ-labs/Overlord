#!/bin/bash
# Overlord Antigravity PreInvocation hook. Managed file — do not edit.
#
# PreInvocation runs before every model call and carries the latest user message as
# `lastUserInput`. `ovld protocol hook-event` records it as a mission follow-up once per distinct
# prompt (the same prompt repeats on every invocation of a turn) and skips the launch prompt.
# With a session channel, a pending Overlord instruction is then injected as a `userMessage`
# step before the model call.
#
# Scope gate first: a session Overlord did not launch exits silently before reading stdin or
# spawning anything. The answer is always a JSON object; `{}` proceeds unchanged. Nothing here
# can terminate the invocation.
if [ -z "${OVERLORD_MISSION_ID:-}${MISSION_ID:-}${OVERLORD_OBJECTIVE_ID:-}" ]; then
  exit 0
fi
command -v ovld >/dev/null 2>&1 || exit 0

PAYLOAD=$(cat)

printf '%s' "$PAYLOAD" | ovld protocol hook-event --agent antigravity --hook-type UserPromptSubmit --hook-output --payload-file - >/dev/null 2>&1

if [ -n "${OVERLORD_SESSION_CHANNEL_ID:-}" ]; then
  INJECTED=$(printf '%s' "$PAYLOAD" | ovld agent-session inbox --agent antigravity --payload-file - 2>/dev/null)
  case "$INJECTED" in
    \{*\}) printf '%s\n' "$INJECTED"; exit 0 ;;
  esac
fi

printf '{}\n'
exit 0
