/* GENERATED FILE — DO NOT EDIT.
 * Source: connectors/adapters/<agent>/harness-capabilities.yaml
 * Regenerate with `yarn connectors:capabilities`.
 *
 * The runtime reads THIS compiled bundle, never the YAML: parsing YAML from disk on a hook
 * path would violate the latency invariant, and the installed adapter may be older than the
 * CLI. `ovld doctor` compares the installed descriptor digest with the digests below.
 *
 * This is the STATIC catalog maximum. Web and mobile must gate controls on the effective
 * capability snapshot stored on the live session channel, which installed harness version,
 * hook trust, connector drift, project policy, and runtime probes may all downgrade.
 */

export const AGENT_SESSION_CAPABILITY_IDS = [
  "observe.prompt",
  "observe.toolCall",
  "observe.toolResult",
  "observe.fileEdit",
  "observe.sessionLifecycle",
  "decide.shell",
  "decide.mcp",
  "decide.fileWrite",
  "decide.anyTool",
  "decide.universal",
  "answer.structuredQuestion",
  "answer.persistentAllow",
  "inject.midTurn",
  "inject.turnBoundary",
  "inject.nextTurn",
  "terminal.concurrentAnswer",
  "terminal.statusSurface"
] as const;

export type AgentSessionCapabilityId = (typeof AGENT_SESSION_CAPABILITY_IDS)[number];

export type AgentSessionCapabilityStatus =
  | 'supported'
  | 'unsupported'
  | 'not-implemented'
  | 'unverified';

export type HarnessIntegrationShape = 'callback' | 'extension' | 'controlPlane';

export type HarnessCapabilityEntry = {
  status: AgentSessionCapabilityStatus;
  native: string | null;
  reason: string | null;
  evidenceRef: string | null;
  trackedAs: string | null;
};

export type HarnessDescriptor = {
  adapter: string;
  codec: string;
  integrationShape: HarnessIntegrationShape;
  capabilityTier: 0 | 1 | 2 | 3;
  descriptorDigest: string;
  descriptorSchemaVersion: number;
  harness: {
    name: string;
    verifiedVersion?: string;
    versionRange?: string;
    versionScheme: 'semver' | 'calendar' | 'opaque';
  };
  binding: {
    source: 'env' | 'payload' | 'api' | 'none';
    field: string | null;
    fallbackField: string | null;
    status: AgentSessionCapabilityStatus;
  };
  decisionHold: {
    status: AgentSessionCapabilityStatus;
    timeoutField: string | null;
    timeoutUnit: 'seconds' | 'milliseconds' | null;
    defaultTimeoutSeconds: number | null;
    maxTimeoutSeconds: number | null;
  };
  capabilities: Record<AgentSessionCapabilityId, HarnessCapabilityEntry>;
  hazards: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high';
    summary: string;
    verification: 'verified' | 'unverified';
    mitigation: 'required' | 'implemented' | 'accepted';
    trackedAs: string | null;
  }>;
  decisionShape: { codec: string; neverSend: string[] } | null;
};

export const HARNESS_CAPABILITY_TIER_NAMES = [
  "Unsupported",
  "Observational",
  "Answerable",
  "Conversational"
] as const;

export const HARNESS_DESCRIPTORS: HarnessDescriptor[] = [
  {
    "adapter": "antigravity",
    "codec": "antigravity",
    "integrationShape": "callback",
    "capabilityTier": 0,
    "descriptorDigest": "e7313b23f98b6ed15a1a32849291a2a391523d4c06403bf395ecbcadfa3b11ac",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "Antigravity CLI",
      "verifiedVersion": "docs: Antigravity CLI v1.1.11 / Antigravity 2.0 v2.6.0",
      "versionScheme": "opaque"
    },
    "binding": {
      "source": "payload",
      "field": "conversationId",
      "fallbackField": null,
      "status": "supported"
    },
    "decisionHold": {
      "status": "unverified",
      "timeoutField": null,
      "timeoutUnit": null,
      "defaultTimeoutSeconds": null,
      "maxTimeoutSeconds": null
    },
    "capabilities": {
      "observe.prompt": {
        "status": "unsupported",
        "native": "PreInvocation",
        "reason": "PreInvocation exposes invocation counters and common metadata but no submitted prompt. Reading transcriptPath to reconstruct one would violate the raw-transcript privacy boundary.",
        "evidenceRef": "https://antigravity.google/docs/hooks#preinvocation",
        "trackedAs": null
      },
      "observe.toolCall": {
        "status": "not-implemented",
        "native": "PreToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "observe.toolResult": {
        "status": "not-implemented",
        "native": "PostToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "observe.fileEdit": {
        "status": "not-implemented",
        "native": "PostToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "observe.sessionLifecycle": {
        "status": "not-implemented",
        "native": "Stop",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "decide.shell": {
        "status": "not-implemented",
        "native": "PreToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "decide.mcp": {
        "status": "unverified",
        "native": null,
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "decide.fileWrite": {
        "status": "not-implemented",
        "native": "PreToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "decide.anyTool": {
        "status": "not-implemented",
        "native": "PreToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "decide.universal": {
        "status": "unverified",
        "native": null,
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "answer.structuredQuestion": {
        "status": "unverified",
        "native": null,
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "answer.persistentAllow": {
        "status": "not-implemented",
        "native": "PreToolUse.permissionOverrides",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "inject.midTurn": {
        "status": "unsupported",
        "native": null,
        "reason": "PreInvocation and PostInvocation can inject only at model-invocation boundaries; the hook surface has no path to deliver input while a model or tool call is actively running.",
        "evidenceRef": "https://antigravity.google/docs/hooks#preinvocation",
        "trackedAs": null
      },
      "inject.turnBoundary": {
        "status": "not-implemented",
        "native": "Stop",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "inject.nextTurn": {
        "status": "not-implemented",
        "native": "PreInvocation.injectSteps.userMessage",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "terminal.concurrentAnswer": {
        "status": "unverified",
        "native": null,
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      },
      "terminal.statusSurface": {
        "status": "unverified",
        "native": null,
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-antigravity"
      }
    },
    "hazards": [
      {
        "id": "outside-verification-survey",
        "severity": "medium",
        "summary": "Antigravity was not part of the original harness verification survey. The current first-party docs now establish hook names, payload fields, and response shapes, but the `agy` binary was unavailable for empirical timeout, failure, resume, and headless tests. The connector must stay at its fixture-proven tier until those paths are exercised.",
        "verification": "unverified",
        "mitigation": "required",
        "trackedAs": "agent-session-verify-antigravity"
      },
      {
        "id": "pre-tool-use-always-allows",
        "severity": "medium",
        "summary": "The former PreToolUse hook answered `{\"allow_tool\":true}` even though the first-party response contract requires `decision`, and called a nonexistent detached protocol command. It neither gated nor recorded reliably; changing it to native `decision: allow` would have silently bypassed the harness permission system, so the registration was removed.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "pre-invocation-has-no-prompt",
        "severity": "high",
        "summary": "The former follow-up hook guessed prompt/message/text/input fields on PreInvocation, but the first-party schema contains none of them. It could never capture a normal follow-up; reconstructing one from transcriptPath would violate the raw-transcript privacy boundary. The false followUpHook projection and the registration were removed.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      }
    ],
    "decisionShape": {
      "codec": "antigravity",
      "neverSend": [
        "allow_tool",
        "hookSpecificOutput",
        "permissionDecision",
        "permission"
      ]
    }
  },
  {
    "adapter": "claude",
    "codec": "claude",
    "integrationShape": "callback",
    "capabilityTier": 1,
    "descriptorDigest": "833a35cecb73aa9b34b40036eb6d3088dd729ca6be465d1ee228dae2c5a8269d",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "Claude Code",
      "verifiedVersion": "2.1.227",
      "versionRange": ">=2.1.0",
      "versionScheme": "semver"
    },
    "binding": {
      "source": "payload",
      "field": "session_id",
      "fallbackField": null,
      "status": "supported"
    },
    "decisionHold": {
      "status": "supported",
      "timeoutField": "timeout",
      "timeoutUnit": "seconds",
      "defaultTimeoutSeconds": null,
      "maxTimeoutSeconds": null
    },
    "capabilities": {
      "observe.prompt": {
        "status": "supported",
        "native": "UserPromptSubmit",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.toolCall": {
        "status": "not-implemented",
        "native": "PreToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      },
      "observe.toolResult": {
        "status": "not-implemented",
        "native": "PostToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "observe.fileEdit": {
        "status": "supported",
        "native": "PostToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.sessionLifecycle": {
        "status": "not-implemented",
        "native": "SessionStart",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.shell": {
        "status": "not-implemented",
        "native": "PermissionRequest",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.mcp": {
        "status": "not-implemented",
        "native": "PermissionRequest",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.fileWrite": {
        "status": "not-implemented",
        "native": "PermissionRequest",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.anyTool": {
        "status": "not-implemented",
        "native": "PreToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.universal": {
        "status": "not-implemented",
        "native": "PermissionRequest",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "answer.structuredQuestion": {
        "status": "unverified",
        "native": "Elicitation",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-verify-claude-elicitation"
      },
      "answer.persistentAllow": {
        "status": "not-implemented",
        "native": "PermissionRequest.decision.updatedPermissions",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-standing-permissions"
      },
      "inject.midTurn": {
        "status": "not-implemented",
        "native": "asyncRewake",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "inject.turnBoundary": {
        "status": "not-implemented",
        "native": "Stop",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "inject.nextTurn": {
        "status": "not-implemented",
        "native": "Stop",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-4"
      },
      "terminal.concurrentAnswer": {
        "status": "unsupported",
        "native": null,
        "reason": "The native permission prompt is drawn only after the hook returns, so nobody can answer in the terminal while Overlord holds the decision. Holding is simultaneously the only way to answer remotely and the reason the terminal cannot participate.",
        "evidenceRef": "connector-harness-taxonomy.md#12-the-axis-that-actually-matters",
        "trackedAs": null
      },
      "terminal.statusSurface": {
        "status": "not-implemented",
        "native": "statusMessage",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      }
    },
    "hazards": [
      {
        "id": "shipped-permission-hook-inert",
        "severity": "high",
        "summary": "The installed PermissionRequest hook calls a `ovld protocol permission-request` subcommand that does not exist, backgrounds the call with `) & disown`, and is gated on a MISSION_ID environment variable launched sessions do not always set. It records nothing and, being backgrounded with stdout discarded, is structurally incapable of returning a decision. The shipped conformance `permissionHook` flag therefore overstates what happens today.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "shipped-stop-hook-inert",
        "severity": "medium",
        "summary": "The installed Stop hook calls `ovld protocol hook-event --hook-type Stop`, which the CLI rejects, and then parses a `deliveryStatus` field nothing produces. Confirmed again at 2.1.221 from a live agent-pod session: every entry in ~/.ovld/logs/stop-hook.log takes the `no launch mission id` branch and returns before the delivery check, because the hook gates on a `MISSION_ID` environment variable the pod does not set. The PostToolUse hook works in the same session because it resolves the mission from the per-cwd active-session manifest instead; the Stop hook should resolve it the same way.",
        "verification": "verified",
        "mitigation": "required",
        "trackedAs": "agent-session-phase-3"
      },
      {
        "id": "unbound-session-side-effects",
        "severity": "medium",
        "summary": "NARROWED, NOT CLOSED. The new agent-session registrations gate in bash on OVERLORD_SESSION_CHANNEL_ID before spawning anything, so they are completely silent in an unbound session (proved by fixtures/agent-session-hook-unbound.json). The LEGACY PostToolUse hook still spawns `ovld protocol record-touched` and appends to ~/.ovld/logs in every session on the machine, because its scope gate lives inside the CLI rather than before the spawn (proved by fixtures/unbound-session.json). It stays installed on purpose: it is what feeds touched-file change attribution at deliver time, and removing it before the normalized path has demonstrated equivalent attribution would trade a privacy nit for a data-loss bug. Closing this means retiring the legacy hook, which is a migration, not a patch.",
        "verification": "verified",
        "mitigation": "required",
        "trackedAs": "agent-session-phase-4"
      },
      {
        "id": "fork-and-subagent-identity-unknown",
        "severity": "medium",
        "summary": "Whether an in-process fork mints a new native session id, and whether subagent tool calls carry the parent's id, are both unverified. Guessing either routes a session's requests to the wrong mission. Partially narrowed at 2.1.221: the binary carries distinct `SubagentStart` and `SubagentStop` hook events, converts an agent-frontmatter `Stop` registration into `SubagentStop` (\"subagents trigger SubagentStop\"), and records `parent_session_id` and `agent_type` as separate fields from `session_id`. That the harness distinguishes the two identities is now established; which value lands in a subagent hook payload's `session_id` is still not, and that is the part binding depends on. Read it from a real subagent payload before changing any binding code.",
        "verification": "unverified",
        "mitigation": "required",
        "trackedAs": "taxonomy-7.6"
      },
      {
        "id": "subagent-stop-unregistered",
        "severity": "medium",
        "summary": "The adapter registers `Stop` and no subagent-lifecycle event. Claude Code 2.1.221 fires `SubagentStop` — not `Stop` — when a subagent finishes, and subagents now run in the background past the parent's turn boundary. Version 2.1.224 also removed the 200-subagent-per-session spawn cap, increasing the frequency of this gap, so the shipped Stop registration is guaranteed not to run for work a subagent completes after the parent stopped. Nothing is lost today because that registration is already inert (see `shipped-stop-hook-inert`), which is exactly why the fix is to repair the Stop path first and only then decide whether the repaired body should also ride `SubagentStop`. Registering the current inert script on a second event would add a spawn per subagent completion and buy nothing.",
        "verification": "verified",
        "mitigation": "required",
        "trackedAs": "coo:585"
      },
      {
        "id": "subagent-commits-escape-delivery-delta",
        "severity": "high",
        "summary": "Delivery change attribution is computed from `git status --porcelain` against the attach baseline (cli/src/vcs.ts `readChangedFiles` / `filterRunAttributableChanges`); nothing in that path consults HEAD or the commit graph. Claude Code 2.1.221 made background-session commit-and-push behavior an explicit work-preservation default. A background subagent that commits, merges, or opens a PR for its own work therefore removes those files from the worktree delta, and they vanish from the delivery report entirely — not flagged, not skipped, silently absent. The PostToolUse touched-files log is unaffected (its key is `sha256(abspath(cwd) + \"\\0\" + MISSION_ID)`, so a subagent sharing the cwd writes to the same log), which means the evidence that the edit happened survives while the delta that decides coverage does not. Closing this means teaching the delta about commits made since the baseline, which is a CLI change with branch and worktree semantics to settle, not a hook edit.",
        "verification": "verified",
        "mitigation": "required",
        "trackedAs": "coo:585"
      }
    ],
    "decisionShape": {
      "codec": "claude",
      "neverSend": [
        "permission",
        "user_message",
        "agent_message",
        "followup_message"
      ]
    }
  },
  {
    "adapter": "codex",
    "codec": "codex",
    "integrationShape": "callback",
    "capabilityTier": 1,
    "descriptorDigest": "e0d536667a5616d1a662c7225fc8ef439b5d7cdce1d6703e577190c9e5c6d9c5",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "Codex CLI",
      "verifiedVersion": "0.147.0",
      "versionRange": ">=0.124.0",
      "versionScheme": "semver"
    },
    "binding": {
      "source": "payload",
      "field": "session_id",
      "fallbackField": null,
      "status": "supported"
    },
    "decisionHold": {
      "status": "supported",
      "timeoutField": "timeout",
      "timeoutUnit": "seconds",
      "defaultTimeoutSeconds": 600,
      "maxTimeoutSeconds": null
    },
    "capabilities": {
      "observe.prompt": {
        "status": "supported",
        "native": "UserPromptSubmit",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.toolCall": {
        "status": "not-implemented",
        "native": "PreToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "observe.toolResult": {
        "status": "not-implemented",
        "native": "PostToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "observe.fileEdit": {
        "status": "not-implemented",
        "native": "PostToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "observe.sessionLifecycle": {
        "status": "not-implemented",
        "native": "SessionStart",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.shell": {
        "status": "not-implemented",
        "native": "PermissionRequest",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.mcp": {
        "status": "not-implemented",
        "native": "PermissionRequest",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.fileWrite": {
        "status": "not-implemented",
        "native": "PermissionRequest",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.anyTool": {
        "status": "not-implemented",
        "native": "PreToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-4"
      },
      "decide.universal": {
        "status": "not-implemented",
        "native": "PermissionRequest",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "answer.structuredQuestion": {
        "status": "unverified",
        "native": "ToolRequestUserInput",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "taxonomy-7.2"
      },
      "answer.persistentAllow": {
        "status": "unverified",
        "native": null,
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "taxonomy-7.4"
      },
      "inject.midTurn": {
        "status": "unverified",
        "native": "ThreadInjectItems",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "taxonomy-7.2"
      },
      "inject.turnBoundary": {
        "status": "not-implemented",
        "native": "Stop",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "inject.nextTurn": {
        "status": "not-implemented",
        "native": "Stop",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-4"
      },
      "terminal.concurrentAnswer": {
        "status": "unsupported",
        "native": null,
        "reason": "On the hook path the native prompt is drawn only after the callback returns, so the terminal cannot answer while Overlord holds the decision. (A future app-server integration could change this; it would be a different integrationShape.)",
        "evidenceRef": "connector-harness-taxonomy.md#12-the-axis-that-actually-matters",
        "trackedAs": null
      },
      "terminal.statusSurface": {
        "status": "unverified",
        "native": null,
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "taxonomy-7.9"
      }
    },
    "hazards": [
      {
        "id": "two-integration-surfaces-could-disagree",
        "severity": "high",
        "summary": "Hooks and `codex app-server` can both answer a permission. A session driven by both would race in a way no revision CAS can settle, so exactly one surface must be chosen and documented before either is built.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "shipped-permission-hook-inert",
        "severity": "high",
        "summary": "The former PermissionRequest hook called a nonexistent protocol command in the background. The connector no longer registers a PermissionRequest hook; the native prompt owns approvals when Latch is absent.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "prompt-and-agent-hook-handlers-inert",
        "severity": "low",
        "summary": "Codex 0.146.0 accepts three hook handler types — `command`, `prompt`, and `agent` — but only `command` runs. Hook discovery parses `prompt` and `agent` and then skips them with a \"not supported yet\" warning, so a manifest that used either would install cleanly, list in `hooks`, and never execute. The connector must keep emitting `command` handlers only, and must not read the presence of these variants in the schema as availability. `command` is a shell command line run through `$SHELL -lc` (`/bin/sh` when SHELL is unset) — it is not restricted to Bash and not restricted to shell scripting, since the command may invoke any interpreter.",
        "verification": "verified",
        "mitigation": "accepted",
        "trackedAs": null
      },
      {
        "id": "hooks-version-and-platform-gate",
        "severity": "medium",
        "summary": "Hooks were experimental behind `features.codex_hooks` before v0.124. The connector requires Codex >=0.124; installations outside that range must be treated as unavailable.",
        "verification": "verified",
        "mitigation": "required",
        "trackedAs": "agent-session-phase-4"
      }
    ],
    "decisionShape": {
      "codec": "codex",
      "neverSend": [
        "updatedInput",
        "updatedPermissions",
        "interrupt",
        "permission",
        "followup_message"
      ]
    }
  },
  {
    "adapter": "cursor",
    "codec": "cursor",
    "integrationShape": "callback",
    "capabilityTier": 1,
    "descriptorDigest": "7085c25291f5c96cf3c7fb9c280281fa698b5c026e9859377ad8c53d1cd82537",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "Cursor Agent CLI",
      "verifiedVersion": "2026.08.04-aaa8809",
      "versionRange": ">=2026.07.01",
      "versionScheme": "calendar"
    },
    "binding": {
      "source": "payload",
      "field": "conversation_id",
      "fallbackField": "session_id",
      "status": "supported"
    },
    "decisionHold": {
      "status": "supported",
      "timeoutField": "timeout",
      "timeoutUnit": "seconds",
      "defaultTimeoutSeconds": 60,
      "maxTimeoutSeconds": null
    },
    "capabilities": {
      "observe.prompt": {
        "status": "supported",
        "native": "beforeSubmitPrompt",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.toolCall": {
        "status": "not-implemented",
        "native": "preToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "observe.toolResult": {
        "status": "supported",
        "native": "postToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.fileEdit": {
        "status": "supported",
        "native": "postToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.sessionLifecycle": {
        "status": "not-implemented",
        "native": "sessionStart",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-1"
      },
      "decide.shell": {
        "status": "not-implemented",
        "native": "beforeShellExecution",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.mcp": {
        "status": "not-implemented",
        "native": "beforeMCPExecution",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.fileWrite": {
        "status": "not-implemented",
        "native": "preToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      },
      "decide.anyTool": {
        "status": "not-implemented",
        "native": "preToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.universal": {
        "status": "unsupported",
        "native": null,
        "reason": "There is no single event covering every approval. Cursor's own Claude-compatibility map resolves `PermissionRequest` to null and lists it as unsupported; coverage is per tool class (shell, MCP, file read, generic pre-tool), so some approvals will never reach Overlord and the UI must not imply otherwise.",
        "evidenceRef": "connector-harness-taxonomy.md#42-what-is-verified",
        "trackedAs": null
      },
      "answer.structuredQuestion": {
        "status": "unsupported",
        "native": null,
        "reason": "No hook step returns a structured question with options; the decision surfaces return only allow/deny/ask plus free-text user/agent messages.",
        "evidenceRef": "connector-harness-taxonomy.md#42-what-is-verified",
        "trackedAs": null
      },
      "answer.persistentAllow": {
        "status": "unsupported",
        "native": null,
        "reason": "Hook responses are per-call; there is no \"always\" reply that persists a rule.",
        "evidenceRef": "connector-harness-taxonomy.md#42-what-is-verified",
        "trackedAs": null
      },
      "inject.midTurn": {
        "status": "unsupported",
        "native": null,
        "reason": "No mechanism exists to insert a message into a running turn.",
        "evidenceRef": "connector-harness-taxonomy.md#43-unique-challenges",
        "trackedAs": null
      },
      "inject.turnBoundary": {
        "status": "supported",
        "native": "stop",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "inject.nextTurn": {
        "status": "supported",
        "native": "stop",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "terminal.concurrentAnswer": {
        "status": "unsupported",
        "native": null,
        "reason": "The native prompt is drawn only after the hook returns, so nobody can answer locally while Overlord holds the decision.",
        "evidenceRef": "connector-harness-taxonomy.md#12-the-axis-that-actually-matters",
        "trackedAs": null
      },
      "terminal.statusSurface": {
        "status": "unverified",
        "native": null,
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "taxonomy-7.9"
      }
    },
    "hazards": [
      {
        "id": "false-permission-hook-claim",
        "severity": "high",
        "summary": "The shipped conformance manifest declared the `permissionHook` capability and a `PermissionRequest` hook type. Cursor maps that event to null and lists it as unsupported, so the declaration was false and would render remote controls that can never fire. Corrected in this descriptor and in the generated legacy projection.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "reads-claude-hook-config",
        "severity": "high",
        "summary": "Cursor resolves hooks from Claude's own project-local, project, and user configuration in addition to its own. If plugin-provided hooks are expanded, Overlord's Claude hooks may fire inside Cursor sessions and emit Claude-shaped decisions into a Cursor-shaped contract — cross-connector misattribution with no code change on our side.",
        "verification": "unverified",
        "mitigation": "required",
        "trackedAs": "taxonomy-7.1"
      },
      {
        "id": "allowlist-precedence",
        "severity": "medium",
        "summary": "Reported upstream that beforeShellExecution allow/ask is ignored when a command allowlist entry matches. A remote approval may be a no-op, so \"we returned allow\" is not proof the decision was decisive.",
        "verification": "unverified",
        "mitigation": "required",
        "trackedAs": "taxonomy-7.8"
      },
      {
        "id": "fail-closed-inverts-fallback",
        "severity": "high",
        "summary": "Cursor's per-script `failClosed` converts a hook failure into a block, inverting the core's fail-toward-the-harness rule. Overlord's hook registration must never set it.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "post-tool-use-log-dir-precondition",
        "severity": "medium",
        "summary": "The shipped postToolUse hook redirects stderr into ~/.ovld/logs without creating that directory first (Claude's equivalent does). On a machine where the directory does not yet exist the redirect fails and `ovld protocol record-touched` is never invoked, so touched-file attribution silently records nothing for that session. Fixed in phase 0B by creating the directory before the redirect, matching Claude's hook; the fixture guards the hook against losing that line again.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      }
    ],
    "decisionShape": {
      "codec": "cursor",
      "neverSend": [
        "hookSpecificOutput",
        "permissionDecision",
        "decision"
      ]
    }
  },
  {
    "adapter": "opencode",
    "codec": "opencode",
    "integrationShape": "controlPlane",
    "capabilityTier": 3,
    "descriptorDigest": "83f146f0c4be8764608401886f374ebfc7bbe5dca8fcdecf3856a99030f778e6",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "OpenCode",
      "versionScheme": "semver",
      "versionRange": ">=0.5.0"
    },
    "binding": {
      "source": "env",
      "field": "OVERLORD_SESSION_CHANNEL_ID",
      "fallbackField": null,
      "status": "supported"
    },
    "decisionHold": {
      "status": "supported",
      "timeoutField": null,
      "timeoutUnit": null,
      "defaultTimeoutSeconds": null,
      "maxTimeoutSeconds": null
    },
    "capabilities": {
      "observe.prompt": {
        "status": "not-implemented",
        "native": "message.updated",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-3"
      },
      "observe.toolCall": {
        "status": "not-implemented",
        "native": "message.part.updated",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      },
      "observe.toolResult": {
        "status": "supported",
        "native": "message.part.updated",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.fileEdit": {
        "status": "supported",
        "native": "message.part.updated",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.sessionLifecycle": {
        "status": "supported",
        "native": "session.idle",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "decide.shell": {
        "status": "supported",
        "native": "/permission",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "decide.mcp": {
        "status": "supported",
        "native": "/permission",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "decide.fileWrite": {
        "status": "not-implemented",
        "native": "/permission",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      },
      "decide.anyTool": {
        "status": "supported",
        "native": "/permission",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "decide.universal": {
        "status": "not-implemented",
        "native": "/permission",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      },
      "answer.structuredQuestion": {
        "status": "not-implemented",
        "native": "/question",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      },
      "answer.persistentAllow": {
        "status": "not-implemented",
        "native": "POST /permission/{id}/reply (always)",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      },
      "inject.midTurn": {
        "status": "supported",
        "native": "prompt_async",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "inject.turnBoundary": {
        "status": "supported",
        "native": "prompt_async",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "inject.nextTurn": {
        "status": "supported",
        "native": "prompt_async",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "terminal.concurrentAnswer": {
        "status": "supported",
        "native": "GET /permission",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "terminal.statusSurface": {
        "status": "not-implemented",
        "native": null,
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      }
    },
    "hazards": [
      {
        "id": "control-port-is-unauthenticated-by-default",
        "severity": "high",
        "summary": "OpenCode's server accepts commands that drive the agent — running tools, sending prompts — and binds without authentication unless configured otherwise. Anything that can reach the port owns the session. The sidecar therefore binds loopback only, generates a per-launch OPENCODE_SERVER_PASSWORD, and never projects either the port or the secret to the browser or mobile clients, which reach Overlord's own authenticated surface instead.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "replay-on-reconnect",
        "severity": "low",
        "summary": "A reconnecting sidecar re-reads state and re-emits frames it may already have sent. This is not mitigated by suppressing the replay — a sidecar cannot know what its predecessor delivered — but by content-derived producer event ids, so a replayed frame is a no-op at the server rather than a second row in the feed.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "harness-version-unverified",
        "severity": "medium",
        "summary": "The recorded event payloads were taken from the documented `/event` schema rather than from a running binary of a pinned version, so `harness.verifiedVersion` is absent. Frame shapes may differ in a released build. Record payloads from a real session and pin the version before grading anything else here as supported.",
        "verification": "unverified",
        "mitigation": "required",
        "trackedAs": "agent-session-verify-opencode-frames"
      }
    ],
    "decisionShape": {
      "codec": "opencode",
      "neverSend": [
        "hookSpecificOutput",
        "permissionDecision",
        "decision",
        "permission"
      ]
    }
  },
  {
    "adapter": "pi",
    "codec": "pi",
    "integrationShape": "extension",
    "capabilityTier": 1,
    "descriptorDigest": "d083b9610578e1af2e73b273d0661430213fbbe5ff24550e8f0815c284733ae1",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "Pi Coding Agent",
      "verifiedVersion": "0.83.0",
      "versionRange": ">=0.83.0 <0.84.0",
      "versionScheme": "semver"
    },
    "binding": {
      "source": "api",
      "field": "ctx.sessionManager.getSessionId()",
      "fallbackField": null,
      "status": "supported"
    },
    "decisionHold": {
      "status": "not-implemented",
      "timeoutField": null,
      "timeoutUnit": null,
      "defaultTimeoutSeconds": null,
      "maxTimeoutSeconds": null
    },
    "capabilities": {
      "observe.prompt": {
        "status": "supported",
        "native": "input",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.toolCall": {
        "status": "not-implemented",
        "native": "tool_call",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "observe.toolResult": {
        "status": "not-implemented",
        "native": "tool_result",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-4"
      },
      "observe.fileEdit": {
        "status": "not-implemented",
        "native": "tool_execution_end",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-4"
      },
      "observe.sessionLifecycle": {
        "status": "not-implemented",
        "native": "agent_start",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.shell": {
        "status": "not-implemented",
        "native": "tool_call",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.mcp": {
        "status": "not-implemented",
        "native": "tool_call",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.fileWrite": {
        "status": "not-implemented",
        "native": "tool_call",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.anyTool": {
        "status": "not-implemented",
        "native": "tool_call",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "decide.universal": {
        "status": "not-implemented",
        "native": "tool_call",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "answer.structuredQuestion": {
        "status": "not-implemented",
        "native": "ctx.ui.select",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-4"
      },
      "answer.persistentAllow": {
        "status": "unsupported",
        "native": null,
        "reason": "Pi has no native permission model, so there is no standing allow rule for a reply to write. A persistent grant would have to be invented by Overlord rather than recorded in the harness, which is a different feature with its own audit and RBAC review.",
        "evidenceRef": "connector-harness-taxonomy.md#52-what-is-verified",
        "trackedAs": null
      },
      "inject.midTurn": {
        "status": "not-implemented",
        "native": "sendUserMessage(deliverAs=steer)",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "inject.turnBoundary": {
        "status": "not-implemented",
        "native": "sendUserMessage(deliverAs=followUp)",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
      },
      "inject.nextTurn": {
        "status": "not-implemented",
        "native": "sendMessage(deliverAs=nextTurn)",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-4"
      },
      "terminal.concurrentAnswer": {
        "status": "unsupported",
        "native": null,
        "reason": "There is no native permission prompt for a human to answer concurrently. This is not a timing limitation like the callback harnesses have; the surface does not exist.",
        "evidenceRef": "connector-harness-taxonomy.md#53-unique-challenges",
        "trackedAs": null
      },
      "terminal.statusSurface": {
        "status": "not-implemented",
        "native": "ctx.ui.notify",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-4"
      }
    },
    "hazards": [
      {
        "id": "no-native-floor-fails-open",
        "severity": "high",
        "summary": "Pi has no dialog to fall back to, so a timed-out or failed remote decision must ALLOW the tool. Every other adapter fails toward a human; this one fails toward execution. Remote decisions stay off by default and require a workspace-policy ceiling plus project opt-in whose consent text names the fail-open timeout.",
        "verification": "verified",
        "mitigation": "accepted",
        "trackedAs": null
      },
      {
        "id": "block-is-visible-to-the-model",
        "severity": "medium",
        "summary": "A block becomes a tool refusal in the conversation and changes what the agent does next, so `block` must never be used as a \"please wait\" mechanism. The wait happens inside the async handler, before returning.",
        "verification": "verified",
        "mitigation": "accepted",
        "trackedAs": null
      },
      {
        "id": "in-process-blast-radius",
        "severity": "high",
        "summary": "The extension runs with the agent's memory, credentials, and event loop. An unhandled exception is a crash in someone's editor. It must hold no token, make no HTTP call, and catch everything — all network work goes through the CLI.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "typed-api-version-coupling",
        "severity": "medium",
        "summary": "The extension is typed against @earendil-works/pi-coding-agent 0.83.0. A typed in-process API is far more breakable than JSON on stdin, so the adapter needs a version check and a graceful \"extension disabled, mission workflow unaffected\" path.",
        "verification": "unverified",
        "mitigation": "required",
        "trackedAs": "taxonomy-7.10"
      }
    ],
    "decisionShape": {
      "codec": "pi",
      "neverSend": [
        "hookSpecificOutput",
        "permissionDecision",
        "permission"
      ]
    }
  }
];

export const HARNESS_CATALOG_DIGEST = '02e9a482ed735c5bfac6d8999818f6412362dd61260eed5c87aed9b1cd6cf545';

export function findHarnessDescriptor(adapter: string): HarnessDescriptor | undefined {
  return HARNESS_DESCRIPTORS.find(entry => entry.adapter === adapter);
}
