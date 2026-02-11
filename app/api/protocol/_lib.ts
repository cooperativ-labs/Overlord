import { ZodType } from "zod";

import { NextResponse } from "next/server";

import { ensureAgentToken } from "@/lib/orchestrator/protocol-auth";

export async function parseProtocolBody<T>(request: Request, schema: ZodType<T>) {
  const authResponse = ensureAgentToken(request);
  if (authResponse) {
    return {
      errorResponse: authResponse,
      data: null,
    };
  }

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return {
        errorResponse: NextResponse.json(
          {
            error: parsed.error.issues[0]?.message ?? "Invalid payload.",
          },
          { status: 400 }
        ),
        data: null,
      };
    }

    return {
      errorResponse: null,
      data: parsed.data,
    };
  } catch {
    return {
      errorResponse: NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
      data: null,
    };
  }
}

export function internalErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return NextResponse.json({ error: message }, { status: 500 });
}
