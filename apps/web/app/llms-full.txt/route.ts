import { NextResponse } from 'next/server';

import { buildLlmsFullTxt } from '@/lib/agent-docs';

export const dynamic = 'force-static';

export async function GET() {
  return new NextResponse(await buildLlmsFullTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600'
    }
  });
}
