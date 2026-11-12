#!/usr/bin/env node

// Release range checker (contract/CONTRACT.md section 5). A release declares
// exactly one contract impact for the whole range from the previously released
// SHA (the `production` tag) to the SHA being released; this module proves the
// range is complete. It knows nothing about individual pushes, pull requests,
// or commit trailers.
//
// The release gate that calls it (`yarn release:preflight`) is introduced in
// phase 5 of planning/feature-plans/contract-adr-openapi-migration.md. Until
// then it can be run by hand:
//   node scripts/contract-impact.mjs --range-start <sha> --head <sha> --impact <level>

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  compareVersions,
  CONTRACT_PATHS,
  currentChangelogVersion,
  impactBetween,
  isStrictSemver,
  openapiInfoVersion,
  openapiWithoutContractVersion
} from './version-contract.mjs';

export const CONTRACT_IMPACTS = Object.freeze(['none', 'patch', 'minor', 'major']);

export const CONTRACT_DIRECTORY = 'contract/';
export const DECISION_RECORD_PATTERN = /^contract\/decisions\/\d{4}-[^/]+\.md$/;
export const DECISION_TRIGGER_FILES = Object.freeze([
  'contract/architecture.md',
  'contract/protocol.md',
  'contract/authorization.md',
  'contract/data/README.md'
]);
export const DECISION_TRIGGER_DIRECTORIES = Object.freeze([
  'database/sqlite/migrations/',
  'database/postgres/migrations/',
  'backend/postgres/migrations/'
]);

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

export function fail(message) {
  throw new Error(message);
}

// Parses the declared impact supplied to the release gate. The input is the
// exactly-one declaration for the released range.
export function parseContractImpact(value) {
  const impact = String(value ?? '').trim();
  if (!CONTRACT_IMPACTS.includes(impact)) {
    fail(
      `contract impact must be exactly one of ${CONTRACT_IMPACTS.join(', ')}; received "${impact}"`
    );
  }
  return impact;
}

function isDecisionTrigger(file) {
  return (
    DECISION_TRIGGER_FILES.includes(file) ||
    DECISION_TRIGGER_DIRECTORIES.some(directory => file.startsWith(directory))
  );
}

// Returns every rule violation for a range so the operator sees them together.
// `repository` reads the range: changes(start, head) -> [{ status, path, previousPath? }],
// readFile(sha, path) -> string | null, and versionHistory(start, head) -> [{ sha, version }]
// for every commit in the range that changed contract/VERSION.
export function contractRangeViolations({ rangeStart, head, declaredImpact, repository }) {
  const violations = [];
  const impact = parseContractImpact(declaredImpact);

  const startVersion = repository.readFile(rangeStart, CONTRACT_PATHS.version)?.trim();
  const headVersion = repository.readFile(head, CONTRACT_PATHS.version)?.trim();
  for (const [label, sha, version] of [
    ['range start', rangeStart, startVersion],
    ['head', head, headVersion]
  ]) {
    if (!isStrictSemver(version)) {
      violations.push(
        `contract/VERSION at ${label} ${sha} is not strict Semantic Versioning: ${version}`
      );
    }
  }
  for (const { sha, version } of repository.versionHistory(rangeStart, head)) {
    if (!isStrictSemver(version)) {
      violations.push(
        `contract/VERSION at ${sha} in the range is not strict Semantic Versioning: ${version}`
      );
    }
  }

  let computedImpact = null;
  if (isStrictSemver(startVersion) && isStrictSemver(headVersion)) {
    if (compareVersions(startVersion, headVersion) > 0) {
      violations.push(`Contract version decreased from ${startVersion} to ${headVersion}`);
    } else {
      computedImpact = impactBetween(startVersion, headVersion);
      if (computedImpact !== impact) {
        violations.push(
          `Declared contract impact ${impact} does not match the VERSION delta ` +
            `${startVersion} -> ${headVersion}, which is ${computedImpact}`
        );
      }
    }
  }

  const changes = repository.changes(rangeStart, head);
  const changedPaths = [
    ...new Set(changes.flatMap(change => [change.path, change.previousPath].filter(Boolean)))
  ];
  const contractFiles = changedPaths.filter(file => file.startsWith(CONTRACT_DIRECTORY));

  if (computedImpact === 'none' && contractFiles.length > 0) {
    violations.push(
      `A range whose contract version is unchanged cannot change contract/: ${contractFiles.join(', ')}`
    );
  }
  if (computedImpact !== null && computedImpact !== 'none') {
    const changelog = repository.readFile(head, CONTRACT_PATHS.changelog) ?? '';
    if (currentChangelogVersion(changelog) !== headVersion) {
      violations.push(`contract/CHANGELOG.md at head has no current heading for ${headVersion}`);
    }
  }

  const triggers = changedPaths.filter(isDecisionTrigger);
  const addedDecisions = changes.filter(
    change => change.status === 'A' && DECISION_RECORD_PATTERN.test(change.path)
  );
  if (triggers.length > 0 && addedDecisions.length === 0) {
    violations.push(
      `The range changes ${triggers.join(', ')} but adds no decision record under contract/decisions/`
    );
  }

  // contract/api/openapi.yaml exists since phase 4a. A range in which it does
  // not exist at either end (an older range) has nothing to check here.
  if (changedPaths.includes(CONTRACT_PATHS.openapi)) {
    const startOpenapi = repository.readFile(rangeStart, CONTRACT_PATHS.openapi) ?? '';
    const headOpenapi = repository.readFile(head, CONTRACT_PATHS.openapi) ?? '';
    const startInfoVersion = openapiInfoVersion(startOpenapi);
    const headInfoVersion = openapiInfoVersion(headOpenapi);
    // Every contract bump rewrites info.x-overlord-contract-version. That line
    // is contract-owned, so only a change elsewhere in the description obliges
    // the API description's own info.version to move.
    const descriptionChanged =
      openapiWithoutContractVersion(startOpenapi) !== openapiWithoutContractVersion(headOpenapi);
    if (headOpenapi === '') {
      // Deleted in the range: nothing at head to validate.
    } else if (!isStrictSemver(headInfoVersion)) {
      violations.push(
        `OpenAPI info.version at head is not strict Semantic Versioning: ${headInfoVersion}`
      );
    } else if (descriptionChanged && startInfoVersion === headInfoVersion) {
      violations.push(
        `contract/api/openapi.yaml changed in the range but info.version is still ${headInfoVersion}`
      );
    }
  }

  return { impact, computedImpact, startVersion, headVersion, violations };
}

export function checkContractRange(options) {
  const result = contractRangeViolations(options);
  if (result.violations.length > 0) {
    fail(
      `Contract range ${options.rangeStart}..${options.head} refused:\n- ${result.violations.join('\n- ')}`
    );
  }
  return result;
}

export function parseNameStatus(output) {
  return output
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [status, first, second] = line.split('\t');
      const code = status[0];
      return code === 'R' || code === 'C'
        ? { status: code, previousPath: first, path: second }
        : { status: code, path: first };
    });
}

export function gitRepository({ runCommand = defaultRunCommand, cwd } = {}) {
  const git = (...args) => String(runCommand({ file: 'git', args, cwd }));
  return {
    resolveCommit(ref) {
      const sha = git('rev-parse', '--verify', `${ref}^{commit}`).trim();
      if (!FULL_SHA_PATTERN.test(sha)) fail(`Could not resolve ${ref} to a commit`);
      return sha;
    },
    isAncestor(ancestor, descendant) {
      try {
        git('merge-base', '--is-ancestor', ancestor, descendant);
        return true;
      } catch {
        return false;
      }
    },
    changes(start, head) {
      return parseNameStatus(git('diff', '--name-status', '-M', start, head));
    },
    readFile(sha, file) {
      try {
        return git('show', `${sha}:${file}`);
      } catch {
        return null;
      }
    },
    versionHistory(start, head) {
      return git('log', '--format=%H', `${start}..${head}`, '--', CONTRACT_PATHS.version)
        .split('\n')
        .filter(Boolean)
        .map(sha => ({ sha, version: this.readFile(sha, CONTRACT_PATHS.version)?.trim() }));
    }
  };
}

function defaultRunCommand({ file, args, cwd }) {
  return execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : (process.argv[index + 1] ?? '');
}

function main() {
  const start = argumentValue('--range-start');
  const headRef = argumentValue('--head');
  const declared = argumentValue('--impact');
  if (!start || !headRef || !declared) {
    fail(
      'Usage: contract-impact.mjs --range-start <sha> --head <sha> --impact <none|patch|minor|major>'
    );
  }
  const repository = gitRepository();
  const rangeStart = repository.resolveCommit(start);
  const head = repository.resolveCommit(headRef);
  if (!repository.isAncestor(rangeStart, head)) {
    fail(`Range start ${rangeStart} is not an ancestor of ${head}`);
  }
  const result = checkContractRange({ rangeStart, head, declaredImpact: declared, repository });
  process.stdout.write(
    `Contract impact: ${result.impact} (${result.startVersion} -> ${result.headVersion}, ${rangeStart}..${head})\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
