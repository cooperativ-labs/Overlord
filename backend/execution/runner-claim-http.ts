import type { Response } from 'express';

export type RunnerClaimResult = {
  request: Record<string, unknown> | null;
  longPoll: boolean;
};

type ClaimResponse = Pick<
  Response,
  | 'headersSent'
  | 'writableEnded'
  | 'status'
  | 'setHeader'
  | 'flushHeaders'
  | 'json'
  | 'write'
  | 'end'
>;

/** Flush 200 + JSON content-type with no body so proxies see a live response during LISTEN. */
export function flushRunnerClaimHeaders(res: ClaimResponse): void {
  if (res.headersSent) return;
  res.status(200);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.flushHeaders();
}

/**
 * Write `{ request, longPoll }` as the complete body. After a header flush,
 * Express `res.json()` would try to set Content-Length and throw, so we write
 * compact JSON only — no preamble bytes the CLI `JSON.parse(text)` cannot accept.
 */
export function writeRunnerClaimBody(res: ClaimResponse, body: RunnerClaimResult): void {
  if (res.writableEnded) return;
  if (res.headersSent) {
    res.write(JSON.stringify(body));
    res.end();
    return;
  }
  res.json(body);
}

export async function sendRunnerClaimResponse({
  res,
  claim
}: {
  res: ClaimResponse;
  claim: (args: { onListenArmed: () => void }) => Promise<RunnerClaimResult>;
}): Promise<void> {
  let flushed = false;
  try {
    const result = await claim({
      onListenArmed: () => {
        flushRunnerClaimHeaders(res);
        flushed = true;
      }
    });
    writeRunnerClaimBody(res, result);
  } catch (error) {
    if (flushed && !res.writableEnded) {
      // Status is already 200; an empty claim lets the runner reconnect immediately.
      writeRunnerClaimBody(res, { request: null, longPoll: true });
      return;
    }
    throw error;
  }
}
