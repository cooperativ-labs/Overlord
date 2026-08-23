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

export function formatCliError(error: unknown): string {
  if (error instanceof CliError) {
    return redactSecrets(error.message);
  }

  if (error instanceof Error) {
    return redactSecrets(error.message);
  }

  return redactSecrets(String(error));
}
