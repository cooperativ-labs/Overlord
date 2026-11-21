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

export type MutationHookClassification = 'paired' | 'post-only' | 'unsupported';

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
  mutationHooks: {
    classification: MutationHookClassification;
    pathEvidenceSource: 'declared_edit' | 'unavailable';
    pathEvidenceQuality: 'direct' | 'unavailable';
    shellEvidence: 'unavailable';
    pathlessEvidence: 'unavailable';
    fixture: string;
    reason: string | null;
    evidenceRef: string | null;
    notes: string | null;
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
    "capabilityTier": 1,
    "descriptorDigest": "c99353d29093e78117e61a930e091a5bdba53952a29c578cad8c113b397a1474",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "Antigravity CLI",
      "verifiedVersion": "docs + agy changelog 1.5.13",
      "versionRange": ">=1.5.4",
      "versionScheme": "semver"
    },
    "binding": {
      "source": "payload",
      "field": "conversationId",
      "fallbackField": null,
      "status": "supported"
    },
    "decisionHold": {
      "status": "unverified",
      "timeoutField": "timeout",
      "timeoutUnit": "seconds",
      "defaultTimeoutSeconds": 30,
      "maxTimeoutSeconds": null
    },
    "mutationHooks": {
      "classification": "post-only",
      "pathEvidenceSource": "declared_edit",
      "pathEvidenceQuality": "direct",
      "shellEvidence": "unavailable",
      "pathlessEvidence": "unavailable",
      "fixture": "fixtures/mutation-window-evidence.json",
      "reason": null,
      "evidenceRef": null,
      "notes": "Only PostToolUse is registered, so evidence is post-only. A `write_to_file`, `replace_file_content` or `multi_replace_file_content` completion names its destination in `TargetFile`; the codec normalizes it to `file.edited` and decodes the outcome from `error` (empty or absent is success per the hook contract). Only an `ok` edit records objective-bound, non-exclusive `declared_edit`/`direct` evidence; a failed edit records `outcome_partial`, and `run_command` records `shell_activity_unverified`."
    },
    "capabilities": {
      "observe.prompt": {
        "status": "supported",
        "native": "PreInvocation",
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
        "status": "supported",
        "native": "PostToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
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
        "native": "PreToolUse",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
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
        "trackedAs": "latch-engine"
      },
      "inject.midTurn": {
        "status": "unsupported",
        "native": null,
        "reason": "PreInvocation and PostInvocation can inject only at model-invocation boundaries; the hook surface has no path to deliver input while a model or tool call is actively running.",
        "evidenceRef": "https://antigravity.google/docs/hooks#preinvocation",
        "trackedAs": null
      },
      "inject.turnBoundary": {
        "status": "supported",
        "native": "Stop",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "inject.nextTurn": {
        "status": "not-implemented",
        "native": "PreInvocation.injectSteps.userMessage",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "latch-engine"
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
        "summary": "Antigravity was not part of the original harness verification survey. Its hook names, payload fields, response shapes and failure behavior are now established by the first-party hook contract, the build guide (\"any non-zero exit code is logged ... and ignored (failing open)\") and the agy release notes, and every graded capability is fixture-proven against that contract. The connector registers only fail-open observational, reminder and inject hooks; it registers no decision hook, so no hook failure can block or approve a tool call. No live agy session at the 1.5.4 floor has been recorded (the local agy was 1.0.4).",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "per-invocation-hook-spawn",
        "severity": "low",
        "summary": "PreInvocation runs before every model call, so a launched session spawns `ovld` once per invocation to record a prompt that usually has not changed. Repeats are dropped locally before any backend call; unlaunched sessions spawn nothing.",
        "verification": "verified",
        "mitigation": "accepted",
        "trackedAs": null
      }
    ],
    "decisionShape": {
      "codec": "antigravity",
      "neverSend": [
        "allow_tool",
        "hookSpecificOutput",
        "permissionDecision",
        "permission",
        "overwrite"
      ]
    }
  },
  {
    "adapter": "claude",
    "codec": "claude",
    "integrationShape": "callback",
    "capabilityTier": 1,
    "descriptorDigest": "ea275756dcff0c1ed16b366f8bcfad9a185545d2c7fd55ab7afc6933bbad2552",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "Claude Code",
      "verifiedVersion": "2.1.329",
      "versionRange": ">=2.1.328",
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
    "mutationHooks": {
      "classification": "post-only",
      "pathEvidenceSource": "declared_edit",
      "pathEvidenceQuality": "direct",
      "shellEvidence": "unavailable",
      "pathlessEvidence": "unavailable",
      "fixture": "fixtures/mutation-window-evidence.json",
      "reason": null,
      "evidenceRef": null,
      "notes": "Recorded completion-side write evidence lacks a matching pre/post call pair. A directly named native edit path normalized by the Claude codec as `file.edited` records objective-bound, non-exclusive `declared_edit`/`direct` evidence. Codec-normalized read, search, and fetch callbacks are silent no-ops. Mutation-capable callbacks without a normalized edit path, plus shell, generic, unknown, and unmapped callbacks, record unavailable evidence health."
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
        "status": "supported",
        "native": "statusLine",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      }
    },
    "hazards": [
      {
        "id": "shipped-permission-hook-inert",
        "severity": "high",
        "summary": "Retired with the shell scripts (coo:1323). The old plugin shipped an unregistered `scripts/permission-hook.sh` that called a nonexistent `ovld protocol permission-request` and backgrounded the call, so it could never return a decision. The script is deleted. The decision path is now a PermissionRequest `mcp_tool` hook that `ovld launch` registers only for channel-bound sessions, with `onFailure: \"block\"`.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "shipped-stop-hook-inert",
        "severity": "medium",
        "summary": "Fixed in coo:1323. The old Stop script called `ovld protocol hook-event --hook-type Stop`, which the CLI rejected, and gated on a `MISSION_ID` the pod did not set. The Stop hook is now an `mcp_tool` call: it binds through the launch environment or the native-session index that `attach` writes, `hook-event` accepts Stop and returns delivery status, and the reminder blocks at most once per session and objective. Failures fail open.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "hook-tool-unlisted-call",
        "severity": "medium",
        "summary": "The hooks server omits its hook tools from `tools/list` so the model never sees them, and Claude Code still calls them from `mcp_tool` hooks (verified on 2.1.329). That behavior is undocumented. A release that validated hook tools against `tools/list` would break every Overlord hook, and in channel-bound launches would deny every permission request. Doctor warns when Claude Code is newer than `verifiedVersion`; the probe must be re-run on each `verifiedVersion` bump.",
        "verification": "verified",
        "mitigation": "required",
        "trackedAs": "coo:1323.2ewy"
      },
      {
        "id": "hook-server-no-fallback",
        "severity": "medium",
        "summary": "Claude Code has no fallback from a failed `mcp_tool` hook to another hook, so when the hooks server is not connected (no `node` on PATH, server disabled in `/mcp`, plugin not installed) follow-up capture, file capture and the Stop reminder silently stop while the session keeps working. Mitigated: these hooks fail open (fixtures/probe-fail-open.json), `ovld agent-setup claude` and `ovld doctor` report a missing or disconnected server with the fix, and the overlord-mission skill tells the agent to use the `ovld protocol` CLI.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "fork-and-subagent-identity-unknown",
        "severity": "medium",
        "summary": "Resolved (coo:1323.n938). Recorded on 2.1.329: every hook fired inside a subagent, including a `fork` subagent, carries the parent's `session_id` and adds `agent_id` and `agent_type`; `${agent_id}`/`${agent_type}` template the same values into an `mcp_tool` input and `\"\"` in the main agent. PreCompact, PostCompact and the post-compaction SessionStart keep the `session_id` (main-thread compaction carries no `agent_id`). Binding by `session_id` therefore routes subagent and fork work to the parent's binding, which is correct because they work on the parent's objective, and a binding survives compaction. No Overlord hook needs `agent_id` today; it stays available if a decision card ever has to name the subagent.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "subagent-stop-unregistered",
        "severity": "medium",
        "summary": "Resolved (coo:1323.n938); `SubagentStop` stays unregistered on purpose. Recorded on 2.1.329: the main `Stop` fires while background subagents still run and lists them in `background_tasks`; each subagent's end fires `SubagentStop` (parent `session_id` plus `agent_id`); Claude then wakes the main agent with a harness-written `<task-notification>` prompt through UserPromptSubmit, and that turn ends in another main `Stop` with `background_tasks` empty. So the main Stop does run after subagent work completes. A subagent's stop is not the end of the objective, so a reminder or an inbox claim there would be wrong. The Stop hook templates `background_tasks`; while one is running, the delivery reminder and the headless inbox wait are deferred to the later Stop, and `hook-event` never records a `<task-notification>` prompt as a user follow-up.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "nested-session-inherits-launch-env",
        "severity": "medium",
        "summary": "A `claude -p` started from a Bash tool of a launched session gets its own session id (2.1.317+, and on 2.1.329 even with `CLAUDE_CODE_DISABLE_NESTED_SESSION_ID=1`), so it never matches the native-session index. But it inherits the launch environment (mission, objective, session channel), which bound it to the parent's mission: its prompt would be recorded as the user's follow-up, its Stop could claim the parent's pending instruction or be told to deliver the parent's objective. Mitigated: Claude Code exports `CLAUDE_PID` to tool processes but not to MCP servers, so a hooks server that sees a `CLAUDE_PID` other than its own parent belongs to a nested session. Its follow-up, Stop and decision hooks then ignore the launch binding (it may still bind through the index under its own id if its agent attaches); file capture keeps the launch objective because the nested process edits the same checkout for the same objective. Limit: a session launched by an `ovld` process that itself runs inside a Claude Code tool inherits that outer `CLAUDE_PID` and is treated as nested.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "headless-stop-hold",
        "severity": "low",
        "summary": "A headless final Stop holds the inbox open for up to 60 s. Before 2.1.323 a host could take a hook that long for a hung turn. Since 2.1.323 `claude -p` and SDK sessions emit a progress heartbeat every 30 s while a hook runs (recorded on 2.1.329: `tool_progress` with `heartbeat: true` at 30 s during a 45 s Stop hook). Interactive sessions never wait, the wait is skipped while background subagents run, and the Stop hook timeout (100 s) exceeds the wait plus the inbox (16 s) and reminder (10 s) budgets.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
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
    "descriptorDigest": "689c59aa63597d90cf3ef64ac11fd339f543c9f381646f98e6c417c5c31bbc38",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "Codex CLI",
      "verifiedVersion": "0.171.0",
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
    "mutationHooks": {
      "classification": "post-only",
      "pathEvidenceSource": "unavailable",
      "pathEvidenceQuality": "unavailable",
      "shellEvidence": "unavailable",
      "pathlessEvidence": "unavailable",
      "fixture": "fixtures/mutation-window-evidence.json",
      "reason": null,
      "evidenceRef": null,
      "notes": "Recorded pre/post shapes are separate calls and do not prove a paired window. A directly named native edit path normalized by the Codex codec as `file.edited` may record objective-bound, non-exclusive `declared_edit`/`direct` evidence. `apply_patch` destinations are reduced only from its declared `*** Add|Update|Delete File:` headers; patch text itself is never retained."
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
        "status": "supported",
        "native": "statusline MCP provider (tui_extensions_statusline)",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      }
    },
    "hazards": [
      {
        "id": "two-integration-surfaces-could-disagree",
        "severity": "high",
        "summary": "Hooks and `codex app-server` can both answer a permission. A session driven by both would race in a way no revision CAS can settle, so exactly one surface must be chosen and documented before either is built. Chosen per session: user-started Codex sessions use this hooks adapter, which claims no `decide.*`; Overlord-driven sessions use the separate `codex-app-server` adapter, whose server environment silences these hooks (`plugin-hooks-fire-inside-app-server-threads`).",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "plugin-hooks-fire-inside-app-server-threads",
        "severity": "high",
        "summary": "The installed Overlord Codex plugin's hooks run inside `codex app-server` threads too (spike coo:1325.gqfy: hook/started for userPromptSubmit and postToolUse inside app-server turns). When the `codex-app-server` adapter drives a session, a hook that still reported would capture every edit twice and could attribute a thread to whatever objective started the server. The supervisor starts the server with an allowlisted environment (no objective, mission or channel scope) plus OVERLORD_CONTROL_PLANE_SURFACE, and every Overlord callback exits before any work when that marker is set. In app-server mode only the adapter observes and answers, which also keeps `two-integration-surfaces-could-disagree` closed by construction.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "prompt-hook-inside-app-server-threads",
        "severity": "medium",
        "summary": "The plugin's UserPromptSubmit callback writes the native-session alias and spawns `ovld protocol hook-event`; inside an Overlord-driven app server it must do neither, for the same reason as the PostToolUse callback.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "subagent-hooks-share-the-root-session",
        "severity": "medium",
        "summary": "Codex runs the plugin's hooks inside spawned subagents too. In 0.170 every thread of a session tree shares the root's agent-control identity, so a subagent's hook payload carries the root session's `session_id` plus `agent_id` (the child thread) and `agent_type` (its role) — codex-rs `core/src/hook_runtime.rs` and `core/src/agent/control.rs`; the 0.168 `InheritedSessionId` extension does the same for host-started child threads. The codec records `agent_id` as `subagentId`, so a user-started session's subagent work correlates with the parent session instead of appearing as a separate one. Not covered: a 0.170 fork (`/fork`) gets a new session id and correlates as its own session; release notes say 0.171 makes forks inherit the root session id, which has not been run here. SubagentStart and SubagentStop hooks exist but are not registered; the parent's tool calls already show the spawn.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "prompt-and-agent-hook-handlers-inert",
        "severity": "low",
        "summary": "Codex parses `prompt` and `agent` hook handlers and then skips them with a \"not supported yet\" warning (re-checked live on 0.170.0 and in the 0.171.0 hook discovery source), so a manifest that used either would install cleanly, list in `hooks`, and never execute. `command` runs, and since 0.148 an `mcp_tool` handler can call an MCP tool; the connector uses neither `mcp_tool` nor the inert types. The connector must keep emitting `command` handlers only, and must not read the presence of these variants in the schema as availability. `command` is a shell command line run through `$SHELL -lc` (`/bin/sh` when SHELL is unset) — it is not restricted to Bash and not restricted to shell scripting, since the command may invoke any interpreter.",
        "verification": "verified",
        "mitigation": "accepted",
        "trackedAs": null
      },
      {
        "id": "hooks-version-and-platform-gate",
        "severity": "medium",
        "summary": "Hooks were experimental behind `features.codex_hooks` before v0.124. The connector requires Codex >=0.124; installations outside that range must be treated as unavailable. Re-checked at 0.171.0: `hooks` is a stable feature and the hook schemas the connector reads are unchanged, but nothing yet enforces the lower bound at install or launch.",
        "verification": "verified",
        "mitigation": "required",
        "trackedAs": "agent-session-phase-4"
      },
      {
        "id": "plugin-hook-trust-pinned-to-bundle",
        "severity": "high",
        "summary": "Codex runs a plugin hook only after the user approves it in `/hooks`, and from 0.164 the approval (`trusted_content_hash` in config.toml) pins a fingerprint of the whole installed plugin bundle. A fresh `ovld agent-setup codex`, and every connector update after it (each one bumps plugin.json), leaves the Overlord hooks unapproved. The interactive TUI asks for review; `codex exec` skips them silently, so prompt capture and change capture stop without an error. `ovld agent-setup codex` and `ovld doctor` reproduce the fingerprint and name the hooks that will not run. Overlord never writes hook trust: approving a hook stays the user's decision, and `--dangerously-bypass-hook-trust` is not used.",
        "verification": "verified",
        "mitigation": "accepted",
        "trackedAs": null
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
    "adapter": "codex-app-server",
    "codec": "codex-app-server",
    "integrationShape": "controlPlane",
    "capabilityTier": 3,
    "descriptorDigest": "62fe3dc93ee7f64f6fb52d48e88e10679c9a32a92abc6b16ace29571284fcbf2",
    "descriptorSchemaVersion": 1,
    "harness": {
      "name": "Codex app server",
      "versionScheme": "semver",
      "verifiedVersion": "0.171.0",
      "versionRange": ">=0.170.0"
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
    "mutationHooks": {
      "classification": "paired",
      "pathEvidenceSource": "declared_edit",
      "pathEvidenceQuality": "direct",
      "shellEvidence": "unavailable",
      "pathlessEvidence": "unavailable",
      "fixture": "fixtures/mutation-window-evidence.json",
      "reason": null,
      "evidenceRef": null,
      "notes": "`item/started` carries the fileChange item (paths and diff) before the patch approval and before anything is written; `item/completed` carries the same item id and path with the final status. The diff is used only for the approval card's line counts and never leaves the machine."
    },
    "capabilities": {
      "observe.prompt": {
        "status": "supported",
        "native": "item/completed:userMessage",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.toolCall": {
        "status": "supported",
        "native": "item/started:commandExecution",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.toolResult": {
        "status": "supported",
        "native": "item/completed:commandExecution",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.fileEdit": {
        "status": "supported",
        "native": "item/completed:fileChange",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "observe.sessionLifecycle": {
        "status": "supported",
        "native": "thread/started",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "decide.shell": {
        "status": "supported",
        "native": "item/commandExecution/requestApproval",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "decide.mcp": {
        "status": "unverified",
        "native": "mcpServer/elicitation/request",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "coo-1325-codex-mcp-elicitation-frames"
      },
      "decide.fileWrite": {
        "status": "supported",
        "native": "item/fileChange/requestApproval",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "decide.anyTool": {
        "status": "unsupported",
        "native": "approvalPolicy",
        "reason": "Codex gates by sandbox and approval policy, not per tool: web search, dynamic tools and in-sandbox reads are never routed to a client for approval, so there is no request to answer for an arbitrary tool.",
        "evidenceRef": "planning/feature-plans/codex-app-server-control-plane.md#33-approvals-and-questions",
        "trackedAs": null
      },
      "decide.universal": {
        "status": "unsupported",
        "native": "approvalPolicy",
        "reason": "The app server has no pre-tool callback that every tool passes through; that exists only on the hooks surface, which does not run in this mode.",
        "evidenceRef": "planning/feature-plans/codex-app-server-control-plane.md#54-capability-targets-per-matrix-row",
        "trackedAs": null
      },
      "answer.structuredQuestion": {
        "status": "unverified",
        "native": "item/tool/requestUserInput",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "coo-1325-codex-request-user-input-frames"
      },
      "answer.persistentAllow": {
        "status": "not-implemented",
        "native": "acceptForSession",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
      },
      "inject.midTurn": {
        "status": "supported",
        "native": "turn/steer",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "inject.turnBoundary": {
        "status": "supported",
        "native": "turn/start",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "inject.nextTurn": {
        "status": "supported",
        "native": "turn/start",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "terminal.concurrentAnswer": {
        "status": "supported",
        "native": "serverRequest/resolved",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      },
      "terminal.statusSurface": {
        "status": "supported",
        "native": "statusline MCP provider (tui_extensions_statusline)",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": null
      }
    },
    "hazards": [
      {
        "id": "experimental-surface-drift",
        "severity": "high",
        "summary": "`codex app-server` and its WebSocket transport are labelled experimental, and 0.168–0.171 each changed app-server behavior. The adapter speaks only a pinned method list, refuses a server whose initialize userAgent reports a version below the verified range, ignores unknown notifications and refuses unknown server requests.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "auto-review-would-bypass-overlord",
        "severity": "high",
        "summary": "A user config with `approvals_reviewer = \"auto_review\"` makes a Codex subagent decide approvals the client never sees, and a thread started without an explicit reviewer inherits it (spike, LIVE). Every thread is started or resumed with `approvalsReviewer: \"user\"`.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "control-socket-owns-the-session",
        "severity": "high",
        "summary": "Anything that can connect to the app server can drive the agent. The server listens only on `unix://` in an owner-only `~/.ovld/cx/` (Codex keeps the real 0600 socket in its own 0700 directory, and the supervisor connects only after checking that socket and directory belong to this user and are not group- or world-writable), never on TCP and never on the user's shared daemon socket; the supervisor starts no thread until the server reports remote control `disabled` right after `initialize`, and stops if it later reports anything else. A same-user local process can still connect, exactly as the TUI does (see `same-user-agent-reaches-credentials`).",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "server-env-carries-scope",
        "severity": "high",
        "summary": "Commands the agent runs inherit the app server's environment. The server is started with an allowlisted environment, so the user token, channel credentials and objective scope never reach it, and with OVERLORD_CONTROL_PLANE_SURFACE so the Codex plugin's own hooks stay silent inside it (see the codex adapter's `plugin-hooks-fire-inside-app-server-threads`).",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "stop-leaves-turn-running",
        "severity": "medium",
        "summary": "Ending an Overlord session must not leave Codex working. When the channel stops honoring the credential, or the supervisor is signalled, it interrupts the running turn before closing the connection.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "launch-mints-no-channel",
        "severity": "high",
        "summary": "The adapter needs a credentialed session channel, and launch minted none since contract 76 (ADR 0065). A Codex launch in app-server mode now mints one through POST /api/objectives/{id}/session-channels, stages it in the owner-only cache and starts the supervisor; every other launch still mints none (ADR 0092).",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "human-session-controls-closed",
        "severity": "low",
        "summary": "This adapter's approval, question and choice cards are answered from Overlord (delivery mode `control_plane`, ADR 0094); an approval only by the member who launched the session. Session inputs are still refused for every adapter (`POST /api/agent-session-inputs` answers 410), so a follow-up, steer or interrupt is typed in the attached TUI (`ovld agent-session attach`), not sent from web or mobile.",
        "verification": "verified",
        "mitigation": "required",
        "trackedAs": "coo-1325-control-plane-human-controls"
      },
      {
        "id": "question-answer-double-delivery",
        "severity": "medium",
        "summary": "A human answer to a question or choice request is delivered through Latch into the session's terminal (ADR 0065). For a codex-app-server session that would type the answer into an attached TUI as well as answering the JSON-RPC request. The resolve route now records an answer to a control-plane request without any Latch delivery, and the supervisor answers the JSON-RPC request from its waiter lease (ADR 0094).",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "supervisor-killed-leaves-server",
        "severity": "medium",
        "summary": "The private server runs in its own process group so the supervisor can stop it, and it ignores SIGTERM while a turn runs (LIVE), so stop escalates to SIGKILL. A supervisor that is itself killed with SIGKILL would leave the server running its turn unsupervised, so a detached `sh` watchdog started with the server ends the server's group within about a second of the supervisor's pid disappearing. The next supervisor start and `ovld doctor` still reap any server left behind, after checking the pid belongs to a Codex app server.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "reasked-approval-inherits-answer",
        "severity": "medium",
        "summary": "Codex can ask twice about one item (a command that failed in the sandbox is asked again to run outside it, with the same item id), and the channel dedupes cards by native request id, returning the earlier card with its answer. The supervisor gives a later request for an already-settled item its own occurrence id (`<item>#2`), so an earlier allow is never applied to a new, possibly broader, approval; a replay of a still-open card keeps its id.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "same-user-agent-reaches-credentials",
        "severity": "medium",
        "summary": "Commands the agent runs execute as the person's own OS user, and Codex's workspace-write sandbox allows reading the whole filesystem. With network access (granted per command, or a sandbox that allows it) such a command could read the person's `ovld` login and the channel credential cache, or connect to this session's own socket, and answer the session's cards. The server's environment carries no credential and the channel credential cannot resolve a request, but the same-user boundary is the person's own account. Accepted and documented; a sandbox that denies reading `~/.ovld` is the stronger control where Codex supports it.",
        "verification": "verified",
        "mitigation": "accepted",
        "trackedAs": null
      },
      {
        "id": "child-threads-share-the-connection",
        "severity": "high",
        "summary": "The app server attaches every connection to every thread it creates (LIVE 0.170, and `try_attach_thread_listener` in the 0.170 source), so a subagent's notifications and its approval requests reach the Overlord connection with the child's thread id, and so do those of a thread another client started from scratch. The supervisor keeps the session's thread tree: a child announced by a tree thread's `subAgentActivity` or `spawnAgent` item, a thread whose `thread/read` lineage (`parentThreadId`, `forkedFromId`, or the root's inherited `sessionId`) points into the tree, or a fork reported by thread/started, is the session's work and is attributed to it; any other thread is looked up once and then ignored — no event, no capture, no card, and its approvals are left to its own client.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "notifications-missed-while-disconnected",
        "severity": "medium",
        "summary": "Notifications are not replayed, so whatever a thread or its subagents did while the supervisor's socket was down (server crash and respawn, dropped connection, a supervisor started on an existing thread) would be missing from the session feed and the change ledger. After every resume the supervisor pages `thread/turns/list` for each thread in the tree (children found by `thread/list {parentThreadId}`) and replays completed items through the live path. Event ids are content-derived and equal the live ones, and the change ledger appends a path once, so nothing already captured is duplicated.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "fork-history-repeats-source-turns",
        "severity": "low",
        "summary": "A fork's `thread/turns/list` begins with its source's turns, with the same turn and item ids (LIVE 0.170; 0.169 made paging work across fork segments). Importing them under the fork would credit the source's work to the fork. The import walks the tree root first and skips a turn it has already imported in the same pass. A fork is only known from its thread/started, so one made while Overlord was disconnected is not found by the import (`thread/list` has no fork filter); spawned subagents are.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      },
      {
        "id": "implicit-folder-trust",
        "severity": "low",
        "summary": "`thread/start` in an untrusted git checkout with a writable sandbox writes `trust_level = \"trusted\"` for that path into the user's ~/.codex/config.toml (LIVE). The supervisor records the entry its thread added and removes exactly that table when the session ends, only while it holds nothing but that line (ADR 0092; LIVE on 0.170 and 0.171). A symlinked config is edited at its target, so the link survives.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
      }
    ],
    "decisionShape": {
      "codec": "codex-app-server",
      "neverSend": [
        "hookSpecificOutput",
        "permissionDecision",
        "acceptForSession",
        "acceptWithExecpolicyAmendment"
      ]
    }
  },
  {
    "adapter": "cursor",
    "codec": "cursor",
    "integrationShape": "callback",
    "capabilityTier": 1,
    "descriptorDigest": "55c24b2e53d557d9c07e593effc230fc2ec72f985168765b5f23f494b2fc7c0b",
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
    "mutationHooks": {
      "classification": "post-only",
      "pathEvidenceSource": "declared_edit",
      "pathEvidenceQuality": "direct",
      "shellEvidence": "unavailable",
      "pathlessEvidence": "unavailable",
      "fixture": "fixtures/mutation-window-evidence.json",
      "reason": null,
      "evidenceRef": null,
      "notes": "Recorded pre/post payloads carry different native call ids and do not prove a paired window. A postToolUse path normalized by the Cursor codec as `file.edited` records objective-bound, non-exclusive `declared_edit`/`direct` evidence. Codec-normalized read, search, and fetch callbacks are silent no-ops. Mutation-capable callbacks without a normalized edit path, plus shell, generic, unknown, and unmapped callbacks, record unavailable evidence health."
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
        "reason": "There is no single event covering every approval. Cursor's own Claude-dialect map resolves `PermissionRequest` to null and lists it as unsupported; coverage is per tool class (shell, MCP, file read, generic pre-tool), so some approvals will never reach Overlord and the UI must not imply otherwise.",
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
        "id": "reads-claude-hook-config",
        "severity": "high",
        "summary": "Cursor loads hooks from Claude's project-local, project and user settings and imports installed, enabled Claude Code plugins' hooks/hooks.json (on by default in the IDE; it cannot be turned off in cursor-agent), so Overlord's Claude hooks could fire inside Cursor sessions with Cursor-shaped payloads. Verified from Cursor's third-party hooks docs and forum (t/166558). Mitigated in coo:1323: the Claude plugin now ships only fail-open `mcp_tool` hooks, and Cursor's importer copies only `command` hooks, so no Overlord script runs in Cursor. The fail-closed decision hook is registered per Claude launch and never lives in the plugin, and the plugin registers no PreToolUse. How Cursor treats an `mcp_tool` entry is undocumented and was not observed in a live Cursor run.",
        "verification": "verified",
        "mitigation": "implemented",
        "trackedAs": null
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
    "descriptorDigest": "4af085fa3987501b85e323fdbfcc0c3cfe1a8da47ef373f0b509082749d2c44f",
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
    "mutationHooks": {
      "classification": "post-only",
      "pathEvidenceSource": "unavailable",
      "pathEvidenceQuality": "unavailable",
      "shellEvidence": "unavailable",
      "pathlessEvidence": "unavailable",
      "fixture": "fixtures/mutation-window-evidence.json",
      "reason": null,
      "evidenceRef": null,
      "notes": "A completed tool frame is recorded, but no matching in-progress frame exists."
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
        "status": "not-implemented",
        "native": "message.part.updated",
        "reason": null,
        "evidenceRef": null,
        "trackedAs": "agent-session-phase-2"
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
    "descriptorDigest": "00ac7950f03ff225b0ed39ab3b57b4db4d28f4fe0331d0ee50bcb2c51bfa6823",
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
    "mutationHooks": {
      "classification": "unsupported",
      "pathEvidenceSource": "unavailable",
      "pathEvidenceQuality": "unavailable",
      "shellEvidence": "unavailable",
      "pathlessEvidence": "unavailable",
      "fixture": "fixtures/mutation-window-evidence.json",
      "reason": "No recorded completion callback with the same native call id proves a pair.",
      "evidenceRef": null,
      "notes": null
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

export const HARNESS_CATALOG_DIGEST = 'd0d425ba03bbe499091d6963d6e53620d1d08d9f6c5c7f77b2324d18f18eceb2';

export function findHarnessDescriptor(adapter: string): HarnessDescriptor | undefined {
  return HARNESS_DESCRIPTORS.find(entry => entry.adapter === adapter);
}
