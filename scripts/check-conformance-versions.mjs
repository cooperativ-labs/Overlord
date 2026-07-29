import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', '.yarn', 'dist', 'node_modules']);
const contractPath = path.join(root, 'CONTRACT.md');
const currentVersionPattern = /^Current version:\s*`(\d+)`\s*$/m;

function readCurrentContractVersion() {
  const match = readFileSync(contractPath, 'utf8').match(currentVersionPattern);
  if (!match) {
    throw new Error(
      'Could not find the authoritative `Current version` line in CONTRACT.md.'
    );
  }
  return Number.parseInt(match[1], 10);
}

function findManifestPaths(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name)
        ? []
        : findManifestPaths(path.join(directory, entry.name));
    }
    return entry.name === 'conformance-manifest.yaml' ? [path.join(directory, entry.name)] : [];
  });
}

function relativePath(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function readManifestVersion(manifestPath) {
  const manifest = parseYaml(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error('must contain a YAML object');
  }
  if (!Number.isInteger(Number(manifest.contractVersion)) || Number(manifest.contractVersion) < 0) {
    throw new Error('must declare a non-negative integer contractVersion');
  }
  return Number(manifest.contractVersion);
}

const currentVersion = readCurrentContractVersion();
const manifestPaths = findManifestPaths(root).sort();
const errors = [];
const stale = [];

for (const manifestPath of manifestPaths) {
  const displayPath = relativePath(manifestPath);
  try {
    const manifestVersion = readManifestVersion(manifestPath);
    if (manifestVersion > currentVersion) {
      errors.push(`${displayPath}: declares ${manifestVersion}, above current version ${currentVersion}`);
    } else if (manifestVersion < currentVersion) {
      stale.push(`${displayPath}: ${manifestVersion} (current: ${currentVersion})`);
    }
  } catch (error) {
    errors.push(`${displayPath}: ${error.message}`);
  }
}

if (errors.length > 0) {
  console.error('Invalid conformance manifest versions:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Conformance version check passed: ${manifestPaths.length} manifest(s), current contract version ${currentVersion}.`
  );
}

if (stale.length > 0) {
  console.warn('Conformance manifests validated against an older contract version:');
  for (const manifest of stale) console.warn(`- ${manifest}`);
}
