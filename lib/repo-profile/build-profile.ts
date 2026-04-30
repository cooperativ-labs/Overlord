import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { listProjectFiles } from '@/lib/filesystem/project-file-tree';

import {
  CodegenStep,
  Deployable,
  DeployableKind,
  DeployTarget,
  ManifestEntry,
  MigrationsBlock,
  REPO_OPERATIONS_PROFILE_SCHEMA_VERSION,
  RepoOperationsProfile,
  RepoSignals,
  TestsBlock,
  Workspace,
  WorkspaceManager
} from './types';

const MANIFEST_NAME = 'package.json';
const LOCKFILES: Array<{ name: string; manager: WorkspaceManager }> = [
  { name: 'yarn.lock', manager: 'yarn' },
  { name: 'pnpm-lock.yaml', manager: 'pnpm' },
  { name: 'bun.lockb', manager: 'bun' },
  { name: 'package-lock.json', manager: 'npm' }
];

const NEXT_CONFIG_RE = /^next\.config\.(?:m?js|ts|cjs)$/;
const EXPO_CONFIG_RE = /^app\.(?:config\.(?:m?js|ts|cjs)|json)$/;
const JEST_CONFIG_RE = /^jest\.config\.(?:m?js|ts|cjs|json)$/;
const VITEST_CONFIG_RE = /^vitest\.config\.(?:m?js|ts|cjs)$/;
const PLAYWRIGHT_CONFIG_RE = /^playwright\.config\.(?:m?js|ts|cjs)$/;

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

async function readJsonIfExists<T = unknown>(absPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function findScript(scripts: Record<string, string> | undefined, names: string[]): string | null {
  if (!scripts) return null;
  for (const name of names) {
    if (scripts[name]) return name;
  }
  return null;
}

function detectManager(rootFiles: Set<string>, workspaceFiles: Set<string>): WorkspaceManager | null {
  for (const lock of LOCKFILES) {
    if (workspaceFiles.has(lock.name)) return lock.manager;
  }
  for (const lock of LOCKFILES) {
    if (rootFiles.has(lock.name)) return lock.manager;
  }
  return null;
}

function detectDeployableKind(
  workspacePath: string,
  pkg: PackageJson | null,
  workspaceFiles: Set<string>,
  allFiles: string[]
): { kind: DeployableKind; deployTarget?: DeployTarget } | null {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const hasDep = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  const prefix = workspacePath ? `${workspacePath}/` : '';

  if (workspaceFiles.has('wrangler.toml')) {
    return { kind: 'cloudflare-worker', deployTarget: 'cloudflare' };
  }
  if (workspaceFiles.has('vercel.json') || hasDep('next')) {
    const isNext =
      hasDep('next') ||
      [...workspaceFiles].some(f => NEXT_CONFIG_RE.test(f)) ||
      allFiles.some(f => f.startsWith(`${prefix}app/`) || f.startsWith(`${prefix}pages/`));
    if (isNext) {
      const target = workspaceFiles.has('vercel.json') || hasDep('next') ? 'vercel' : undefined;
      return { kind: 'nextjs-app', deployTarget: target };
    }
  }
  if (hasDep('expo') || workspaceFiles.has('app.json') || [...workspaceFiles].some(f => EXPO_CONFIG_RE.test(f))) {
    const target: DeployTarget | undefined = workspaceFiles.has('eas.json') ? 'eas' : undefined;
    return { kind: 'expo-app', deployTarget: target };
  }
  if (hasDep('electron')) {
    return { kind: 'electron-app' };
  }
  if (pkg?.bin) {
    return { kind: 'cli' };
  }
  if (allFiles.some(f => f.startsWith(`${prefix}public/`)) && !hasDep('next')) {
    return { kind: 'static-site' };
  }
  return null;
}

function collectWorkspacePaths(rootPkg: PackageJson | null, allFiles: string[]): string[] {
  const result = new Set<string>(['']);
  const rawGlobs = Array.isArray(rootPkg?.workspaces)
    ? rootPkg!.workspaces!
    : (rootPkg?.workspaces?.packages ?? []);

  // Glob support is limited to simple "<dir>/*" patterns — sufficient for the
  // workspaces conventions actually used in JS monorepos. Anything more exotic
  // is handled by the manifest-presence walk below.
  for (const glob of rawGlobs) {
    if (!glob) continue;
    if (glob.endsWith('/*')) {
      const base = glob.slice(0, -2);
      const direct = new Set<string>();
      for (const file of allFiles) {
        if (!file.startsWith(`${base}/`)) continue;
        const after = file.slice(base.length + 1);
        const slash = after.indexOf('/');
        if (slash === -1) continue;
        direct.add(`${base}/${after.slice(0, slash)}`);
      }
      for (const d of direct) result.add(d);
    } else if (!glob.includes('*')) {
      result.add(glob);
    }
  }

  // Always include any directory that contains a package.json — covers
  // non-globbed workspaces and standalone packages.
  for (const file of allFiles) {
    const idx = file.lastIndexOf('/');
    if (idx === -1) continue;
    const dir = file.slice(0, idx);
    if (file.endsWith(`/${MANIFEST_NAME}`)) {
      result.add(dir);
    }
  }

  return [...result].sort();
}

function detectMigrations(
  rootFiles: Set<string>,
  allFiles: string[],
  rootScripts: Record<string, string> | undefined
): MigrationsBlock | null {
  const supabaseMigrations = allFiles.filter(f => f.startsWith('supabase/migrations/'));
  if (supabaseMigrations.length > 0 || rootFiles.has('supabase')) {
    const seedFiles: string[] = [];
    if (allFiles.includes('seed.ts')) seedFiles.push('seed.ts');
    if (allFiles.includes('seed.config.ts')) seedFiles.push('seed.config.ts');
    if (allFiles.includes('supabase/seed.sql')) seedFiles.push('supabase/seed.sql');

    const typesOutput = allFiles.find(f => /(^|\/)database\.types\.ts$/.test(f)) ?? null;
    const generate = findScript(rootScripts, ['generate', 'db:types', 'gen:types']);
    const seedSync = findScript(rootScripts, ['seed:sync', 'db:seed:sync']);

    return {
      system: 'supabase',
      migrations_dir: 'supabase/migrations',
      types_output: typesOutput,
      seed_files: seedFiles,
      generate_command: generate,
      seed_sync_command: seedSync
    };
  }

  if (allFiles.some(f => f.startsWith('prisma/migrations/'))) {
    return {
      system: 'prisma',
      migrations_dir: 'prisma/migrations',
      types_output: null,
      seed_files: allFiles.filter(f => /^prisma\/seed\.(ts|js)$/.test(f)),
      generate_command: findScript(rootScripts, ['prisma:generate', 'db:generate']),
      seed_sync_command: findScript(rootScripts, ['prisma:seed', 'db:seed'])
    };
  }

  if (allFiles.some(f => f.startsWith('drizzle/'))) {
    return {
      system: 'drizzle',
      migrations_dir: 'drizzle',
      types_output: null,
      seed_files: [],
      generate_command: findScript(rootScripts, ['drizzle:generate', 'db:generate']),
      seed_sync_command: findScript(rootScripts, ['db:seed', 'seed'])
    };
  }

  return null;
}

function detectCodegen(
  allFiles: string[],
  rootScripts: Record<string, string> | undefined
): CodegenStep[] {
  const out: CodegenStep[] = [];

  if (allFiles.some(f => /\.graphql$/.test(f) || f === 'codegen.yml' || f === 'codegen.ts')) {
    out.push({
      name: 'graphql',
      triggers: ['**/*.graphql', 'codegen.yml', 'codegen.ts'],
      outputs: ['**/__generated__/**'],
      command: findScript(rootScripts, ['codegen', 'graphql:codegen', 'gen:graphql'])
    });
  }
  if (allFiles.some(f => /\.proto$/.test(f))) {
    out.push({
      name: 'protobuf',
      triggers: ['**/*.proto'],
      outputs: [],
      command: findScript(rootScripts, ['proto', 'gen:proto', 'protoc'])
    });
  }
  if (allFiles.includes('openapi.yaml') || allFiles.includes('openapi.json')) {
    out.push({
      name: 'openapi',
      triggers: ['openapi.yaml', 'openapi.json'],
      outputs: [],
      command: findScript(rootScripts, ['openapi', 'gen:openapi'])
    });
  }
  return out;
}

function detectTests(
  rootFiles: Set<string>,
  allFiles: string[],
  rootScripts: Record<string, string> | undefined
): TestsBlock | null {
  const configFiles: string[] = [];
  let runner: TestsBlock['runner'] = null;

  for (const file of rootFiles) {
    if (JEST_CONFIG_RE.test(file)) {
      configFiles.push(file);
      runner = 'jest';
    } else if (VITEST_CONFIG_RE.test(file)) {
      configFiles.push(file);
      runner = 'vitest';
    } else if (PLAYWRIGHT_CONFIG_RE.test(file)) {
      configFiles.push(file);
      runner = runner ?? 'playwright';
    }
  }

  const testDirs = new Set<string>();
  if (allFiles.some(f => f.startsWith('tests/'))) testDirs.add('tests');
  for (const file of allFiles) {
    if (/__tests__\//.test(file)) {
      const idx = file.indexOf('__tests__/');
      const prefix = file.slice(0, idx);
      testDirs.add(`${prefix}__tests__`);
    }
  }

  if (!runner && testDirs.size === 0) return null;

  return {
    runner,
    config_files: configFiles.sort(),
    test_dirs: [...testDirs].sort(),
    script: findScript(rootScripts, ['test', 'test:unit'])
  };
}

function fingerprintInputs(inputs: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const item of [...inputs].sort()) {
    hash.update(item);
    hash.update('\n');
  }
  return hash.digest('hex');
}

export type BuildResult = {
  profile: RepoOperationsProfile;
  fingerprint: string;
};

export async function buildRepoOperationsProfile(rootDirectory: string): Promise<BuildResult> {
  const { files: allFiles } = await listProjectFiles(rootDirectory, { maxFiles: 5000 });
  const rootFiles = new Set(allFiles.filter(f => !f.includes('/')));

  const fingerprintTokens: string[] = [];

  // Root package.json drives workspaces + scripts.
  const rootPkg = await readJsonIfExists<PackageJson>(path.join(rootDirectory, MANIFEST_NAME));
  fingerprintTokens.push(`root:pkg:${JSON.stringify(rootPkg?.workspaces ?? null)}`);
  fingerprintTokens.push(`root:scripts:${Object.keys(rootPkg?.scripts ?? {}).sort().join(',')}`);

  const workspacePaths = collectWorkspacePaths(rootPkg, allFiles);

  const workspaces: Workspace[] = [];
  const deployables: Deployable[] = [];
  const manifests: ManifestEntry[] = [];
  const scriptsByWorkspace: Record<string, Record<string, string>> = {};

  for (const wsPath of workspacePaths) {
    const prefix = wsPath ? `${wsPath}/` : '';
    const workspaceFiles = new Set(
      allFiles
        .filter(f => f.startsWith(prefix) && !f.slice(prefix.length).includes('/'))
        .map(f => f.slice(prefix.length))
    );

    const pkg =
      wsPath === ''
        ? rootPkg
        : await readJsonIfExists<PackageJson>(path.join(rootDirectory, wsPath, MANIFEST_NAME));

    const manifestPath = wsPath ? `${wsPath}/${MANIFEST_NAME}` : MANIFEST_NAME;
    if (!allFiles.includes(manifestPath)) continue;

    const lockfileName = LOCKFILES.find(l => workspaceFiles.has(l.name))?.name ?? null;
    const lockfilePath = lockfileName ? (wsPath ? `${wsPath}/${lockfileName}` : lockfileName) : null;

    const manager = detectManager(rootFiles, workspaceFiles);
    const wsName = pkg?.name ?? (wsPath || path.basename(rootDirectory));

    workspaces.push({
      path: wsPath,
      name: wsName,
      manager,
      has_lockfile: lockfilePath !== null
    });

    manifests.push({ path: manifestPath, lockfile: lockfilePath });

    if (pkg?.scripts) {
      scriptsByWorkspace[wsPath || '.'] = pkg.scripts;
    }

    fingerprintTokens.push(`ws:${wsPath}:deps:${Object.keys({
      ...(pkg?.dependencies ?? {}),
      ...(pkg?.devDependencies ?? {})
    }).sort().join(',')}`);

    const detected = detectDeployableKind(wsPath, pkg ?? null, workspaceFiles, allFiles);
    if (detected) {
      deployables.push({
        kind: detected.kind,
        path: wsPath,
        name: wsName,
        ...(detected.deployTarget ? { deploy_target: detected.deployTarget } : {})
      });
    }
  }

  // Supabase edge functions are individually deployable.
  const edgeFunctionDirs = new Set<string>();
  for (const file of allFiles) {
    const m = file.match(/^supabase\/functions\/([^/]+)\//);
    if (m) edgeFunctionDirs.add(m[1]);
  }
  for (const fn of [...edgeFunctionDirs].sort()) {
    deployables.push({
      kind: 'edge-function',
      path: `supabase/functions/${fn}`,
      name: fn,
      deploy_target: 'supabase'
    });
  }

  const migrations = detectMigrations(rootFiles, allFiles, rootPkg?.scripts);
  const codegen = detectCodegen(allFiles, rootPkg?.scripts);
  const tests = detectTests(rootFiles, allFiles, rootPkg?.scripts);

  const envExamples = allFiles.filter(f => /(^|\/)\.env\.example$/.test(f));
  const signals: RepoSignals = {
    has_dockerfile: rootFiles.has('Dockerfile') || allFiles.some(f => f.endsWith('/Dockerfile')),
    has_docker_compose: allFiles.some(f => /(^|\/)docker-compose\.ya?ml$/.test(f)),
    has_github_actions: allFiles.some(f => f.startsWith('.github/workflows/')),
    has_eas_json: allFiles.some(f => /(^|\/)eas\.json$/.test(f)),
    has_app_store_config: allFiles.some(f => /(^|\/)app-store-config\.json$/.test(f)),
    has_env_example: envExamples.length > 0,
    env_example_paths: envExamples.sort()
  };

  // Existence-only fingerprints for structural files.
  for (const f of [...rootFiles].sort()) fingerprintTokens.push(`root:${f}`);
  for (const f of allFiles.filter(f => f.startsWith('supabase/functions/'))) {
    if (f.endsWith('/index.ts')) fingerprintTokens.push(`fn:${f}`);
  }
  for (const f of allFiles.filter(f => f.startsWith('.github/workflows/'))) {
    fingerprintTokens.push(`wf:${f}`);
  }
  for (const m of manifests) fingerprintTokens.push(`man:${m.path}:lock:${m.lockfile ?? ''}`);

  // Verify any optional config file existence promises that influence deployables.
  for (const ws of workspaces) {
    const dir = ws.path ? path.join(rootDirectory, ws.path) : rootDirectory;
    const exists = await Promise.all(
      ['vercel.json', 'wrangler.toml', 'eas.json', 'app.json', 'next.config.js', 'next.config.ts'].map(
        async name => [name, await fileExists(path.join(dir, name))] as const
      )
    );
    for (const [name, present] of exists) {
      if (present) fingerprintTokens.push(`cfg:${ws.path}:${name}`);
    }
  }

  const profile: RepoOperationsProfile = {
    schema_version: REPO_OPERATIONS_PROFILE_SCHEMA_VERSION,
    workspaces,
    deployables,
    migrations,
    codegen,
    tests,
    manifests,
    scripts_by_workspace: scriptsByWorkspace,
    signals
  };

  return { profile, fingerprint: fingerprintInputs(fingerprintTokens) };
}
