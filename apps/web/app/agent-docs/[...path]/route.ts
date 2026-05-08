import { NextResponse } from 'next/server';

import { agentDocs, getAgentDocBySlug, readAgentDoc } from '@/lib/agent-docs';

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

export const dynamic = 'force-static';

export function generateStaticParams() {
  return agentDocs.map(doc => ({ path: [`${doc.slug}.md`] }));
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { path } = await params;

  if (path.length !== 1 || !path[0]?.endsWith('.md')) {
    return new NextResponse('Not found', { status: 404 });
  }

  const slug = path[0].slice(0, -'.md'.length);
  const doc = getAgentDocBySlug(slug);

  if (!doc) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(await readAgentDoc(doc), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600'
    }
  });
}
