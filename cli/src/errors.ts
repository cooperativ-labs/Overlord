import { redactSecrets } from './redact-secrets.js';

export class CliError extends Error {
  readonly exitCode: number;
  /** The backend's JSON error body, when the error came from a backend response. */
  readonly payload: unknown;
  /** HTTP status of the backend response, when the error came from one. */
  readonly status: number | undefined;

  constructor({
    message,
    exitCode = 1,
    payload,
    status
  }: {
    message: string;
    exitCode?: number;
    payload?: unknown;
    status?: number;
  }) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.payload = payload;
    this.status = status;
  }
}

export const MISSION_SUMMARY_CONFLICT_CODE = 'mission_summary_conflict';

/**
 * The fresh mission summary baseline carried by a 409 `mission_summary_conflict`
 * from `publish-delivery-summary` (ADR 0076; a delivery is never rejected for
 * stale prose), printed to stdout so the agent can reconcile and retry once.
 */
export function missionSummaryConflictOutput(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof CliError) || !error.payload || typeof error.payload !== 'object') {
    return null;
  }
  const record = error.payload as Record<string, unknown>;
  if (record.code !== MISSION_SUMMARY_CONFLICT_CODE) return null;
  const details =
    record.details && typeof record.details === 'object'
      ? (record.details as Record<string, unknown>)
      : {};
  return {
    error: record.error ?? null,
    code: MISSION_SUMMARY_CONFLICT_CODE,
    missionSummary: details.missionSummary ?? null,
    ...(details.publication ? { publication: details.publication } : {}),
    ...(details.instruction ? { instruction: details.instruction } : {})
  };
}

const REPORT_DRAFT_ERROR_CODES = new Set([
  'report_draft_conflict',
  'report_draft_operation_conflict',
  'report_draft_sealed',
  'report_draft_limit_exceeded',
  'report_draft_not_found',
  'report_draft_forbidden'
]);

/**
 * A report-draft refusal (ADR 0078), printed to stdout with its details (for
 * a conflict: the current revision and the fresh draft) so the agent can
 * rebase its batch or delivery.
 */
export function reportDraftErrorOutput(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof CliError) || !error.payload || typeof error.payload !== 'object') {
    return null;
  }
  const record = error.payload as Record<string, unknown>;
  if (typeof record.code !== 'string' || !REPORT_DRAFT_ERROR_CODES.has(record.code)) return null;
  return {
    error: record.error ?? null,
    code: record.code,
    ...(record.details && typeof record.details === 'object'
      ? { details: record.details as Record<string, unknown> }
      : {})
  };
}

const FINALIZATION_ERROR_CODES = new Set([
  'delivery_already_accepted',
  'delivery_operation_conflict',
  'delivery_receipt_not_found',
  'mission_summary_publication_superseded',
  'mission_summary_already_published',
  'mission_summary_publication_not_found'
]);

/**
 * A finalization refusal (ADR 0075), printed to stdout so the agent sees the
 * already accepted delivery id instead of delivering again.
 */
export function finalizationErrorOutput(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof CliError) || !error.payload || typeof error.payload !== 'object') {
    return null;
  }
  const record = error.payload as Record<string, unknown>;
  if (typeof record.code !== 'string' || !FINALIZATION_ERROR_CODES.has(record.code)) return null;
  return {
    error: record.error ?? null,
    code: record.code,
    ...(record.details && typeof record.details === 'object'
      ? { details: record.details as Record<string, unknown> }
      : {})
  };
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
