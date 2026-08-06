# Session instruction delivery is dead in agent-pod launches

Investigation for coo:611. Reported symptom: an instruction sent into the session for
objective `dfdcb1dd-9b2b-4941-8ac0-5b4f6cb404e2` (mission coo:610) sat in `pending` and the
agent — Claude, launched through `agp` into an agent-pod container — never received it.

## Verdict

Confirmed, reproducible, and not specific to that one instruction. **No agent-session traffic
of any kind can flow in an agent-pod launch**, because the container never receives the
session-channel bootstrap. Instructions are the visible half; permission-request capture and
the normalized activity-event feed are dead in the same way and for the same reason.

## Evidence

**The input was never claimed by anything.** Live record for the reported instruction:

```
GET /api/agent-session-inputs?missionId=7b81a128-922e-4ed9-bff7-bea6ae39289a
  id            f3f29d75-e74f-48f6-ab6f-7722d45d4740
  objectiveId   dfdcb1dd-9b2b-4941-8ac0-5b4f6cb404e2
  body          "Also look for other areas in the code where important ux elements
                 might be hidden by the status bar"
  status        cancelled        (revision 2 — a human cancelled it; nothing expired it)
  attemptCount  0
  emittedAt     null
  liveChannel   { state: "online", lastHeartbeatAt: null, adapterKey: "claude" }
```

`attemptCount: 0` with `emittedAt: null` means `/inputs/claim` was never called for this
channel. The backend enqueue side worked exactly as designed; the adapter side never ran.

**The launch script does export the channel id.** `.overlord/tmp/launch-coo-611-*.sh` (this
mission's own launch, same shape as coo:610's) contains:

```
export MISSION_ID='coo:611'; export OVERLORD_MISSION_ID='coo:611';
export OVERLORD_EXECUTION_REQUEST_ID='aaf2a36e-…';
export OVERLORD_SESSION_CHANNEL_ID='7fe8c8f9-ff8f-4a95-8228-918ed8f042f8';
export OVERLORD_SESSION_LAUNCH_KIND='queued'; export OVERLORD_PROJECT_RESOURCES='[…]';
export AGENT_POD_EXTRA_ALLOWED_PATHS='…';
…; agp 'claude' '--append-system-prompt-file' … 
```

**`agp` forwards almost none of it into the container.** Full environment inside a pod launched
by that script (50 vars). Of everything Overlord exported, only two survive:

| Exported by launch | Present in pod |
| --- | --- |
| `OVERLORD_BACKEND_URL` | yes |
| `AGENT_POD_EXTRA_ALLOWED_PATHS` | consumed by `agp` (paths are mounted), not re-exported |
| `MISSION_ID`, `OVERLORD_MISSION_ID` | **no** |
| `OVERLORD_SESSION_CHANNEL_ID` | **no** |
| `OVERLORD_SESSION_LAUNCH_KIND` | **no** |
| `OVERLORD_EXECUTION_REQUEST_ID` | **no** |
| `OVERLORD_PROJECT_RESOURCES` | **no** |
| `CLAUDE_CODE_MAX_*` (subagent caps from `agentLaunchEnv`) | **no** |

`OVERLORD_USER_TOKEN`, `OVERLORD_DEVICE_FINGERPRINT`, `OVERLORD_DEVICE_LABEL` and the
`AGENT_POD_*` config vars are set by the pod image / `agp` itself, not forwarded from the
launch script. `agp` uses a known-config allowlist, not a prefix passthrough.

**So every agent-session hook exits before doing anything.** All three rendered hook scripts —
`agent-session-inbox.sh`, `agent-session-event.sh`, `agent-session-request.sh` — open with the
pre-spawn scope gate:

```sh
[ -n "${OVERLORD_SESSION_CHANNEL_ID:-}" ] || exit 0
```

In a pod that is always false. The gate is correct in intent (an unbound session must cost
nothing — `cli/src/agent-session/bind.ts`), but its only signal is an environment variable the
container never sees. Claude's `Stop` and `PostToolUse` inbox registrations therefore fire on
every turn and return instantly, having never contacted the backend.

**The credential could not be found even if the id arrived.** `buildLaunchPlan` stages the
channel token with `writeChannelCredential` into the *host's*
`~/.ovld/agent-session-channels/<sha256(channelId)>`. Inside the pod, `resolveGlobalDataDir()`
is `/home/agent-pod/.ovld` (no `agent-session-channels` directory), and the host's `~/.ovld` is
not mounted — only `/Users/jake/.ovld/storage` is. So `resolveChannelBootstrap` would return
`null` on the token half as well. **Both halves of the bootstrap are missing, not one.**

## Why the UI looked healthy

`attachSession` resolves an unbound channel via `findBindableChannelForMission` and calls
`bindChannelToSession`, which flips `preparing → online`. That was added deliberately so the
health card would stop showing "channel starting" for pod sessions — but it makes a channel
that no adapter has ever authenticated against indistinguishable from a live one:

* `SessionChannelHealthCard` renders **nothing at all** for `online`, so there was no warning.
* `enqueueSessionInput` only refuses `ended` / `lost` channels and requires `session_id` — both
  satisfied by the protocol-side bind — so the send succeeded.
* `lastHeartbeatAt: null` is the honest tell, and no surface reads it.
* Nothing in the pod ever calls `endChannel`, so after the agent delivered and exited the
  channel stayed `online` and kept offering "send instruction" until the lease expiry sweep
  (`expireLostChannels`) eventually marks it `lost`.

This is the one place where the current behavior is not just missing plumbing but actively
misleading: the bind was used as a proxy for adapter liveness, and it is not one.

## Fix options

### A. Mint the channel credential inside the pod at attach (recommended)

The pod holds `OVERLORD_USER_TOKEN`, a strictly *broader* credential than a channel token, and
already uses it for every protocol call. Exchanging it for a narrow, channel-scoped credential
at attach time is a downscope, not an escalation, and it has a precedent:
`prepareMissionSessionChannel` already issues a channel credential over ordinary human auth,
authorizing "the person starting an agent for this mission" (`PERMISSIONS.SESSION_ATTACH`).

1. **Backend** — add an adopt/reissue route beside `prepareMissionSessionChannel`
   (`POST /api/missions/:missionRef/session-channel/adopt`, human auth, `SESSION_ATTACH`) that
   rotates the credential of an existing prepared/bound channel for that mission and returns
   `{ channelId, token, expiresAt }` once. Rotation invalidates the host-staged copy, which is
   harmless: nothing on the host is using it in a pod launch.
2. **Attach response** — return the bound `channelId` so the CLI does not have to re-derive it
   from `.overlord/tmp` (`recoverLaunchBootstrapFromProjectTmp` stays as the fallback).
3. **CLI attach** — when `resolveChannelBootstrap()` is `null` but a channel id is known, call
   adopt, then `writeChannelCredential(...)` into the pod's own global data dir and write a
   per-cwd **channel pointer** (id only, never the token) that later hook invocations can find.
4. **`resolveChannelBootstrap`** — add a third source, `'pointer'`: env → pointer file → cache.
5. **Hook scripts** — widen the pre-spawn gate to
   `[ -n "${OVERLORD_SESSION_CHANNEL_ID:-}" ] || [ -f "<pointer path>" ] || exit 0`. It must
   stay a pure shell test with no subprocess so an unbound session is still free and silent.
   The pointer wants a path bash can name without hashing the cwd; `.overlord/tmp/` is the
   consistent home (the launch script already puts the non-secret channel id there), while the
   credential stays outside every checkout as today.

Cost: touches contract, backend, core service, CLI, and all callback adapters (regenerate
`catalog.generated.ts` / codec registries, bump connector version). Benefit: instructions,
permission capture, and the activity feed all start working in pods with no change to `agp`.

### B. Teach `agp` to forward the Overlord launch env

Out of this repo, and incomplete on its own: forwarding `OVERLORD_SESSION_CHANNEL_ID` still
leaves the credential on the host filesystem, so it must be paired with either mounting
`~/.ovld/agent-session-channels` read-only into the pod or exporting the token into the
container environment. It would, as a side benefit, restore `MISSION_ID`, the project-resource
list, and the pinned subagent caps — all of which are also being dropped today.

### C. Honest channel state (do this regardless of A or B)

Independent of how the bootstrap gets in, `online` should mean "an adapter has authenticated on
this channel", not "a protocol attach happened". Options: keep the bind (it is needed for
event correlation) but derive the displayed state from adapter-side evidence
(`last_heartbeat_at` / any channel-credential call), and have `enqueueSessionInput` refuse — or
the composer warn — when a channel has never been touched by its adapter. A user who is told
"this session cannot receive instructions" loses nothing; a user shown a green light and a
`pending` row that never moves loses the instruction.

## Recommendation

Ship **C** first — it is small, self-contained, and converts a silent data-loss path into an
honest refusal. Then **A** as the real fix. **B** is worth doing in `agent-pod` anyway for the
other stripped variables, but should not be the plan of record for channel delivery, because it
puts Overlord's interactive surface at the mercy of an external wrapper's allowlist.
