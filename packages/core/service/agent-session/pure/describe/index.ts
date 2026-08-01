import { describeFetch } from './fetch.js';
import { describeGeneric } from './generic.js';
import { describeMcp } from './mcp.js';
import { describeRead } from './read.js';
import { describeShell } from './shell.js';
import { type DescribeInput, type Description, type Formatter } from './types.js';
import { describeWrite } from './write.js';

/**
 * The formatter registry, keyed by **normalized** tool name.
 *
 * Keying on the normalized name rather than the native one is the reason there is one shell
 * formatter instead of five. `Bash` in one harness, `bash` in another, `Shell` in a third,
 * `shell_command` in a fourth — all the same conceptual tool, and all the same risks. Core owns
 * the formatter; adapters own the mapping into it (`tool-normalize.ts`).
 */
const FORMATTERS: Record<string, Formatter> = {
  shell: describeShell,
  write: describeWrite,
  edit: describeWrite,
  read: describeRead,
  fetch: describeFetch,
  mcp: describeMcp
};

/**
 * Describe a tool call, never throwing.
 *
 * The try/catch is load-bearing rather than defensive habit. This function runs inside a held
 * permission decision: an exception here would either block an agent or, worse, be caught
 * somewhere that decided to approve rather than defer. A formatter failure degrades to the
 * generic structural card — still safe, still decidable — and the degradation is visible in the
 * card's own action text so nobody mistakes it for a considered summary.
 */
export function describe(input: DescribeInput): Description {
  const formatter = FORMATTERS[input.tool];
  if (!formatter) return describeGeneric(input);
  try {
    return formatter(input);
  } catch {
    const fallback = describeGeneric(input);
    return { ...fallback, action: `${fallback.action} (description unavailable)` };
  }
}

export { describeFetch, describeGeneric, describeMcp, describeRead, describeShell, describeWrite };
export * from './types.js';
