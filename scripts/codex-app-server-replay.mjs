#!/usr/bin/env node
/**
 * Fixture driver for `connectors/adapters/codex-app-server/fixtures/replay-*.json`.
 *
 * Runs the shipped Codex app-server supervisor (`cli/src/agent-session/codex-app-server/`)
 * against a fake app server that replays recorded frames, and prints every message the
 * supervisor sends as one JSON line, so a `script-io` fixture can assert the exact JSON-RPC
 * reply bytes and channel calls. Reads the replay script as NDJSON on stdin (first line
 * `{"setup":…}`, then steps; see `replay.ts`). No network, no process spawn, no file writes.
 *
 * It loads the TypeScript sources through tsx with `scripts/codex-app-server.tsconfig.json`,
 * which maps `@overlord/core/*` to the package sources, so the fixture never depends on a
 * built `dist/`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { register } from 'tsx/esm/api';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
register({ tsconfig: path.join(repoRoot, 'scripts', 'codex-app-server.tsconfig.json') });

const lines = readFileSync(0, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)
  .map(line => JSON.parse(line));
const [first, ...steps] = lines;
if (!first?.setup) {
  process.stderr.write('replay: first line must be {"setup": …}\n');
  process.exit(2);
}

const { runReplay } = await import(
  pathToFileURL(path.join(repoRoot, 'cli/src/agent-session/codex-app-server/replay.ts')).href
);
const outputs = await runReplay({ setup: first.setup, steps, repoRoot });
for (const output of outputs) process.stdout.write(`${JSON.stringify(output)}\n`);
process.exit(0);
