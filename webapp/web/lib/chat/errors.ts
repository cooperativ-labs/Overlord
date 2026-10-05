import type { ChatErrorCode } from '@overlord/contract';

import { ApiRequestError } from '../api/request.ts';

const MESSAGES: Partial<Record<ChatErrorCode, string>> = {
  chat_unavailable: 'Chat is not available on this backend.',
  not_found: 'This conversation is not available.',
  invalid_request: 'The request was not accepted.',
  run_in_progress: 'The assistant is still working on the previous message.',
  stale_revision: 'This changed in the meantime. The latest version is shown.',
  proposal_not_creatable:
    'This proposal can no longer be created. Ask the assistant to prepare it again.',
  continue_not_available: 'This request cannot be continued.',
  source_access_lost: 'Access to a source this relied on was lost.',
  provider_not_ready: 'The assistant is not configured on this server yet.',
  connection_reauthorization_required: 'Sign in to the Knowledgebase again to continue.',
  limit_exceeded: 'Too many requests are running. Try again shortly.'
};

export function chatErrorCode(error: unknown): string | undefined {
  return error instanceof ApiRequestError ? error.code : undefined;
}

export function chatErrorMessage(error: unknown): string {
  const code = chatErrorCode(error) as ChatErrorCode | undefined;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error instanceof ApiRequestError) return error.message;
  return 'Could not reach the server. Retrying keeps the same request, so nothing is duplicated.';
}

/**
 * True when the outcome is unknown (network failure, 5xx, rate limit), so the
 * caller must keep the request id and retry with it. A definitive 4xx answer
 * means the server decided; the id can be discarded.
 */
export function isRetryableChatError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status >= 500 || error.status === 429;
}
