import { topLevelKeys } from '../redact.js';
import { safeText } from '../text.js';

import { type DescribeInput, type Description, normalizeMarkers } from './types.js';

/**
 * The MCP formatter — server and tool name, plus input **key names** only.
 *
 * MCP tools are third-party code with arbitrary input schemas that Overlord has never seen. The
 * default rule therefore applies in full: names are structural and safe, values are content and
 * are not. `github/create_issue {title, body, repo}` is enough to decide; the body of the issue
 * is not ours to store, and could be anything.
 *
 * The server name is worth surfacing separately because it is the trust boundary a person
 * actually reasons about — "the deploy server wants to do something" is a different decision
 * from "the docs server wants to do something", regardless of the tool name.
 */

/** Native MCP tool names arrive as `mcp__<server>__<tool>` in several harnesses. */
export function splitMcpToolName(nativeName: unknown): {
  server: string | null;
  tool: string | null;
} {
  if (typeof nativeName !== 'string') return { server: null, tool: null };
  const match = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(nativeName);
  if (match) {
    return {
      server: safeText(match[1], 60).text || null,
      tool: safeText(match[2], 80).text || null
    };
  }
  const slash = /^([^/]+)\/(.+)$/.exec(nativeName);
  if (slash) {
    return {
      server: safeText(slash[1], 60).text || null,
      tool: safeText(slash[2], 80).text || null
    };
  }
  return { server: null, tool: safeText(nativeName, 80).text || null };
}

export function describeMcp({ input }: DescribeInput): Description {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const declared =
    (typeof record.server === 'string' && record.server) ||
    (typeof record.server_name === 'string' && record.server_name) ||
    null;
  const toolName =
    (typeof record.tool === 'string' && record.tool) ||
    (typeof record.tool_name === 'string' && record.tool_name) ||
    (typeof record.name === 'string' && record.name) ||
    null;
  const split = splitMcpToolName(toolName);
  const server = declared ? safeText(declared, 60).text : split.server;

  const args = record.arguments ?? record.input ?? record.params ?? record.tool_input;
  const { keys, truncated } = topLevelKeys(args);

  return {
    action: 'Call an MCP tool',
    subject: server ? `${server}/${split.tool ?? '?'}` : split.tool,
    detail: keys.length > 0 ? `input keys: ${keys.join(', ')}${truncated ? ', …' : ''}` : null,
    riskMarkers: normalizeMarkers([truncated && 'truncated']),
    keys
  };
}
