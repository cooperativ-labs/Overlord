import { NextResponse } from 'next/server';

import { agentDocs, buildAgentDocUrl, readProtocolHelp } from '@/lib/agent-docs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const toc = agentDocs
    .map(doc => `- [${doc.title}](${buildAgentDocUrl(doc)}): ${doc.description}`)
    .join('\n');

  const protocolHelp = await readProtocolHelp();
  const utcDate = new Date().toISOString();

  const body = `# Overlord Agent Documentation

Generated: ${utcDate}

Public machine-readable docs for AI agents working with Overlord.

## Documents

${toc}

## Tool Definitions

Overlord exposes a hosted MCP endpoint. The full tool definitions — name, description, and input schema for every tool — are available as a public JSON catalog (no auth required):

- **Endpoint:** \`/.well-known/overlord-mcp-tools.json\`
- **URL:** [https://www.ovld.ai/.well-known/overlord-mcp-tools.json](https://www.ovld.ai/.well-known/overlord-mcp-tools.json)

The same catalog URL is linked from \`tool_catalog\` in MCP OAuth protected-resource metadata. \`POST /api/mcp\` with \`tools/list\` also returns schemas without auth; \`tools/call\` and all ticket operations require OAuth.

Legacy \`/api/mcp/tools\` redirects to the well-known catalog.

## CLI for Agents

The \`ovld protocol\` CLI is the primary interface agents use to drive tickets from start to delivery. The reference below is generated from \`ovld protocol help\` on every build to ensure it stays current.

\`\`\`
${protocolHelp.trimEnd()}
\`\`\`
`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300'
    }
  });
}
