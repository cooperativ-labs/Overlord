#!/usr/bin/env node
/**
 * Project the shared MCP tool catalog (`packages/contract/src/mcp-tools.ts`) into the
 * local connector shim (`connectors/core/scripts/overlord-mcp.mjs`).
 *
 * The shim is a standalone script installed into agent harness plugin directories, so it
 * cannot import `@overlord/contract` at runtime. Its `tools` array is therefore generated
 * between the BEGIN/END markers below and must never be edited by hand.
 *
 * The local projection omits `outputSchema`: the shim forwards Protocol output unchanged
 * (some subcommands return bare arrays), and a declared object output schema would make
 * strict MCP clients reject those results. The hosted server wraps non-object results
 * instead (see `jsonText` in mcp/server.ts).
 *
 * Usage:
 *   node --import tsx scripts/generate-mcp-tool-catalog.mts            # write
 *   node --import tsx scripts/generate-mcp-tool-catalog.mts --check    # drift check (writes nothing)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { overlordMcpToolDefinitions } from '../packages/contract/src/mcp-tools.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shimPath = path.join(repoRoot, 'connectors/core/scripts/overlord-mcp.mjs');

/** Rendered per adapter by cli/src/connector-core-render.ts. */
const ADAPTER_KEY_PLACEHOLDER = '__OVERLORD_ADAPTER_KEY__';

const BEGIN = '// BEGIN GENERATED MCP TOOL CATALOG';
const END = '// END GENERATED MCP TOOL CATALOG';
const BANNER =
  '// Generated from packages/contract/src/mcp-tools.ts — do not edit.\n' +
  '// Regenerate with `yarn connectors:mcp-tools`.';

export function localMcpToolDefinitions(): Array<Record<string, unknown>> {
  return overlordMcpToolDefinitions({ defaultAgent: ADAPTER_KEY_PLACEHOLDER }).map(
    ({ outputSchema: _outputSchema, ...tool }) => tool
  );
}

async function render(source: string): Promise<string> {
  const begin = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`${shimPath} is missing the ${BEGIN} / ${END} markers.`);
  }
  const block = `${BEGIN}\n${BANNER}\nconst tools = ${JSON.stringify(localMcpToolDefinitions(), null, 2)};\n`;
  const next = source.slice(0, begin) + block + source.slice(end);
  const config = await resolveConfig(shimPath);
  return format(next, { ...config, filepath: shimPath });
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const current = readFileSync(shimPath, 'utf8');
  const next = await render(current);
  const relative = path.relative(repoRoot, shimPath);
  if (current === next) {
    process.stdout.write(`MCP tool catalog check passed: ${relative} is current.\n`);
    return;
  }
  if (check) {
    process.stderr.write(
      `${relative} is out of date with packages/contract/src/mcp-tools.ts. Run \`yarn connectors:mcp-tools\`.\n`
    );
    process.exit(1);
  }
  writeFileSync(shimPath, next);
  process.stdout.write(`Updated ${relative}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
