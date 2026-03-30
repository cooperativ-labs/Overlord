"use strict";
/**
 * Shell utility functions for parsing and escaping SSH commands.
 * Shared between Electron IPC handlers and server-side code.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseShellCommand = parseShellCommand;
exports.parseSshCommand = parseSshCommand;
exports.shellEscape = shellEscape;
function parseShellCommand(command) {
    const result = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let i = 0;
    while (i < command.length) {
        const ch = command[i] ?? '';
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
        }
        else if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
        }
        else if (ch === '\\' && !inSingle && i + 1 < command.length) {
            i += 1;
            current += command[i] ?? '';
        }
        else if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
            if (current) {
                result.push(current);
                current = '';
            }
        }
        else {
            current += ch;
        }
        i += 1;
    }
    if (current)
        result.push(current);
    return result;
}
function isSshBinary(value) {
    return value === 'ssh' || value?.endsWith('/ssh') === true;
}
function isLikelySshDestination(value) {
    // Accept common shorthand forms like "host", "user@host", "1.2.3.4",
    // and bracketed IPv6 hosts while avoiding shell commands/paths.
    return (value.length > 0 &&
        !value.includes('/') &&
        !value.includes('\\') &&
        !/['"`$&|;()<>{}\s]/.test(value));
}
function parseSshCommand(command, options) {
    const rawParts = parseShellCommand(command.trim());
    if (rawParts.length === 0)
        return [];
    const normalizedParts = isSshBinary(rawParts[0]) || !isLikelySshDestination(rawParts[0] ?? '')
        ? [...rawParts]
        : ['ssh', ...rawParts];
    if (options?.forceTty && isSshBinary(normalizedParts[0])) {
        if (!normalizedParts.some(part => /^-[A-Za-z]*t/.test(part))) {
            normalizedParts.splice(1, 0, '-tt');
        }
    }
    return normalizedParts;
}
function shellEscape(value) {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}
//# sourceMappingURL=shell-utils.js.map