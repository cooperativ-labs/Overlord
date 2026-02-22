import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { getAgentApiToken } from '@/lib/env';

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function ensureAgentToken(request: Request): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  const providedToken = authHeader.replace('Bearer ', '').trim();
  const expectedToken = getAgentApiToken();
  if (!safeEquals(providedToken, expectedToken)) {
    return NextResponse.json({ error: 'Invalid bearer token.' }, { status: 401 });
  }

  return null;
}
