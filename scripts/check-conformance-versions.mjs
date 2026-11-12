// Checks every conformance-manifest.yaml in the repository against the contract
// version in contract/VERSION (contract/CONTRACT.md section 4, ADR 0009): a
// manifest declares the strict Semantic Version it was validated against, with
// the same MAJOR as the contract and not newer than it. Patch and minor contract
// changes therefore leave manifests alone; a major change requires restamping.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { compareVersions, isStrictSemver, parseVersion } from './version-contract.mjs';

const ignoredDirectories = new Set(['.git', '.yarn', 'dist', 'node_modules']);
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readCurrentContractVersion(root = defaultRoot) {
  const version = readFileSync(path.join(root, 'contract', 'VERSION'), 'utf8').trim();
  if (!isStrictSemver(version)) {
    throw new Error(`contract/VERSION is not strict MAJOR.MINOR.PATCH Semantic Versioning: ${version}`);
  }
  return version;
}

export function findManifestPaths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name)
        ? []
        : findManifestPaths(path.join(directory, entry.name));
    }
    return entry.name === 'conformance-manifest.yaml' ? [path.join(directory, entry.name)] : [];
  });
}

export function readManifestVersion(manifestText) {
  const manifest = parseYaml(manifestText);
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('must contain a YAML object');
  }
  const declared = manifest.contractVersion;
  if (typeof declared !== 'string' || !isStrictSemver(declared)) {
    throw new Error(
      `must declare contractVersion as a quoted strict MAJOR.MINOR.PATCH string; found ${JSON.stringify(declared)}`
    );
  }
  return declared;
}

/**
 * Returns `undefined` when `manifestVersion` is acceptable against `currentVersion`,
 * otherwise the reason it is not.
 */
export function manifestVersionError({ manifestVersion, currentVersion }) {
  const manifest = parseVersion(manifestVersion, 'manifest contractVersion');
  const current = parseVersion(currentVersion, 'contract version');
  if (manifest.major !== current.major) {
    return `declares ${manifestVersion}, a different major version from the contract (${currentVersion})`;
  }
  if (compareVersions(manifestVersion, currentVersion) > 0) {
    return `declares ${manifestVersion}, newer than the contract (${currentVersion})`;
  }
  return undefined;
}

export function checkConformanceVersions(root = defaultRoot) {
  const currentVersion = readCurrentContractVersion(root);
  const manifestPaths = findManifestPaths(root).sort();
  const errors = [];
  const older = [];
  for (const manifestPath of manifestPaths) {
    const displayPath = path.relative(root, manifestPath).split(path.sep).join('/');
    try {
      const manifestVersion = readManifestVersion(readFileSync(manifestPath, 'utf8'));
      const error = manifestVersionError({ manifestVersion, currentVersion });
      if (error) {
        errors.push(`${displayPath}: ${error}`);
      } else if (manifestVersion !== currentVersion) {
        older.push(`${displayPath}: ${manifestVersion} (current: ${currentVersion})`);
      }
    } catch (error) {
      errors.push(`${displayPath}: ${error.message}`);
    }
  }
  return { currentVersion, manifestCount: manifestPaths.length, errors, older };
}

function main() {
  const { currentVersion, manifestCount, errors, older } = checkConformanceVersions(process.cwd());
  if (errors.length > 0) {
    console.error('Invalid conformance manifest versions:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Conformance version check passed: ${manifestCount} manifest(s), current contract version ${currentVersion}.`
    );
  }
  if (older.length > 0) {
    console.warn('Conformance manifests validated against an earlier version of the same major:');
    for (const manifest of older) console.warn(`- ${manifest}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
