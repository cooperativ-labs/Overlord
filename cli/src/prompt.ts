import { CliError } from './errors.js';

/**
 * Ask one line on the terminal, returning `defaultValue` for an empty answer.
 * Refuses without a TTY, using the caller's `nonInteractiveMessage` to name the
 * non-interactive alternative for that command.
 */
export async function promptLine({
  message,
  defaultValue,
  nonInteractiveMessage
}: {
  message: string;
  defaultValue?: string;
  nonInteractiveMessage: string;
}): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new CliError({ message: nonInteractiveMessage });
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = await rl.question(`${message}${suffix}: `);
    return answer.trim() || defaultValue || '';
  } finally {
    rl.close();
  }
}
