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
  "antigravity": {
    "codecVersion": 1,
    "adapter": "antigravity",
    "eventNamePath": "hookEventName",
    "nativeSessionPaths": [
      "conversationId"
    ],
    "projectRootPaths": [
      "cwd",
      "workspacePaths.0"
    ],
    "events": [
      {
        "native": "PreInvocation",
        "kind": "prompt.submitted",
        "origin": "user",
        "promptPath": "lastUserInput"
      },
      {
        "native": "PreToolUse",
        "kind": "tool.called",
        "origin": "agent",
        "toolPath": "toolCall.name",
        "inputPath": "toolCall.args",
        "callIdPath": "toolCall.id"
      },
      {
        "native": "PostToolUse",
        "kind": "tool.completed",
        "origin": "agent",
        "toolPath": "toolCall.name",
        "inputPath": "toolCall.args",
        "callIdPath": "toolCall.id",
        "outcomeErrorPath": "error",
        "fileEditKind": "file.edited",
        "filePathPaths": [
          "TargetFile"
        ]
      }
    ]
  },
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
        "successOnly": true,
        "fileEditKind": "file.edited",
        "filePathPaths": [
          "file_path",
          "notebook_path",
          "filePath",
          "path"
        ]
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
        "turnIdPath": "turn_id",
        "subagentIdPath": "agent_id"
      },
      {
        "native": "PostToolUse",
        "kind": "tool.completed",
        "origin": "agent",
        "toolPath": "tool_name",
        "inputPath": "tool_input",
        "callIdPath": "tool_use_id",
        "turnIdPath": "turn_id",
        "subagentIdPath": "agent_id",
        "outcomePath": "tool_response",
        "outcomeExitCodePrefix": "Exit code: ",
        "fileEditKind": "file.edited",
        "filePathPaths": [
          "file_path",
          "filePath",
          "path"
        ],
        "filePathPatchTextPaths": [
          "command",
          "patch"
        ]
      },
      {
        "native": "UserPromptSubmit",
        "kind": "prompt.submitted",
        "origin": "user",
        "promptPath": "prompt",
        "turnIdPath": "turn_id",
        "subagentIdPath": "agent_id"
      },
      {
        "native": "SessionStart",
        "kind": "session.started",
        "origin": "system",
        "detailPath": "source"
      }
    ]
  },
  "codex-app-server": {
    "codecVersion": 1,
    "adapter": "codex-app-server",
    "eventNamePath": "event",
    "nativeSessionPaths": [
      "context.rootThreadId",
      "threadId",
      "thread.id"
    ],
    "projectRootPaths": [
      "context.cwd",
      "item.cwd"
    ],
    "events": [
      {
        "native": "item/completed:userMessage",
        "kind": "prompt.submitted",
        "origin": "user",
        "subagentIdPath": "context.subagentThreadId",
        "promptPath": "item.content.0.text",
        "turnIdPath": "turnId"
      },
      {
        "native": "item/started:commandExecution",
        "kind": "tool.called",
        "origin": "agent",
        "subagentIdPath": "context.subagentThreadId",
        "toolPath": "item.type",
        "inputPath": "item",
        "callIdPath": "item.id",
        "turnIdPath": "turnId"
      },
      {
        "native": "item/completed:commandExecution",
        "kind": "tool.completed",
        "origin": "agent",
        "subagentIdPath": "context.subagentThreadId",
        "toolPath": "item.type",
        "inputPath": "item",
        "callIdPath": "item.id",
        "turnIdPath": "turnId",
        "outcomePath": "item.status"
      },
      {
        "native": "item/started:fileChange",
        "kind": "tool.called",
        "origin": "agent",
        "subagentIdPath": "context.subagentThreadId",
        "toolPath": "item.type",
        "inputPath": "change",
        "callIdPath": "item.id",
        "turnIdPath": "turnId"
      },
      {
        "native": "item/completed:fileChange",
        "kind": "tool.completed",
        "origin": "agent",
        "subagentIdPath": "context.subagentThreadId",
        "toolPath": "item.type",
        "inputPath": "change",
        "callIdPath": "item.id",
        "turnIdPath": "turnId",
        "outcomePath": "item.status",
        "fileEditKind": "file.edited",
        "filePathPaths": [
          "path",
          "kind.move_path"
        ]
      },
      {
        "native": "thread/started",
        "kind": "session.started",
        "origin": "system",
        "subagentIdPath": "context.subagentThreadId",
        "detailPath": "context.lineage"
      },
      {
        "native": "thread/closed",
        "kind": "session.ended",
        "origin": "system",
        "subagentIdPath": "context.subagentThreadId"
      },
      {
        "native": "turn/started",
        "kind": "notice",
        "origin": "system",
        "subagentIdPath": "context.subagentThreadId",
        "turnIdPath": "turn.id",
        "detailPath": "turn.status"
      },
      {
        "native": "turn/completed",
        "kind": "notice",
        "origin": "system",
        "subagentIdPath": "context.subagentThreadId",
        "turnIdPath": "turn.id",
        "detailPath": "turn.status"
      },
      {
        "native": "item/completed:subAgentActivity:started",
        "kind": "session.started",
        "origin": "agent",
        "subagentIdPath": "item.agentThreadId",
        "callIdPath": "item.id",
        "turnIdPath": "turnId",
        "detailPath": "item.agentPath"
      },
      {
        "native": "item/completed:subAgentActivity:completed",
        "kind": "session.ended",
        "origin": "agent",
        "subagentIdPath": "item.agentThreadId",
        "callIdPath": "item.id",
        "turnIdPath": "turnId",
        "detailPath": "item.agentPath"
      },
      {
        "native": "item/completed:subAgentActivity:interrupted",
        "kind": "notice",
        "origin": "agent",
        "subagentIdPath": "item.agentThreadId",
        "callIdPath": "item.id",
        "turnIdPath": "turnId",
        "detailPath": "item.agentPath"
      }
    ]
  },
  "cursor": {
    "codecVersion": 1,
    "adapter": "cursor",
    "eventNamePaths": [
      "hook_event_name",
      "event"
    ],
    "nativeSessionPaths": [
      "conversation_id",
      "session_id"
    ],
    "projectRootPaths": [
      "cwd"
    ],
    "events": [
      {
        "native": "beforeSubmitPrompt",
        "kind": "prompt.submitted",
        "origin": "user",
        "promptPath": "prompt"
      },
      {
        "native": "preToolUse",
        "kind": "tool.called",
        "origin": "agent",
        "toolPath": "tool_name",
        "inputPath": "tool_input",
        "callIdPath": "call_id"
      },
      {
        "native": "postToolUse",
        "kind": "tool.completed",
        "origin": "agent",
        "toolPath": "tool_name",
        "inputPath": "tool_input",
        "callIdPath": "call_id",
        "successOnly": true,
        "fileEditKind": "file.edited",
        "filePathPaths": [
          "file_path",
          "filePath",
          "path"
        ]
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
        "outcomePath": "properties.part.state.status"
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
