#!/usr/bin/env node

// `yarn server:deploy`: deploys the Overlord Cloud backend with `railway up`,
// behind the release gate (contract/CONTRACT.md section 5, ADR 0052). It
// refuses unless the working tree is clean and `.release/preflight.json` names
// HEAD, so what Railway builds is exactly the commit preflight checked.
//
// `railway up` uploads the working directory (respecting .gitignore) to the
// service the directory is linked to (`railway link`); the overlord-backend
// service builds it with backend/Dockerfile.railway (.railway/railway.ts).
// Every argument except this wrapper's own flags is passed to `railway up`
// unchanged; arguments after `--` are passed verbatim.
//
// The `railway` command is the Railway CLI on PATH, not the `railway` npm
// devDependency (the TypeScript SDK behind .railway/railway.ts, whose only bin
// is railway-iac-ts). OVERLORD_RAILWAY_BIN overrides the executable.
//
//   yarn server:deploy [--dry-run] [--skip-release-gate] [railway up arguments…]

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  enforceReleaseGate,
  fail,
  gitClient,
  SKIP_GATE_ENV,
  SKIP_GATE_FLAG
} from './release-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseDeployArgs(argv) {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const verbatim = separator === -1 ? [] : argv.slice(separator + 1);
  const options = { dryRun: false, help: false, gateArgs: [], railwayArgs: [] };
  for (const token of own) {
    if (token === '--dry-run') options.dryRun = true;
    else if (token === '--help') options.help = true;
    else if (token === SKIP_GATE_FLAG) options.gateArgs.push(token);
    else options.railwayArgs.push(token);
  }
  options.railwayArgs.push(...verbatim);
  return options;
}

export function railwayCommand({ env = process.env, railwayArgs }) {
  return { file: env.OVERLORD_RAILWAY_BIN || 'railway', args: ['up', ...railwayArgs] };
}

const HELP = `Deploy the Overlord Cloud backend with railway up, behind the release gate.

Usage:
  yarn server:deploy [railway up arguments…]
  yarn server:deploy --dry-run
  yarn server:deploy -- --service overlord-backend

Flags:
  --dry-run            Check the gate and print the railway command without running it
  ${SKIP_GATE_FLAG}  Emergency only: deploy without a matching preflight stamp
                       (also ${SKIP_GATE_ENV}=1)

Every other argument is passed to railway up. See contract/releases/README.md.
`;

export function main({
  argv = process.argv.slice(2),
  env = process.env,
  root = ROOT,
  git = gitClient({ cwd: root }),
  spawn = spawnSync,
  log = message => process.stdout.write(`${message}\n`)
} = {}) {
  const options = parseDeployArgs(argv);
  if (options.help) {
    log(HELP);
    return { ran: false };
  }
  enforceReleaseGate({
    step: 'server:deploy',
    argv: options.gateArgs,
    env,
    dryRun: options.dryRun,
    root,
    git
  });
  const command = railwayCommand({ env, railwayArgs: options.railwayArgs });
  const printable = [command.file, ...command.args].join(' ');
  if (options.dryRun) {
    log(`Dry run: no deployment was made. Resolved command: ${printable}`);
    return { ran: false, command };
  }
  log(`\n→ ${printable}`);
  const result = spawn(command.file, command.args, { cwd: root, stdio: 'inherit', env });
  if (result.error?.code === 'ENOENT') {
    fail(
      `${command.file} was not found. Install the Railway CLI (it is not the railway npm ` +
        'devDependency) and link this directory to the overlord-backend service with railway link.'
    );
  }
  if (result.status !== 0) fail(`${printable} failed (exit ${result.status ?? result.signal}).`);
  return { ran: true, command };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`\n✖ ${error.message}\n`);
    process.exitCode = 1;
  }
}
