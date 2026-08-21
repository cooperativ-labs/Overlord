import { redactSecrets } from './agent-session/pure/redact.js';

/**
 * Queue hold reasons are rendered in the browser and copied into activity
 * diagnostics. Keep the policy in one place so dispatch errors cannot expose
 * credentials merely because they took a different failure path.
 */
export function sanitizeDispatchFailure(error: unknown, limit = 400): string | null {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  if (!message) return null;
  return redactSecrets(message).text.slice(0, limit).trim() || null;
}

export type RunQueueDiagnosticCode = 'terminal_request_dispatched' | 'running_without_live_request';

export function runQueueDiagnosticCode(input: {
  entryState: 'waiting' | 'blocked' | 'dispatched' | 'running';
  requestStatus: string | null;
  launchedSessionId: string | null;
}): RunQueueDiagnosticCode | null {
  const terminal = new Set(['failed', 'cleared', 'cancelled', 'expired']);
  if (input.entryState === 'dispatched' && input.requestStatus && terminal.has(input.requestStatus))
    return 'terminal_request_dispatched';
  if (
    input.entryState === 'running' &&
    (!input.requestStatus || (terminal.has(input.requestStatus) && !input.launchedSessionId))
  )
    return 'running_without_live_request';
  return null;
}
