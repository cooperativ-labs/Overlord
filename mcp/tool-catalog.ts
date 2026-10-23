import { type McpToolDefinition, overlordMcpToolDefinitions } from '@overlord/contract/mcp-tools';

export type ToolDefinition = McpToolDefinition & {
  _meta?: Record<string, unknown>;
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
  return uri ? { ...tool, _meta: widget(uri) } : tool;
});
