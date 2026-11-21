#!/bin/bash
# Overlord Antigravity Stop hook. Managed file — do not edit.
#
# Antigravity runs plugin hooks with the plugin folder as the working directory and the session's
# environment. The payload is camelCase JSON on stdin; the answer is one JSON object on stdout,
# where `{"decision":"continue","reason":…}` keeps the agent going with `reason` as a system
# message and anything else lets it stop.
#
# Order mirrors the Claude Stop hook:
#   1. With a session channel, a pending Overlord instruction continues the turn with it.
#   2. Otherwise the once-per-objective delivery reminder, decided by `ovld protocol hook-event`
#      (it skips a stop that already follows a continuation and one with background work running).
#
# Scope gate first: a session Overlord did not launch exits silently before reading stdin or
# spawning anything. Every failure prints `{}`, which lets the stop happen: the harness's own
# behavior is the floor.
if [ -z "${OVERLORD_MISSION_ID:-}${MISSION_ID:-}${OVERLORD_OBJECTIVE_ID:-}" ]; then
  exit 0
fi
command -v ovld >/dev/null 2>&1 || exit 0

PAYLOAD=$(cat)

if [ -n "${OVERLORD_SESSION_CHANNEL_ID:-}" ]; then
  INJECTED=$(printf '%s' "$PAYLOAD" | ovld agent-session inbox --agent antigravity --payload-file - 2>/dev/null)
  if [ -n "$INJECTED" ]; then
    printf '%s\n' "$INJECTED"
    exit 0
  fi
fi

ANSWER=$(printf '%s' "$PAYLOAD" | ovld protocol hook-event --agent antigravity --hook-type Stop --hook-output --payload-file - 2>/dev/null)
case "$ANSWER" in
  \{*\}) printf '%s\n' "$ANSWER" ;;
  *) printf '{}\n' ;;
esac
exit 0
