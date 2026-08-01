#!/bin/bash
# Overlord agent-session hook. Managed file — do not edit.
#
# Written once here and rendered per adapter at `ovld agent-setup` time with the adapter key
# and a FIXED action substituted, following the `overlord-mcp.mjs` precedent.
#
# Three properties are deliberate:
#
#   1. **The action is fixed at render time, not chosen at run time.** There is no `$1`
#      dispatch and no per-adapter shell state machine, so untrusted payload data can never
#      select which CLI operation runs. A `PostToolUse` registration renders an `event`
#      script; a permission registration renders a `request` script; neither can become the
#      other.
#
#   2. **The payload streams from stdin.** Not through a shell variable, which would impose a
#      size limit and mangle NUL bytes, and not through argv, which is world-readable.
#
#   3. **Silence is the failure mode.** A missing `ovld` exits 0 with no output at all, which
#      for a decision hook means "no decision" and therefore the harness's own prompt. Every
#      failure-to-decide path inside the CLI does the same. The harness's own behavior is the
#      floor, and no failure here may manufacture an approval.
#
# For the `request` action, stdout and exit status pass through unchanged so the native
# decision actually reaches the harness in its exact expected shape.
#
#   4. **The scope gate runs before the spawn, not inside it.** The connector interaction core
#      requires that an unbound session — someone's own agent in an unrelated directory on a
#      machine that happens to have Overlord installed — produce no subprocess, no log, and no
#      measurable delay. A gate that lives inside the CLI cannot deliver that, because reaching
#      it already cost a process launch. `OVERLORD_SESSION_CHANNEL_ID` is present only in a
#      session Overlord launched or bound, so one parameter expansion answers the question for
#      free. This is the same gate `cli/src/agent-session/bind.ts` applies; it is duplicated
#      here deliberately, because the only version that can prevent the spawn is the one that
#      runs before it.
[ -n "${OVERLORD_SESSION_CHANNEL_ID:-}" ] || exit 0
command -v ovld >/dev/null 2>&1 || exit 0
exec ovld agent-session __OVERLORD_SESSION_ACTION__ --agent __OVERLORD_ADAPTER_KEY__ --payload-file -
