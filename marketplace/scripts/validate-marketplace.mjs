import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const catalogPath = '.agents/plugins/marketplace.json';
const failures = [];
const fail = message => failures.push(message);

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    fail(`Cannot read valid JSON from ${relativePath}: ${error.message}`);
    return null;
  }
}

function safePackagePath(packageName, reference) {
  if (typeof reference !== 'string' || reference.length === 0) {
    fail(`${packageName}: manifest path must be a non-empty string`);
    return null;
  }
  const absolute = path.resolve(root, `plugins/${packageName}`, reference);
  const packageRoot = path.resolve(root, `plugins/${packageName}`);
  if (absolute !== packageRoot && !absolute.startsWith(`${packageRoot}${path.sep}`)) {
    fail(`${packageName}: manifest path escapes its package: ${reference}`);
    return null;
  }
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    fail(`${packageName}: manifest path escapes the marketplace: ${reference}`);
    return null;
  }
  if (!statExists(absolute)) fail(`${packageName}: referenced path does not exist: ${reference}`);
  return absolute;
}

function statExists(filePath) {
  try {
    statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function compareVersions(left, right) {
  const parse = value => String(value).split(/[.+-]/).map(part => /^\d+$/.test(part) ? Number(part) : part);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av < bv ? -1 : 1;
    return String(av).localeCompare(String(bv), undefined, { numeric: true });
  }
  return 0;
}

function changedInPlugin(pluginName) {
  const base = process.env.MARKETPLACE_BASE_REF || 'main';
  const baseRef = base.startsWith('origin/') ? base : `origin/${base}`;
  try {
    const changed = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`, '--', `plugins/${pluginName}`], {
      cwd: root,
      encoding: 'utf8'
    });
    return changed.trim().length > 0;
  } catch {
    fail(`Could not compare plugins/${pluginName} with ${base}`);
    return false;
  }
}

const catalog = readJson(catalogPath);
const pluginNames = new Set();
if (!catalog || !Array.isArray(catalog.plugins)) {
  fail(`${catalogPath}: expected a plugins array`);
} else {
  for (const entry of catalog.plugins) {
    const name = entry?.name;
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      fail('Each catalog plugin must have a lowercase slug name');
      continue;
    }
    if (pluginNames.has(name)) fail(`Duplicate catalog plugin: ${name}`);
    pluginNames.add(name);

    const source = entry?.source;
    if (source?.source !== 'local' || typeof source.path !== 'string') {
      fail(`${name}: marketplace entries must use a local source with a path`);
      continue;
    }
    const packagePath = path.resolve(root, source.path);
    if (!packagePath.startsWith(`${root}${path.sep}`) || !statExists(packagePath)) {
      fail(`${name}: local source path is missing or escapes the marketplace: ${source.path}`);
      continue;
    }

    const manifestRelative = path.posix.join(path.relative(root, packagePath).split(path.sep).join('/'), '.codex-plugin/plugin.json');
    const manifest = readJson(manifestRelative);
    if (!manifest) continue;
    if (manifest.name !== name) fail(`${manifestRelative}: name must match catalog entry ${name}`);

    for (const field of ['skills', 'hooks', 'mcpServers']) {
      if (manifest[field] !== undefined) safePackagePath(name, manifest[field]);
    }
    for (const field of ['composerIcon', 'logo']) {
      const reference = manifest.interface?.[field];
      if (reference !== undefined) safePackagePath(name, reference);
    }
    for (const reference of manifest.interface?.screenshots ?? []) {
      safePackagePath(name, reference);
    }

    if (changedInPlugin(name)) {
      const base = process.env.MARKETPLACE_BASE_REF || 'main';
      const baseRef = base.startsWith('origin/') ? base : `origin/${base}`;
      try {
        const previousText = execFileSync('git', ['show', `${baseRef}:plugins/${name}/.codex-plugin/plugin.json`], {
          cwd: root,
          encoding: 'utf8'
        });
        const previous = JSON.parse(previousText);
        if (!manifest.version || !previous.version || compareVersions(manifest.version, previous.version) <= 0) {
          fail(`${manifestRelative}: changed package must increase manifest version above ${previous.version}`);
        }
      } catch (error) {
        if (error.status !== 128) fail(`${manifestRelative}: could not read the base manifest: ${error.message}`);
      }
    }
  }
}

const forbiddenName = name =>
  /^\.env/i.test(name) || /\.pem$/i.test(name) || /^(id_rsa|id_ed25519|owner[-_.]?key)$/i.test(name) || /owner[-_.]?key/i.test(name);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{24,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/
];

function scanDirectory(relativeDirectory = '') {
  for (const entry of readdirSync(path.join(root, relativeDirectory), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const relative = path.posix.join(relativeDirectory.split(path.sep).join('/'), entry.name);
    if (forbiddenName(entry.name)) {
      fail(`Forbidden secret or environment file: ${relative}`);
      continue;
    }
    if (entry.isDirectory()) {
      scanDirectory(relative);
    } else if (entry.isFile()) {
      const contents = readFileSync(path.join(root, relative));
      if (contents.includes(0)) continue;
      const text = contents.toString('utf8');
      if (secretPatterns.some(pattern => pattern.test(text))) fail(`Possible secret found in ${relative}`);
    }
  }
}

scanDirectory();
if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${pluginNames.size} marketplace plugin package(s).`);
}
