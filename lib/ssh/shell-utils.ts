export function parseShellCommand(command: string): string[] {
  const input = command.trim();
  if (!input) return [];

  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && quote === null) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped) {
    current += '\\';
  }

  if (quote !== null) {
    throw new Error('Unterminated quoted string in shell command.');
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

export function parseSshCommand(command: string, options: { forceTty?: boolean } = {}): string[] {
  const parts = parseShellCommand(command);
  if (parts.length === 0) {
    throw new Error('SSH command is required.');
  }

  if (!options.forceTty) return parts;

  const hasTtyFlag = parts.some(part => part === '-t' || part === '-tt' || /^-.*t.*$/.test(part));
  if (hasTtyFlag) return parts;

  const [binary, ...rest] = parts;
  return [binary!, '-tt', ...rest];
}

export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildRemoteTmuxCommand(innerCommand: string, tmuxCommand?: string | null): string {
  const template =
    typeof tmuxCommand === 'string' && tmuxCommand.trim().includes('{script}')
      ? tmuxCommand.trim()
      : 'tmux new-session bash {script}';
  const replacement = template.includes('bash {script}')
    ? `-lc ${shellEscape(innerCommand)}`
    : shellEscape(`bash -lc ${shellEscape(innerCommand)}`);
  return template.replaceAll('{script}', replacement);
}
