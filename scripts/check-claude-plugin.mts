/**
 * Check the installed Claude plugin shape without installing into the user's home.
 *
 * Renders the plugin exactly as `ovld agent-setup claude` installs it, inside a local marketplace
 * built by the same `buildClaudeMarketplaceManifest` the installer uses, then runs
 * `claude plugin validate --strict` on both the plugin and the marketplace. Before that it
 * asserts, without Claude Code, that `engines["claude-code"]` matches the adapter descriptor's
 * `versionRange` and that neither manifest uses the deprecated `pluginDigests`.
 *
 * Skips the Claude Code steps cleanly (exit 0) when `claude` is not on PATH or is older than
 * the descriptor's minimum, so `yarn connectors:check` still runs on machines and CI images
 * without Claude Code. Set OVERLORD_REQUIRE_CLAUDE_VALIDATE=1 to make that a failure.
 */
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

import { compareSemver, parseClaudeVersion } from '../cli/src/claude-hook-health.ts';
import { resolveManagedFileContents } from '../cli/src/connector-core-render.ts';
import { buildClaudeMarketplaceManifest } from '../cli/src/connectors.ts';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--eval') || args.length > 1) {
  throw new Error('Usage: node --import tsx scripts/check-claude-plugin.mts [--eval]');
}
const requireClaude = process.env.OVERLORD_REQUIRE_CLAUDE_VALIDATE === '1';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repo, 'connectors/adapters/claude');
const coreRoot = path.join(repo, 'connectors/core/overlord-mission');
const manifest = parseYaml(readFileSync(path.join(sourceDir, 'conformance-manifest.yaml'), 'utf8'));
const descriptor = parseYaml(
  readFileSync(path.join(sourceDir, 'harness-capabilities.yaml'), 'utf8')
) as { harness: { versionRange?: string } };

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

/** Static checks that need no Claude Code. Returns the failures. */
function checkManifests(
  pluginManifest: Record<string, unknown>,
  marketplaceManifest: Record<string, unknown>
): string[] {
  const failures: string[] = [];
  const engine = (pluginManifest.engines as Record<string, unknown> | undefined)?.['claude-code'];
  const range = descriptor.harness.versionRange;
  if (!range || !/^>=\s*\d+\.\d+\.\d+$/.test(range)) {
    failures.push(`harness-capabilities.yaml versionRange must be a ">=X.Y.Z" floor, got ${range}`);
  } else if (engine !== range) {
    failures.push(
      `plugin.json engines["claude-code"] is ${JSON.stringify(engine)}; it must equal the ` +
        `descriptor versionRange "${range}".`
    );
  }
  for (const [name, value] of [
    ['plugin.json', pluginManifest],
    ['marketplace.json', marketplaceManifest]
  ] as const) {
    if (JSON.stringify(value).includes('"pluginDigests"')) {
      failures.push(`${name} uses the deprecated pluginDigests field.`);
    }
  }
  return failures;
}

/** Why Claude Code validation cannot run here, or null when it can. */
function claudeUnavailableReason(): string | null {
  const result = spawnSync('claude', ['--version'], { env, encoding: 'utf8', timeout: 60_000 });
  if (result.error) {
    return (result.error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'the `claude` CLI is not on PATH'
      : `\`claude --version\` failed: ${result.error.message}`;
  }
  const version = result.status === 0 ? parseClaudeVersion(result.stdout) : null;
  if (!version) return '`claude --version` printed no version';
  const minimum = /^>=\s*(\d+\.\d+\.\d+)$/.exec(descriptor.harness.versionRange ?? '')?.[1];
  if (minimum && compareSemver(version, minimum) < 0) {
    return `Claude Code ${version} is older than ${minimum}, the plugin's minimum`;
  }
  return null;
}

const scratch = mkdtempSync(path.join(tmpdir(), 'overlord-claude-plugin-'));
// Spaces in both the marketplace root and the plugin path exercise path quoting.
const marketplaceRoot = path.join(scratch, 'market place');
const plugin = path.join(marketplaceRoot, 'plugins', 'overlord');

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

let validated = false;
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
  const relativeSource = `./${path.relative(marketplaceRoot, plugin).split(path.sep).join('/')}`;
  const marketplaceManifest = buildClaudeMarketplaceManifest(relativeSource);
  mkdirSync(path.join(marketplaceRoot, '.claude-plugin'), { recursive: true });
  writeFileSync(
    path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
    `${JSON.stringify(marketplaceManifest, null, 2)}\n`
  );

  const failures = checkManifests(
    JSON.parse(readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')),
    marketplaceManifest
  );
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`✘ ${failure}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `✔ engines["claude-code"] matches versionRange ${descriptor.harness.versionRange}; no pluginDigests.\n`
    );
    const unavailable = claudeUnavailableReason();
    if (unavailable) {
      const message = `claude plugin validate --strict skipped: ${unavailable}.\n`;
      if (requireClaude) {
        process.stderr.write(`✘ ${message}`);
        process.exitCode = 1;
      } else {
        process.stdout.write(message);
      }
    } else {
      // Evals are test inputs, not installed connector files; copy them after the static checks.
      cpSync(path.join(repo, 'test/fixtures/claude-plugin-evals'), path.join(plugin, 'evals'), {
        recursive: true
      });
      process.exitCode =
        run(['plugin', 'validate', plugin, '--strict']) ||
        run(['plugin', 'validate', marketplaceRoot, '--strict']);
      validated = !process.exitCode;
    }
  }
  if (validated) {
    // plugin test runs mods' .test.ts/.test.tsx handlers. This plugin's hooks are mcp_tool hooks, not mods.
    process.stdout.write(
      'plugin test: not applicable (no mod handlers); hook fixtures run in connectors:capabilities:check and cli/test/claude-hook-tools.test.ts.\n'
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
