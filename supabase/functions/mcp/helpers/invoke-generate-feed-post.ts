// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from '@supabase/supabase-js';

function edgeRuntimeWaitUntil(): ((promise: Promise<unknown>) => void) | null {
  const g = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  };
  return g.EdgeRuntime?.waitUntil.bind(g.EdgeRuntime) ?? null;
}

/**
 * Matches Next.js protocol routes: after agent delivery or a review-type status
 * transition, synthesize a feed post from DB-backed ticket context (no local repo).
 * Non-blocking so MCP tool responses are not held on Gemini latency.
 */
export function scheduleGenerateFeedPost(options: {
  supabase: SupabaseClient;
  ticketId: string;
  sessionId: string;
  organizationId: number;
  logPrefix: string;
}): void {
  const { supabase, ticketId, sessionId, organizationId, logPrefix } = options;

  const promise = (async () => {
    try {
      const { error } = await supabase.functions.invoke('generate-feed-post', {
        body: { ticketId, sessionId, organizationId }
      });
      if (error) {
        console.error(`${logPrefix} feed post generation failed:`, error.message);
      }
    } catch (err) {
      console.error(`${logPrefix} feed post generation error:`, err);
    }
  })();

  const waitUntil = edgeRuntimeWaitUntil();
  if (waitUntil) {
    waitUntil(promise);
  } else {
    void promise.catch(err => console.error(`${logPrefix} feed post (unwaited) error:`, err));
  }
}
