import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { ZodType } from 'zod';

import {
  type ProtocolAuthContext,
  resolveAgentToken,
  resolveProtocolOrganizationHintForBody
} from '@/lib/overlord/protocol-auth';

type ParseOk<T> = { ok: true; data: T; tokenContext: ProtocolAuthContext };
type ParseError = { ok: false; errorResponse: NextResponse };
export type ParseResult<T> = ParseOk<T> | ParseError;

export async function parseProtocolBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<ParseResult<T>> {
  try {
    const body = await request.json();
    const organizationHint = await resolveProtocolOrganizationHintForBody(body);
    const authResult = await resolveAgentToken(request, organizationHint);
    if (authResult.error) {
      return { ok: false, errorResponse: authResult.error };
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? 'Invalid payload.' },
          { status: 400 }
        )
      };
    }

    return {
      ok: true,
      data: parsed.data,
      tokenContext: authResult.context
    };
  } catch {
    return {
      ok: false,
      errorResponse: NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    };
  }
}

export function internalErrorResponse(error: unknown) {
  console.error('[protocol] internal error:', error);
  Sentry.captureException(error);
  return NextResponse.json({ error: 'An internal server error occurred.' }, { status: 500 });
}
