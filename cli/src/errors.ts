import { redactSecrets } from './redact-secrets.js';

export class CliError extends Error {
  readonly exitCode: number;

  constructor({ message, exitCode = 1 }: { message: string; exitCode?: number }) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/**
 * Attach recovered an execution-request id from the launch script, but the
 * request is no longer linkable (cleared/failed/expired). The agent process is
 * already running — attach should still create an objective/session binding so
 * the capture hook can append exact ledger evidence.
 */
export function isUnlinkableExecutionRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('invalid_execution_request_transition');
}

export const EXECUTION_REQUEST_ALREADY_LINKED_CODE = 'execution_request_already_linked';

function trimmedStringField({
  record,
  key
}: {
  record: Record<string, unknown>;
  key: string;
}): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeAlreadyLinkedExecutionRequest({ text }: { text: string }): boolean {
  return (
    text.includes(EXECUTION_REQUEST_ALREADY_LINKED_CODE) ||
    /already linked to another(?: mission)? session/i.test(text)
  );
}

/**
 * True when a backend error payload reports that an execution request is
 * already bound to a different mission session.
 */
export function isExecutionRequestAlreadyLinkedPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (trimmedStringField({ record, key: 'code' }) === EXECUTION_REQUEST_ALREADY_LINKED_CODE) {
    return true;
  }
  const text = [
    trimmedStringField({ record, key: 'error' }),
    trimmedStringField({ record, key: 'message' }),
    trimmedStringField({ record, key: 'detail' })
  ].join(' ');
  return looksLikeAlreadyLinkedExecutionRequest({ text });
}

export function isExecutionRequestAlreadyLinkedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return looksLikeAlreadyLinkedExecutionRequest({ text: message });
}

/**
 * Attach was rejected because the launch execution request is already bound to
 * another session. Agents otherwise treat the word "session" as an auth/session
 * failure and run `ovld auth repair`. This diagnostic must stay distinct from
 * credential rejection and must tell the caller how to continue.
 */
export function formatExecutionRequestAlreadyLinkedDiagnostic(): string {
  return [
    'Attach was rejected because this execution request is already linked to another mission session (`execution_request_already_linked`).',
    'This is a stale mission-session binding, not a user authentication failure. Do not run `ovld auth login` or `ovld auth repair`.',
    'Recovery: retry `ovld protocol attach` without `--execution-request-id` (unset OVERLORD_EXECUTION_REQUEST_ID). The existing session remains bound to the request; a new attach can continue the objective without relinking it.'
  ].join('\n');
}

export function formatCliError(error: unknown): string {
  if (isExecutionRequestAlreadyLinkedError(error)) {
    return redactSecrets(formatExecutionRequestAlreadyLinkedDiagnostic());
  }

  if (error instanceof CliError) {
    return redactSecrets(error.message);
  }

  if (error instanceof Error) {
    return redactSecrets(error.message);
  }

  return redactSecrets(String(error));
}
