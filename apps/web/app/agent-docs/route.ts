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

Overlord exposes a hosted MCP endpoint. The full tool definitions — name, description, and input schema for every tool — are available as a public JSON array (no auth required):

- **Endpoint:** \`/api/mcp/tools\`
- **URL:** [https://www.ovld.ai/api/mcp/tools](https://www.ovld.ai/api/mcp/tools)

Fetch this endpoint to discover every MCP tool an agent can invoke through Overlord.

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
