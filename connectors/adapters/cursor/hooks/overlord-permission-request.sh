#!/bin/bash
# Cursor decision hook. The channel gate is before the `ovld` spawn; a missing channel emits
# no bytes, which means Cursor follows its native ask path. The CLI owns all network traffic.
[ -n "${OVERLORD_SESSION_CHANNEL_ID:-}" ] || exit 0
command -v ovld >/dev/null 2>&1 || exit 0
exec ovld agent-session request --agent cursor --payload-file -
