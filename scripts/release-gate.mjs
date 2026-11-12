#!/usr/bin/env node

// Release gate for Overlord's manual release (contract/CONTRACT.md section 5,
// "Release gate"; ADR 0052). A release is always of a committed SHA with a clean
// tree. The owner runs, in order:
//
//   yarn release:preflight <none|patch|minor|major>   checks, then writes the stamp
//   yarn cli:publish / yarn desktop:publish / yarn server:deploy
//                                                     each refuses without a stamp for HEAD
//   yarn release:finish                               moves `production`, fast-forwards `prod`
//
// The stamp `.release/preflight.json` is untracked (.gitignore). Before the first
// `production` tag exists, the range starts at the SHA recorded in
// contract/releases/baseline.json. The procedure is contract/releases/README.md.
//
// This module is dependency-free, like scripts/contract-impact.mjs, and every
// function that touches git or the file system takes its collaborators as
// arguments so scripts/release-gate.test.mjs can drive it.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  checkContractRange,
  CONTRACT_IMPACTS,
  gitRepository,
  parseContractImpact
} from './contract-impact.mjs';
import { CONTRACT_PATHS, isStrictSemver, openapiInfoVersion } from './version-contract.mjs';

export const RELEASE_TAG = 'production';
export const RELEASE_BRANCH = 'prod';
export const DEFAULT_REMOTE = 'origin';
export const STAMP_PATH = '.release/preflight.json';
export const STAMP_SCHEMA_VERSION = 1;
export const BASELINE_PATH = 'contract/releases/baseline.json';
export const SKIP_GATE_FLAG = '--skip-release-gate';
export const SKIP_GATE_ENV = 'OVERLORD_SKIP_RELEASE_GATE';
// Mechanical checks preflight runs, in order, before the range check.
export const PREFLIGHT_CHECKS = Object.freeze([
  ['contract:check'],
  ['api:generate:check'],
  ['check:conformance-versions']
]);

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class ReleaseGateError extends Error {}

export function fail(message) {
  throw new ReleaseGateError(message);
}

// ---------------------------------------------------------------------------
// Argument parsing

export function parsePreflightArgs(argv) {
  const options = { impact: null, dryRun: false, remote: DEFAULT_REMOTE };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
    } else if (token === '--remote') {
      options.remote = argv[(index += 1)] ?? fail('Missing value for --remote.');
    } else if (token.startsWith('-')) {
      fail(`Unknown argument: ${token}`);
    } else if (options.impact === null) {
      options.impact = parseContractImpact(token);
    } else {
      fail(`Unexpected argument: ${token}`);
    }
  }
  if (options.impact === null) {
    fail(
      `Declare the contract impact of the release: yarn release:preflight <${CONTRACT_IMPACTS.join('|')}> [--dry-run]`
    );
  }
  return options;
}

export function parseFinishArgs(argv) {
  const options = { dryRun: false, remote: DEFAULT_REMOTE };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      options.dryRun = true;
    } else if (token === '--remote') {
      options.remote = argv[(index += 1)] ?? fail('Missing value for --remote.');
    } else {
      fail(`Unknown argument: ${token}`);
    }
  }
  return options;
}

// Removes the escape-hatch flag from a publish script's arguments so the
// script's own parser never sees it, and reports whether the gate is skipped.
export function extractGateOverride(argv, env = {}) {
  const args = argv.filter(token => token !== SKIP_GATE_FLAG);
  const byFlag = args.length !== argv.length;
  const byEnv = env[SKIP_GATE_ENV] === '1';
  return {
    args,
    skip: byFlag || byEnv,
    reason: byFlag ? SKIP_GATE_FLAG : byEnv ? `${SKIP_GATE_ENV}=1` : null
  };
}

// ---------------------------------------------------------------------------
// Stamp

export function createStamp({
  sha,
  impact,
  contractVersion,
  openapiVersion,
  rangeStart,
  rangeStartSource,
  now = new Date()
}) {
  return {
    schemaVersion: STAMP_SCHEMA_VERSION,
    sha,
    impact,
    contractVersion,
    openapiInfoVersion: openapiVersion,
    rangeStart,
    rangeStartSource,
    createdAt: now.toISOString()
  };
}

export function stampErrors(stamp) {
  if (typeof stamp !== 'object' || stamp === null || Array.isArray(stamp)) {
    return ['the stamp is not a JSON object'];
  }
  const errors = [];
  if (stamp.schemaVersion !== STAMP_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${STAMP_SCHEMA_VERSION}`);
  }
  if (!FULL_SHA_PATTERN.test(String(stamp.sha))) errors.push('sha must be a full commit SHA');
  if (!CONTRACT_IMPACTS.includes(stamp.impact))
    errors.push(`impact must be one of ${CONTRACT_IMPACTS.join(', ')}`);
  if (!isStrictSemver(stamp.contractVersion))
    errors.push('contractVersion must be strict Semantic Versioning');
  if (!isStrictSemver(stamp.openapiInfoVersion)) {
    errors.push('openapiInfoVersion must be strict Semantic Versioning');
  }
  if (!FULL_SHA_PATTERN.test(String(stamp.rangeStart)))
    errors.push('rangeStart must be a full commit SHA');
  if (stamp.rangeStartSource !== 'production-tag' && stamp.rangeStartSource !== 'baseline') {
    errors.push('rangeStartSource must be production-tag or baseline');
  }
  if (typeof stamp.createdAt !== 'string' || Number.isNaN(Date.parse(stamp.createdAt))) {
    errors.push('createdAt must be an ISO 8601 timestamp');
  }
  return errors;
}

export function writeStamp(root, stamp) {
  const target = path.join(root, STAMP_PATH);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(stamp, null, 2)}\n`);
  renameSync(temporary, target);
  return target;
}

// Returns the parsed stamp, or null when there is none. A stamp that exists but
// cannot be parsed or is malformed is an error, never silently ignored.
export function readStamp(root) {
  const target = path.join(root, STAMP_PATH);
  if (!existsSync(target)) return null;
  let stamp;
  try {
    stamp = JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    fail(`${STAMP_PATH} is not valid JSON (${error.message}); run yarn release:preflight again.`);
  }
  const errors = stampErrors(stamp);
  if (errors.length > 0) {
    fail(`${STAMP_PATH} is malformed (${errors.join('; ')}); run yarn release:preflight again.`);
  }
  return stamp;
}

// Returns undefined when the stamp authorises releasing `head`, otherwise why not.
export function stampMismatch(stamp, head) {
  if (stamp === null) {
    return `No release stamp (${STAMP_PATH}). Run yarn release:preflight <none|patch|minor|major> first.`;
  }
  if (stamp.sha !== head) {
    return (
      `The release stamp is for ${stamp.sha}, but HEAD is ${head}. ` +
      'Run yarn release:preflight again for the commit you are releasing.'
    );
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Working tree

// `porcelain` is the output of `git status --porcelain=v1 --untracked-files=all`.
export function dirtyTreeError(porcelain) {
  const lines = String(porcelain)
    .split('\n')
    .filter(line => line.trim() !== '');
  if (lines.length === 0) return undefined;
  const shown = lines.slice(0, 10).map(line => `  ${line}`);
  if (lines.length > shown.length) shown.push(`  … and ${lines.length - shown.length} more`);
  return (
    'The working tree is not clean. A release is always of a committed SHA with a clean tree; ' +
    `commit or remove these first:\n${shown.join('\n')}`
  );
}

// ---------------------------------------------------------------------------
// Range start

export function baselineErrors(baseline) {
  if (typeof baseline !== 'object' || baseline === null || Array.isArray(baseline)) {
    return ['must be a JSON object'];
  }
  const errors = [];
  if (!FULL_SHA_PATTERN.test(String(baseline.rangeStart)))
    errors.push('rangeStart must be a full commit SHA');
  if (!isStrictSemver(baseline.rangeStartContractVersion)) {
    errors.push('rangeStartContractVersion must be strict Semantic Versioning');
  }
  if (!isStrictSemver(baseline.baselineContractVersion)) {
    errors.push('baselineContractVersion must be strict Semantic Versioning');
  }
  return errors;
}

export function readBaseline(root) {
  const target = path.join(root, BASELINE_PATH);
  if (!existsSync(target)) return null;
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    fail(`${BASELINE_PATH} is not valid JSON: ${error.message}`);
  }
  const errors = baselineErrors(baseline);
  if (errors.length > 0) fail(`${BASELINE_PATH} is malformed: ${errors.join('; ')}`);
  return baseline;
}

// The range starts at the remote `production` tag. Before that tag exists, it
// starts at the SHA recorded in contract/releases/baseline.json. A local tag
// that disagrees with the remote one, or exists while the remote one does not,
// is refused: the remote tag is the record of what was released.
export function selectRangeStart({ remoteTagSha, localTagSha, baseline, remote = DEFAULT_REMOTE }) {
  if (remoteTagSha) {
    if (localTagSha && localTagSha !== remoteTagSha) {
      fail(
        `The local ${RELEASE_TAG} tag (${localTagSha}) differs from ${remote}'s (${remoteTagSha}). ` +
          `Run: git fetch ${remote} +refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}`
      );
    }
    return { sha: remoteTagSha, source: 'production-tag' };
  }
  if (localTagSha) {
    fail(
      `A local ${RELEASE_TAG} tag (${localTagSha}) exists but ${remote} has none. ` +
        `Only yarn release:finish places the tag; delete the local one with git tag -d ${RELEASE_TAG}.`
    );
  }
  if (baseline) return { sha: baseline.rangeStart, source: 'baseline' };
  fail(`${remote} has no ${RELEASE_TAG} tag and ${BASELINE_PATH} records no range start.`);
}

// ---------------------------------------------------------------------------
// Git

function defaultExec({ file, args, cwd }) {
  return execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Parses `git ls-remote` output for one ref, preferring the peeled commit of an
// annotated tag.
export function parseLsRemote(output, ref) {
  let direct = null;
  let peeled = null;
  for (const line of String(output).split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (!sha || !name) continue;
    if (name === ref) direct = sha;
    if (name === `${ref}^{}`) peeled = sha;
  }
  return peeled ?? direct;
}

export function gitClient({ cwd = ROOT, exec = defaultExec } = {}) {
  const git = (...args) => String(exec({ file: 'git', args, cwd }));
  const tryGit = (...args) => {
    try {
      return git(...args);
    } catch {
      return null;
    }
  };
  return {
    cwd,
    git,
    head() {
      const sha = tryGit('rev-parse', '--verify', 'HEAD^{commit}')?.trim();
      if (!sha || !FULL_SHA_PATTERN.test(sha))
        fail('HEAD is not a commit. Commit the release first.');
      return sha;
    },
    status() {
      return git('status', '--porcelain=v1', '--untracked-files=all');
    },
    currentBranch() {
      return tryGit('symbolic-ref', '--quiet', '--short', 'HEAD')?.trim() || null;
    },
    hasCommit(sha) {
      return tryGit('cat-file', '-e', `${sha}^{commit}`) !== null;
    },
    isAncestor(ancestor, descendant) {
      return tryGit('merge-base', '--is-ancestor', ancestor, descendant) !== null;
    },
    localRef(ref) {
      return tryGit('rev-parse', '-q', '--verify', `${ref}^{commit}`)?.trim() || null;
    },
    remoteRef(remote, ref) {
      let output;
      try {
        output = git('ls-remote', remote, ref);
      } catch (error) {
        fail(
          `Could not read ${ref} from ${remote}: ${String(error.stderr || error.message).trim()}`
        );
      }
      return parseLsRemote(output, ref);
    },
    readFile(sha, file) {
      return tryGit('show', `${sha}:${file}`);
    }
  };
}

export function assertCleanTree(git) {
  const error = dirtyTreeError(git.status());
  if (error) fail(error);
}

// ---------------------------------------------------------------------------
// Publish-step gate (cli:publish, desktop:publish, server:deploy)

// Throws unless the tree is clean and the stamp names HEAD. A skipped gate is
// reported loudly by the caller; a dry run reports a refusal without failing.
export function releaseGateRefusal({ root = ROOT, git = gitClient({ cwd: root }) } = {}) {
  try {
    const head = git.head();
    const dirty = dirtyTreeError(git.status());
    if (dirty) return dirty;
    return stampMismatch(readStamp(root), head);
  } catch (error) {
    if (error instanceof ReleaseGateError) return error.message;
    throw error;
  }
}

export function enforceReleaseGate({
  step,
  argv,
  env = process.env,
  dryRun = false,
  root = ROOT,
  git = gitClient({ cwd: root }),
  log = message => process.stderr.write(`${message}\n`)
}) {
  const override = extractGateOverride(argv, env);
  if (override.skip) {
    log(
      [
        '',
        '!!! RELEASE GATE SKIPPED !!!',
        `!!! ${step} runs without a preflight stamp check (${override.reason}).`,
        '!!! The contract range of this release is unchecked; production may run code',
        '!!! that no preflight saw. Record why, and run yarn release:preflight as soon as you can.',
        ''
      ].join('\n')
    );
    return { args: override.args, skipped: true, refusal: null };
  }
  const refusal = releaseGateRefusal({ root, git });
  if (refusal && !dryRun) {
    fail(`${step} refused by the release gate.\n${refusal}`);
  }
  if (refusal) {
    log(`Dry run: the release gate would refuse ${step}:\n${refusal}`);
  } else {
    log(`Release gate: stamp matches HEAD; ${step} may proceed.`);
  }
  return { args: override.args, skipped: false, refusal: refusal ?? null };
}

// ---------------------------------------------------------------------------
// release:preflight

function defaultRunCheck({ script, cwd }) {
  process.stdout.write(`\n→ yarn ${script.join(' ')}\n`);
  const result = spawnSync('yarn', script, { cwd, stdio: 'inherit', env: process.env });
  return result.status === 0;
}

export function preflight({
  impact,
  dryRun = false,
  remote = DEFAULT_REMOTE,
  root = ROOT,
  git = gitClient({ cwd: root }),
  repository = gitRepository({ cwd: root }),
  runCheck = defaultRunCheck,
  now = new Date(),
  log = message => process.stdout.write(`${message}\n`)
}) {
  const declared = parseContractImpact(impact);
  const head = git.head();
  assertCleanTree(git);

  const remoteTagSha = git.remoteRef(remote, `refs/tags/${RELEASE_TAG}`);
  const localTagSha = git.localRef(`refs/tags/${RELEASE_TAG}`);
  const baseline = remoteTagSha ? null : readBaseline(root);
  const rangeStart = selectRangeStart({ remoteTagSha, localTagSha, baseline, remote });
  if (!git.hasCommit(rangeStart.sha)) {
    fail(`The range start ${rangeStart.sha} is not in this clone. Run: git fetch ${remote} --tags`);
  }
  if (!git.isAncestor(rangeStart.sha, head)) {
    fail(
      `The range start ${rangeStart.sha} (${rangeStart.source}) is not an ancestor of HEAD ${head}. ` +
        'A release only moves forward; release from a descendant of the last release.'
    );
  }
  if (rangeStart.source === 'baseline') {
    const recorded = git.readFile(rangeStart.sha, CONTRACT_PATHS.version)?.trim();
    if (recorded !== baseline.rangeStartContractVersion) {
      fail(
        `${BASELINE_PATH} says the range start holds contract ${baseline.rangeStartContractVersion}, ` +
          `but contract/VERSION there is ${recorded}.`
      );
    }
  }
  log(`Release candidate ${head}`);
  log(
    `Range start ${rangeStart.sha} (${rangeStart.source === 'baseline' ? BASELINE_PATH : `${remote} ${RELEASE_TAG} tag`})`
  );

  for (const script of PREFLIGHT_CHECKS) {
    if (!runCheck({ script, cwd: root })) fail(`yarn ${script.join(' ')} failed.`);
  }

  const result = checkContractRange({
    rangeStart: rangeStart.sha,
    head,
    declaredImpact: declared,
    repository
  });
  log(
    `Contract impact: ${result.impact} (${result.startVersion} -> ${result.headVersion}, ${rangeStart.sha}..${head})`
  );

  // The checks must not have changed the tree (for example by regenerating a file).
  assertCleanTree(git);

  const openapiVersion = openapiInfoVersion(git.readFile(head, CONTRACT_PATHS.openapi) ?? '');
  const stamp = createStamp({
    sha: head,
    impact: declared,
    contractVersion: result.headVersion,
    openapiVersion,
    rangeStart: rangeStart.sha,
    rangeStartSource: rangeStart.source,
    now
  });
  if (dryRun) {
    log(`Dry run: preflight passed; ${STAMP_PATH} was not written. It would contain:`);
    log(JSON.stringify(stamp, null, 2));
    return { stamp, written: false };
  }
  writeStamp(root, stamp);
  log(`Preflight passed. Wrote ${STAMP_PATH} for ${head}.`);
  return { stamp, written: true };
}

// ---------------------------------------------------------------------------
// release:finish

// Works out what finishing the release does, refusing anything that is not a
// forward move. Pure apart from the git reads it makes.
export function planFinish({
  remote = DEFAULT_REMOTE,
  root = ROOT,
  git = gitClient({ cwd: root })
}) {
  const head = git.head();
  assertCleanTree(git);
  const stamp = readStamp(root);
  const mismatch = stampMismatch(stamp, head);
  if (mismatch) fail(mismatch);

  const remoteTagSha = git.remoteRef(remote, `refs/tags/${RELEASE_TAG}`);
  if (stamp.rangeStartSource === 'production-tag' && remoteTagSha !== stamp.rangeStart) {
    fail(
      `${remote}'s ${RELEASE_TAG} tag is ${remoteTagSha ?? 'absent'}, but preflight checked the range from ` +
        `${stamp.rangeStart}. Another release happened in between; run yarn release:preflight again.`
    );
  }
  if (stamp.rangeStartSource === 'baseline' && remoteTagSha) {
    fail(
      `${remote} now has a ${RELEASE_TAG} tag (${remoteTagSha}); preflight ran before it existed. ` +
        'Run yarn release:preflight again.'
    );
  }

  const remoteBranchSha = git.remoteRef(remote, `refs/heads/${RELEASE_BRANCH}`);
  const localBranchSha = git.localRef(`refs/heads/${RELEASE_BRANCH}`);
  for (const [label, sha] of [
    [`${remote}/${RELEASE_BRANCH}`, remoteBranchSha],
    [`local ${RELEASE_BRANCH}`, localBranchSha]
  ]) {
    if (!sha) continue;
    if (!git.hasCommit(sha)) {
      fail(
        `${label} is at ${sha}, which is not in this clone. Run: git fetch ${remote} ${RELEASE_BRANCH}`
      );
    }
    if (!git.isAncestor(sha, head)) {
      fail(
        `${label} (${sha}) is not an ancestor of HEAD ${head}; moving it would not be a fast-forward. ` +
          'Refusing. Release from a commit that contains the current prod branch.'
      );
    }
  }

  // One atomic push first: the branch is an ordinary (fast-forward only) push;
  // the tag may be moved only from the value just read, so a concurrent move
  // fails. Local refs follow only once the remote has accepted both.
  const commands = [
    [
      'git',
      'push',
      '--atomic',
      `--force-with-lease=refs/tags/${RELEASE_TAG}:${remoteTagSha ?? ''}`,
      remote,
      `${head}:refs/heads/${RELEASE_BRANCH}`,
      `${head}:refs/tags/${RELEASE_TAG}`
    ],
    ['git', 'tag', '--force', RELEASE_TAG, head]
  ];
  if (localBranchSha !== head && git.currentBranch() !== RELEASE_BRANCH) {
    commands.push([
      'git',
      'update-ref',
      `refs/heads/${RELEASE_BRANCH}`,
      head,
      ...(localBranchSha ? [localBranchSha] : [])
    ]);
  }
  return { head, stamp, remoteTagSha, remoteBranchSha, localBranchSha, commands };
}

export function formatCommand(command) {
  return command
    .map(part => (/^[\w./:=@^{}+-]*$/.test(part) && part !== '' ? part : JSON.stringify(part)))
    .join(' ');
}

export function finish({
  dryRun = false,
  remote = DEFAULT_REMOTE,
  root = ROOT,
  git = gitClient({ cwd: root }),
  log = message => process.stdout.write(`${message}\n`)
}) {
  const plan = planFinish({ remote, root, git });
  log(
    `Releasing ${plan.head} (contract ${plan.stamp.contractVersion}, impact ${plan.stamp.impact})`
  );
  log(`${RELEASE_TAG} tag on ${remote}: ${plan.remoteTagSha ?? 'none'} -> ${plan.head}`);
  log(`${RELEASE_BRANCH} branch on ${remote}: ${plan.remoteBranchSha ?? 'none'} -> ${plan.head}`);
  if (dryRun) {
    log('Dry run: nothing was changed. release:finish would run:');
    for (const command of plan.commands) log(`  ${formatCommand(command)}`);
    return { ...plan, executed: false };
  }
  for (const command of plan.commands) {
    log(`→ ${formatCommand(command)}`);
    git.git(...command.slice(1));
  }
  log(`Release finished: ${RELEASE_TAG} and ${RELEASE_BRANCH} are at ${plan.head}.`);
  return { ...plan, executed: true };
}

// ---------------------------------------------------------------------------
// CLI

const USAGE = `Usage:
  node scripts/release-gate.mjs preflight <none|patch|minor|major> [--dry-run] [--remote <name>]
  node scripts/release-gate.mjs finish [--dry-run] [--remote <name>]
  node scripts/release-gate.mjs verify`;

export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command === 'preflight') return preflight(parsePreflightArgs(rest));
  if (command === 'finish') return finish(parseFinishArgs(rest));
  if (command === 'verify') {
    const refusal = releaseGateRefusal();
    if (refusal) fail(refusal);
    process.stdout.write('Release gate: stamp matches HEAD and the tree is clean.\n');
    return undefined;
  }
  fail(USAGE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`\n✖ ${error.message}\n`);
    process.exitCode = 1;
  }
}
