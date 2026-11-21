import { type McpToolDefinition, overlordMcpToolDefinitions } from '@overlord/contract/mcp-tools';

export type McpTaskSupport = 'forbidden' | 'optional' | 'required';

export type ToolDefinition = McpToolDefinition & {
  _meta?: Record<string, unknown>;
  /** MCP 2025-11-25 tool-level task negotiation; absent means `forbidden`. */
  execution?: { taskSupport: McpTaskSupport };
};

/** Agent identifier recorded when a hosted MCP caller attaches without naming one. */
export const HOSTED_MCP_DEFAULT_AGENT = 'hosted-mcp';

/** MCP Apps widget each hosted tool renders with; the local shim has no widgets. */
const HOSTED_TOOL_WIDGETS: Readonly<Record<string, string>> = {
  overlord_resolve_project: 'ui://overlord/project-selector.html',
  overlord_search_missions: 'ui://overlord/mission-list.html',
  overlord_load_mission_context: 'ui://overlord/objective-viewer.html',
  overlord_deliver_session: 'ui://overlord/file-changes.html',
  overlord_record_work: 'ui://overlord/file-changes.html'
};

/**
 * Hosted tools a task-capable client may run in the background (MCP 2025-11-25 tasks). Only the
 * slow finalization writes: `overlord_deliver_session` seals the report and summarizes the
 * delivery, `overlord_record_work` also creates the mission and runs the Gemini summarizer. Both
 * are replay-safe through a caller-retained `operationId`. Reads stay synchronous because the
 * model needs their answer before it can continue. The local connector shim offers no tasks.
 */
export const HOSTED_TASK_TOOLS: ReadonlySet<string> = new Set([
  'overlord_deliver_session',
  'overlord_record_work'
]);

function widget(uri: string): Record<string, unknown> {
  return {
    'openai/outputTemplate': uri,
    ui: { resourceUri: uri }
  };
}

export const hostedMcpToolDefinitions: ToolDefinition[] = overlordMcpToolDefinitions({
  defaultAgent: HOSTED_MCP_DEFAULT_AGENT
}).map(tool => {
  const uri = HOSTED_TOOL_WIDGETS[tool.name];
  return {
    ...tool,
    ...(uri ? { _meta: widget(uri) } : {}),
    ...(HOSTED_TASK_TOOLS.has(tool.name) ? { execution: { taskSupport: 'optional' as const } } : {})
  };
});
