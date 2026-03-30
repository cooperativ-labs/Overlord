/**
 * Shell utility functions for parsing and escaping SSH commands.
 * Shared between Electron IPC handlers and server-side code.
 */

export function parseShellCommand(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < command.length) {
    const ch = command[i] ?? '';
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === '\\' && !inSingle && i + 1 < command.length) {
      i += 1;
      current += command[i] ?? '';
    } else if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current) {
        result.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
    i += 1;
  }
  if (current) result.push(current);
  return result;
}

export function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
