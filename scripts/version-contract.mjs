#!/usr/bin/env node

// Contract Semantic Versioning utility. It is the only supported writer of
// contract/VERSION and owns exactly these locations: VERSION, the
// contract/CONTRACT.md header, the contract/CHANGELOG.md skeleton,
// `contractVersion` in contract/components.yaml, and the OpenAPI
// info.x-overlord-contract-version extension in contract/api/openapi.yaml.
// It never writes package.json, OpenAPI info.version or conformance manifests,
// which have their own owners (contract/CONTRACT.md section 4).
//
// This module is dependency-free so it runs before `yarn install` and so the
// range checker in scripts/contract-impact.mjs can import the shared parser.

import { access, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BUMP_LEVELS = Object.freeze(['patch', 'minor', 'major']);
export const CONTRACT_VERSION_EXTENSION = 'x-overlord-contract-version';

export const CONTRACT_PATHS = Object.freeze({
  package: 'package.json',
  version: 'contract/VERSION',
  contract: 'contract/CONTRACT.md',
  changelog: 'contract/CHANGELOG.md',
  components: 'contract/components.yaml',
  openapi: 'contract/api/openapi.yaml'
});

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const CONTRACT_HEADER_PATTERN = /^> Contract version: \*\*([^*\n]*)\*\*$/gm;
const CHANGELOG_HEADING_PATTERN = /^## \[([^\]\n]*)\]/m;
// Top-level (unindented) `contractVersion:` key of components.yaml, optionally quoted.
const COMPONENTS_VERSION_PATTERN = /^contractVersion:[ \t]*(['"]?)([^'"\s]*)\1[ \t]*$/gm;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function fail(message) {
  throw new Error(message);
}

export function isStrictSemver(value) {
  return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

export function parseVersion(value, label = 'version') {
  const match = typeof value === 'string' ? SEMVER_PATTERN.exec(value) : null;
  if (!match) fail(`${label} is not strict MAJOR.MINOR.PATCH Semantic Versioning: ${value}`);
  return { major: BigInt(match[1]), minor: BigInt(match[2]), patch: BigInt(match[3]) };
}

export function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

export function nextVersion(current, level) {
  const version = parseVersion(current, 'Current contract version');
  if (level === 'major') return formatVersion({ major: version.major + 1n, minor: 0n, patch: 0n });
  if (level === 'minor') {
    return formatVersion({ major: version.major, minor: version.minor + 1n, patch: 0n });
  }
  if (level === 'patch') {
    return formatVersion({ major: version.major, minor: version.minor, patch: version.patch + 1n });
  }
  fail(`Contract version bump level must be one of ${BUMP_LEVELS.join(', ')}; received ${level}`);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const component of ['major', 'minor', 'patch']) {
    if (a[component] !== b[component]) return a[component] < b[component] ? -1 : 1;
  }
  return 0;
}

// Classifies the compatibility level implied by moving from one contract
// version to another. Several bumps inside one range collapse to the highest
// component that changed.
export function impactBetween(from, to) {
  const start = parseVersion(from, 'Range-start contract version');
  const end = parseVersion(to, 'Head contract version');
  if (compareVersions(from, to) > 0) {
    fail(`Contract version decreased from ${from} to ${to}`);
  }
  if (start.major !== end.major) return 'major';
  if (start.minor !== end.minor) return 'minor';
  if (start.patch !== end.patch) return 'patch';
  return 'none';
}

function openapiInfoBlock(openapi) {
  const match = /^info:[ \t]*\n((?:[ \t]+.*\n|[ \t]*\n)*)/m.exec(openapi);
  return match ? { text: match[1], start: match.index + match[0].length - match[1].length } : null;
}

function infoScalar(openapi, key) {
  const block = openapiInfoBlock(openapi);
  if (!block) return { count: 0, value: undefined };
  const expression = new RegExp(`^  ${escapeRegExp(key)}:[ \\t]*(\\S+)[ \\t]*$`, 'gm');
  const matches = [...block.text.matchAll(expression)];
  return { count: matches.length, value: matches[0]?.[1] };
}

export function openapiInfoVersion(openapi) {
  return infoScalar(openapi, 'version').value;
}

export function openapiContractVersion(openapi) {
  return infoScalar(openapi, CONTRACT_VERSION_EXTENSION).value;
}

// The API description without the contract-version extension line. That line
// is the only part of openapi.yaml that `yarn version:contract` rewrites, so a
// range checker compares this form to tell an API-surface change from a bump.
export function openapiWithoutContractVersion(openapi) {
  const line = new RegExp(`^  ${escapeRegExp(CONTRACT_VERSION_EXTENSION)}:.*\n?`, 'm');
  return openapi.replace(line, '');
}

export function contractHeaderVersion(contract) {
  const matches = [...contract.matchAll(CONTRACT_HEADER_PATTERN)];
  return { count: matches.length, value: matches[0]?.[1] };
}

export function componentsContractVersion(components) {
  const matches = [...components.matchAll(COMPONENTS_VERSION_PATTERN)];
  return { count: matches.length, value: matches[0]?.[2] };
}

// The current changelog heading is the first "## [" heading. Older headings are
// retained provenance and are never validated.
export function currentChangelogVersion(changelog) {
  return CHANGELOG_HEADING_PATTERN.exec(changelog)?.[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readOptional(file) {
  try {
    await access(file);
  } catch {
    return undefined;
  }
  return readFile(file, 'utf8');
}

export async function readContractState(root = ROOT) {
  const read = relativePath => readFile(path.join(root, relativePath), 'utf8');
  const [packageText, versionText, contract, changelog, components, openapi] = await Promise.all([
    read(CONTRACT_PATHS.package),
    read(CONTRACT_PATHS.version),
    read(CONTRACT_PATHS.contract),
    read(CONTRACT_PATHS.changelog),
    read(CONTRACT_PATHS.components),
    // The OpenAPI description exists since phase 4a of the contract migration
    // (planning/feature-plans/contract-adr-openapi-migration.md);
    // scripts/check-contract.sh requires it. This reader still tolerates its
    // absence so the parser and the range checker work on any revision.
    readOptional(path.join(root, CONTRACT_PATHS.openapi))
  ]);
  return {
    packageJson: JSON.parse(packageText),
    versionText,
    version: versionText.trim(),
    contract,
    changelog,
    components,
    openapi
  };
}

export function consistencyErrors({
  packageJson,
  versionText,
  version,
  contract,
  changelog,
  components,
  openapi
}) {
  const errors = [];
  if (versionText !== undefined && versionText !== `${version}\n`) {
    errors.push('contract/VERSION must contain only the version followed by one newline');
  }
  if (!isStrictSemver(version)) {
    errors.push(`contract/VERSION is not strict MAJOR.MINOR.PATCH Semantic Versioning: ${version}`);
  }

  const header = contractHeaderVersion(contract);
  if (header.count !== 1) {
    errors.push(
      `contract/CONTRACT.md must contain exactly one "Contract version" header; found ${header.count}`
    );
  } else if (header.value !== version) {
    errors.push(`contract/CONTRACT.md header declares ${header.value} but VERSION is ${version}`);
  }

  const heading = currentChangelogVersion(changelog);
  if (heading !== version) {
    errors.push(
      `contract/CHANGELOG.md current heading is ${heading ?? 'missing'} but VERSION is ${version}`
    );
  }

  const componentsVersion = componentsContractVersion(components);
  if (componentsVersion.count !== 1) {
    errors.push(
      `contract/components.yaml must declare a top-level contractVersion exactly once; found ${componentsVersion.count}`
    );
  } else if (componentsVersion.value !== version) {
    errors.push(
      `contract/components.yaml contractVersion is ${componentsVersion.value} but VERSION is ${version}`
    );
  }

  if (openapi !== undefined) {
    const extension = infoScalar(openapi, CONTRACT_VERSION_EXTENSION);
    if (extension.count !== 1) {
      errors.push(
        `OpenAPI info must declare ${CONTRACT_VERSION_EXTENSION} exactly once; found ${extension.count}`
      );
    } else if (extension.value !== version) {
      errors.push(
        `OpenAPI info.${CONTRACT_VERSION_EXTENSION} is ${extension.value} but VERSION is ${version}`
      );
    }
    // info.version is owned by the API description: format only, never
    // compared with the contract version.
    const infoVersion = infoScalar(openapi, 'version');
    if (infoVersion.count !== 1 || !isStrictSemver(infoVersion.value)) {
      errors.push(
        `OpenAPI info.version must be strict Semantic Versioning; found ${infoVersion.value}`
      );
    }
  }

  // package.json version is owned by the application release: format only.
  if (!isStrictSemver(packageJson?.version)) {
    errors.push(
      `package.json version must be strict Semantic Versioning; found ${packageJson?.version}`
    );
  }
  return errors;
}

export function planContractBump(state, level, now = new Date()) {
  if (!BUMP_LEVELS.includes(level)) {
    fail(`Contract version bump level must be one of ${BUMP_LEVELS.join(', ')}; received ${level}`);
  }
  const errors = consistencyErrors(state);
  if (errors.length > 0) {
    fail(
      `Contract version files are inconsistent; fix them before bumping:\n- ${errors.join('\n- ')}`
    );
  }

  const current = state.version;
  const next = nextVersion(current, level);
  const date = now.toISOString().slice(0, 10);

  const contract = state.contract.replace(CONTRACT_HEADER_PATTERN, `> Contract version: **${next}**`);
  const components = state.components.replace(
    COMPONENTS_VERSION_PATTERN,
    (_match, quote) => `contractVersion: ${quote}${next}${quote}`
  );

  const levelName = `${level[0].toUpperCase()}${level.slice(1)}`;
  const skeleton = [
    `## [${next}] - ${date}`,
    '',
    '### Version',
    '',
    `- ${levelName} contract version ${next}, from ${current}.`,
    '',
    ''
  ].join('\n');
  const headingIndex = state.changelog.search(/^## \[/m);
  const changelog =
    state.changelog.slice(0, headingIndex) + skeleton + state.changelog.slice(headingIndex);

  const updates = [
    [CONTRACT_PATHS.version, `${next}\n`],
    [CONTRACT_PATHS.contract, contract],
    [CONTRACT_PATHS.changelog, changelog],
    [CONTRACT_PATHS.components, components]
  ];

  if (state.openapi !== undefined) {
    const block = openapiInfoBlock(state.openapi);
    const extensionLine = new RegExp(
      `^(  ${escapeRegExp(CONTRACT_VERSION_EXTENSION)}:[ \\t]*)\\S+([ \\t]*)$`,
      'm'
    );
    const openapi =
      state.openapi.slice(0, block.start) +
      block.text.replace(extensionLine, `$1${next}$2`) +
      state.openapi.slice(block.start + block.text.length);
    updates.push([CONTRACT_PATHS.openapi, openapi]);
  }

  return { current, next, updates };
}

const defaultFileSystem = { readFile, rename, unlink, writeFile };

// Stages every file first, then renames them into place. If any step fails,
// staged files are removed and already-replaced targets are restored, so a
// failed bump leaves the previous contract state intact.
export async function writeAtomically({ root = ROOT, updates, fileSystem = defaultFileSystem }) {
  const staged = [];
  const replaced = [];
  try {
    for (const [relativePath, content] of updates) {
      const target = path.join(root, relativePath);
      const original = await fileSystem.readFile(target, 'utf8');
      const temporary = `${target}.version-contract-${process.pid}`;
      await fileSystem.writeFile(temporary, content, 'utf8');
      staged.push({ temporary, target, original });
    }
    for (const entry of staged) {
      await fileSystem.rename(entry.temporary, entry.target);
      replaced.push(entry);
    }
  } catch (error) {
    await Promise.allSettled(
      staged
        .filter(entry => !replaced.includes(entry))
        .map(entry => fileSystem.unlink(entry.temporary))
    );
    await Promise.allSettled(
      replaced.map(entry => fileSystem.writeFile(entry.target, entry.original, 'utf8'))
    );
    throw error;
  }
}

export async function bumpContractVersion({
  root = ROOT,
  level,
  now = new Date(),
  fileSystem = defaultFileSystem
}) {
  const state = await readContractState(root);
  const plan = planContractBump(state, level, now);
  await writeAtomically({ root, updates: plan.updates, fileSystem });
  return { current: plan.current, next: plan.next };
}

export async function checkContractVersion({ root = ROOT } = {}) {
  const state = await readContractState(root);
  const errors = consistencyErrors(state);
  if (errors.length > 0) fail(`Contract version check failed:\n- ${errors.join('\n- ')}`);
  return state.version;
}

async function main(argv) {
  const usage = 'Usage: version-contract.mjs <patch|minor|major> | --check';
  if (argv.length !== 1) fail(usage);
  if (argv[0] === '--check') {
    const version = await checkContractVersion();
    process.stdout.write(`contract version check passed for ${version}\n`);
    return;
  }
  if (!BUMP_LEVELS.includes(argv[0])) fail(usage);
  const { current, next } = await bumpContractVersion({ level: argv[0] });
  process.stdout.write(
    `${next}\n` +
      `Contract version ${current} -> ${next}. Complete the contract/CHANGELOG.md entry, then ` +
      'run `yarn connectors:capabilities` to restamp the generated connector manifests. ' +
      'Hand-maintained conformance manifests need restamping only on a major bump ' +
      '(contract/CONTRACT.md section 4).\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
