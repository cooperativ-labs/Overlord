import type { SshConnectionConfig } from './types';

/**
 * Parse a free-form ssh command string — e.g. "ssh jake@example.com -p 2222" —
 * into a structured SshConnectionConfig. Returns null if the string does not parse.
 *
 * Used by the settings form to populate structured fields from the synthesised
 * sshCommand string (built at read-time from execution_targets /
 * execution_target_ssh_credentials).
 */
export function parseLegacySshCommand(
  value: string | null | undefined
): SshConnectionConfig | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/);
  if (tokens[0] === 'ssh') tokens.shift();

  let host = '';
  let user = '';
  let port: number | undefined;
  let privateKeyPath: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '-p' && tokens[i + 1]) {
      const parsed = Number.parseInt(tokens[i + 1], 10);
      if (Number.isFinite(parsed)) port = parsed;
      i++;
    } else if (token === '-i' && tokens[i + 1]) {
      privateKeyPath = tokens[i + 1];
      i++;
    } else if (!token.startsWith('-') && !host) {
      const at = token.indexOf('@');
      if (at > 0) {
        user = token.slice(0, at);
        host = token.slice(at + 1);
      } else {
        host = token;
      }
    }
  }

  if (!host) return null;

  return {
    host,
    port,
    user: user || 'root',
    authMethod: privateKeyPath ? 'key' : 'agent',
    privateKeyPath
  };
}
