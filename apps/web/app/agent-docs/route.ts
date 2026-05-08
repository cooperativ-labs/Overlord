import { NextResponse } from 'next/server';

import { agentDocs, buildAgentDocUrl } from '@/lib/agent-docs';

export const dynamic = 'force-static';

export function GET() {
  const toc = agentDocs
    .map(doc => `- [${doc.title}](${buildAgentDocUrl(doc)}): ${doc.description}`)
    .join('\n');

  return new NextResponse(
    `# Overlord Agent Documentation\n\nPublic machine-readable docs for AI agents.\n\n${toc}\n`,
    {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=3600'
      }
    }
  );
}
