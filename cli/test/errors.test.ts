import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CliError,
  formatCliError,
  formatExecutionRequestAlreadyLinkedDiagnostic,
  isExecutionRequestAlreadyLinkedError,
  isExecutionRequestAlreadyLinkedPayload,
  isUnlinkableExecutionRequestError
} from '../src/errors.ts';

function assertAlreadyLinkedDiagnostic(message: string): void {
  assert.match(message, /already linked to another mission session/i);
  assert.match(message, /execution_request_already_linked/);
  assert.match(message, /resume-follow-up/);
  assert.doesNotMatch(message, /auth login|credentials were rejected/i);
}

test('already-linked execution-request diagnostic is distinct from authentication failure', () => {
  const diagnostic = formatExecutionRequestAlreadyLinkedDiagnostic();
  assertAlreadyLinkedDiagnostic(diagnostic);
  assert.equal(isExecutionRequestAlreadyLinkedError(new CliError({ message: diagnostic })), true);
  assert.equal(isUnlinkableExecutionRequestError(new CliError({ message: diagnostic })), false);
});

test('already-linked payload detection uses the backend error code', () => {
  assert.equal(
    isExecutionRequestAlreadyLinkedPayload({
      error: 'Execution request is already linked to another session',
      code: 'execution_request_already_linked'
    }),
    true
  );
  assert.equal(
    isExecutionRequestAlreadyLinkedPayload({
      error: 'Authentication required',
      code: 'unauthenticated'
    }),
    false
  );
  assert.equal(
    isExecutionRequestAlreadyLinkedError(
      new CliError({
        message:
          'Execution request is already linked to another session — (execution_request_already_linked)'
      })
    ),
    true
  );
  assert.equal(
    isExecutionRequestAlreadyLinkedError(
      new CliError({ message: 'Your saved credentials were rejected. Run `ovld auth login`.' })
    ),
    false
  );
});

test('formatCliError rewrites already-linked attach errors with recovery guidance', () => {
  const formatted = formatCliError(
    new Error('Execution request is already linked to another session')
  );
  assertAlreadyLinkedDiagnostic(formatted);
});
