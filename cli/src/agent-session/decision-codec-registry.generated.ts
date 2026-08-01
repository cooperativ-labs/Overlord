/* GENERATED FILE — DO NOT EDIT.
 * Source: connectors/adapters/<agent>/codec/<agent>.decision-codec.yaml
 * Regenerate with `yarn connectors:capabilities`.
 */

import type { DecisionCodecSpec } from '@overlord/core/service/agent-session/pure/decision';

export const AGENT_SESSION_DECISION_CODECS: Record<string, DecisionCodecSpec> = {
  claude: {
    codecVersion: 1,
    adapter: 'claude',
    eventNamePaths: ['hook_event_name'],
    projectRootPaths: ['cwd'],
    requests: [
      {
        native: 'PermissionRequest',
        toolPath: 'tool_name',
        inputPath: 'tool_input',
        requestIdPaths: ['request_id'],
        callIdPaths: ['tool_use_id'],
        timeoutPaths: ['timeout']
      }
    ],
    responses: {
      allow: {
        body: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: 'allow'
          }
        }
      },
      deny: {
        body: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: 'deny'
          }
        }
      },
      ask: {
        defer: true
      }
    }
  },
  codex: {
    codecVersion: 1,
    adapter: 'codex',
    eventNamePaths: ['hook_event_name'],
    projectRootPaths: ['cwd'],
    requests: [
      {
        native: 'PermissionRequest',
        toolPath: 'tool_name',
        inputPath: 'tool_input',
        requestIdPaths: ['request_id'],
        callIdPaths: ['tool_use_id'],
        timeoutPaths: ['timeout']
      }
    ],
    responses: {
      allow: {
        body: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: {
              behavior: 'allow'
            }
          }
        }
      },
      deny: {
        body: {
          hookSpecificOutput: {
            hookEventName: 'PermissionRequest',
            decision: {
              behavior: 'deny'
            }
          }
        }
      },
      ask: {
        defer: true
      }
    }
  },
  cursor: {
    codecVersion: 1,
    adapter: 'cursor',
    eventNamePaths: ['hook_event_name', 'event'],
    projectRootPaths: ['cwd'],
    requests: [
      {
        native: 'beforeShellExecution',
        tool: 'shell',
        inputPath: 'command',
        inputWrapKey: 'command',
        requestIdPaths: ['request_id'],
        callIdPaths: ['call_id'],
        timeoutPaths: ['timeout']
      },
      {
        native: 'beforeMCPExecution',
        tool: 'mcp',
        inputPath: 'tool_input',
        requestIdPaths: ['request_id'],
        callIdPaths: ['call_id'],
        timeoutPaths: ['timeout']
      },
      {
        native: 'preToolUse',
        toolPath: 'tool_name',
        inputPath: 'tool_input',
        requestIdPaths: ['request_id'],
        callIdPaths: ['call_id'],
        timeoutPaths: ['timeout']
      }
    ],
    responses: {
      allow: {
        body: {
          permission: 'allow'
        }
      },
      deny: {
        body: {
          permission: 'deny'
        }
      },
      ask: {
        body: {
          permission: 'ask'
        }
      }
    }
  },
  pi: {
    codecVersion: 1,
    adapter: 'pi',
    eventNamePaths: ['type'],
    projectRootPaths: ['cwd'],
    requests: [
      {
        native: 'tool_call',
        toolPath: 'tool_name',
        inputPath: 'tool_input',
        requestIdPaths: ['request_id'],
        callIdPaths: ['tool_use_id'],
        timeoutPaths: ['timeout']
      }
    ],
    responses: {
      allow: {
        body: {}
      },
      deny: {
        body: {
          block: true,
          reason: 'Denied by an Overlord decision'
        }
      },
      ask: {
        body: {}
      }
    }
  }
} as const;

export function findAgentSessionDecisionCodec(adapter: string): DecisionCodecSpec | null {
  return AGENT_SESSION_DECISION_CODECS[adapter] ?? null;
}
