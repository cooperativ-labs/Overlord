/* GENERATED FILE — DO NOT EDIT.
 * Source: connectors/adapters/<agent>/codec/<agent>.codec.yaml
 * Regenerate with `yarn connectors:capabilities`.
 *
 * Connector-owned event dialects, compiled for the CLI to execute. The runtime reads THIS
 * bundle rather than the YAML: parsing YAML from disk on a hook path would violate the latency
 * invariant, and the installed adapter may be older than the CLI.
 *
 * A codec declares only WHERE native values live. It cannot name a destination the core
 * interpreter (`packages/core/service/agent-session/pure/codec.ts`) does not implement, which
 * is what makes "no raw payload leaves the machine" a structural property rather than a rule
 * each codec author has to remember.
 */

import type { CodecSpec } from '@overlord/core/service/agent-session/pure/codec';

export const AGENT_SESSION_CODECS: Record<string, CodecSpec> = {
  "claude": {
    "codecVersion": 1,
    "adapter": "claude",
    "eventNamePath": "hook_event_name",
    "nativeSessionPaths": [
      "session_id"
    ],
    "projectRootPaths": [
      "cwd"
    ],
    "events": [
      {
        "native": "PostToolUse",
        "kind": "tool.completed",
        "origin": "agent",
        "toolPath": "tool_name",
        "inputPath": "tool_input",
        "fileEditKind": "file.edited"
      },
      {
        "native": "UserPromptSubmit",
        "kind": "prompt.submitted",
        "origin": "user",
        "promptPath": "prompt"
      },
      {
        "native": "SessionStart",
        "kind": "session.started",
        "origin": "system",
        "detailPath": "source"
      }
    ]
  },
  "codex": {
    "codecVersion": 1,
    "adapter": "codex",
    "eventNamePath": "hook_event_name",
    "nativeSessionPaths": [
      "session_id"
    ],
    "projectRootPaths": [
      "cwd"
    ],
    "events": [
      {
        "native": "PreToolUse",
        "kind": "tool.called",
        "origin": "agent",
        "toolPath": "tool_name",
        "inputPath": "tool_input",
        "callIdPath": "tool_use_id",
        "turnIdPath": "turn_id"
      },
      {
        "native": "PostToolUse",
        "kind": "tool.completed",
        "origin": "agent",
        "toolPath": "tool_name",
        "inputPath": "tool_input",
        "callIdPath": "tool_use_id",
        "turnIdPath": "turn_id",
        "fileEditKind": "file.edited"
      },
      {
        "native": "UserPromptSubmit",
        "kind": "prompt.submitted",
        "origin": "user",
        "promptPath": "prompt",
        "turnIdPath": "turn_id"
      },
      {
        "native": "SessionStart",
        "kind": "session.started",
        "origin": "system",
        "detailPath": "source"
      }
    ]
  },
  "opencode": {
    "codecVersion": 1,
    "adapter": "opencode",
    "nativeSessionPaths": [
      "properties.sessionID",
      "properties.info.sessionID"
    ],
    "projectRootPaths": [
      "properties.cwd",
      "properties.directory"
    ],
    "events": [
      {
        "native": "message.part.updated",
        "kind": "tool.completed",
        "origin": "agent",
        "toolPath": "properties.part.tool",
        "inputPath": "properties.part.state.input",
        "callIdPath": "properties.part.callID",
        "outcomePath": "properties.part.state.status",
        "fileEditKind": "file.edited"
      },
      {
        "native": "session.idle",
        "kind": "session.ended",
        "origin": "system"
      },
      {
        "native": "session.updated",
        "kind": "session.started",
        "origin": "system"
      }
    ]
  },
  "pi": {
    "codecVersion": 1,
    "adapter": "pi",
    "eventNamePath": "type",
    "nativeSessionPaths": [
      "session_id"
    ],
    "projectRootPaths": [
      "cwd"
    ],
    "events": [
      {
        "native": "input",
        "kind": "prompt.submitted",
        "origin": "user",
        "promptPath": "prompt"
      },
      {
        "native": "tool_call",
        "kind": "tool.called",
        "origin": "agent",
        "toolPath": "tool_name",
        "inputPath": "tool_input",
        "callIdPath": "tool_use_id"
      },
      {
        "native": "agent_start",
        "kind": "session.started",
        "origin": "system"
      }
    ]
  }
} as const;

/** Look up a compiled codec by adapter key. `null` for an adapter with no push path yet. */
export function findAgentSessionCodec(adapter: string): CodecSpec | null {
  return AGENT_SESSION_CODECS[adapter] ?? null;
}
