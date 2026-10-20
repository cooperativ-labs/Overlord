/** Check the installed Claude plugin shape without installing into the user's home. */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { resolveManagedFileContents } from '../cli/src/connector-core-render.ts';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--eval') || args.length > 1) {
  throw new Error('Usage: node --import tsx scripts/check-claude-plugin.mts [--eval]');
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repo, 'connectors/adapters/claude');
const coreRoot = path.join(repo, 'connectors/core/overlord-mission');
const manifest = parseYaml(readFileSync(path.join(sourceDir, 'conformance-manifest.yaml'), 'utf8'));
const scratch = mkdtempSync(path.join(tmpdir(), 'overlord-claude-plugin-'));
const plugin = path.join(scratch, 'plugin with spaces');

// Clear mission credentials and launch identity before invoking Claude tooling.
const env: NodeJS.ProcessEnv = {
  ...process.env,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1'
};
for (const key of Object.keys(env)) {
  if (
    /^(OVERLORD_|Overlord_|OVLD_|CLAUDE_PLUGIN_OPTION_)/.test(key) ||
    ['MISSION_ID', 'SESSION_KEY', 'CLAUDECODE'].includes(key)
  )
    delete env[key];
}

function run(commandArgs: string[]): number {
  const result = spawnSync('claude', commandArgs, {
    cwd: scratch,
    env,
    stdio: 'inherit',
    timeout: args.includes('--eval') ? 900_000 : 120_000
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  for (const relativePath of manifest.connector.managedFiles as string[]) {
    const target = path.resolve(plugin, relativePath);
    if (!target.startsWith(`${plugin}${path.sep}`))
      throw new Error(`Invalid managed path: ${relativePath}`);
    const contents = resolveManagedFileContents({
      sourceDir,
      relativePath,
      adapterKey: 'claude',
      coreRoot
    });
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
    if (relativePath.endsWith('.sh')) chmodSync(target, 0o755);
  }
  // Evals are test inputs, not installed connector files.
  cpSync(path.join(repo, 'test/fixtures/claude-plugin-evals'), path.join(plugin, 'evals'), {
    recursive: true
  });
  process.exitCode = run(['plugin', 'validate', plugin, '--strict']);
  if (!process.exitCode) {
    // plugin test runs mods' .test.ts/.test.tsx handlers. This shell-hook plugin has no mod.
    process.stdout.write(
      'plugin test: not applicable (no mod handlers); hook fixtures run in connectors:capabilities:check.\n'
    );
    if (args.includes('--eval')) {
      const outputDir = path.resolve(
        process.env.CLAUDE_PLUGIN_REPORT_DIR ??
          mkdtempSync(path.join(tmpdir(), 'overlord-claude-eval-report-'))
      );
      mkdirSync(outputDir, { recursive: true });
      process.stdout.write(`Claude eval reports: ${outputDir}\n`);
      process.exitCode = run([
        'plugin',
        'eval',
        plugin,
        '--trust-plugin',
        '--no-publish',
        '--no-scaffold',
        '--ablation',
        'none',
        '--runs',
        '1',
        '--concurrency',
        '1',
        '--threshold',
        '1',
        '--max-cost-usd',
        '2',
        '--mocks',
        'record',
        '--output-dir',
        outputDir
      ]);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
