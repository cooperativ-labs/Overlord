export const REPO_OPERATIONS_PROFILE_SCHEMA_VERSION = 1 as const;

export type WorkspaceManager = 'yarn' | 'npm' | 'pnpm' | 'bun';

export type DeployableKind =
  | 'nextjs-app'
  | 'expo-app'
  | 'electron-app'
  | 'edge-function'
  | 'vercel-project'
  | 'cloudflare-worker'
  | 'static-site'
  | 'cli'
  | 'library';

export type DeployTarget = 'vercel' | 'supabase' | 'eas' | 'testflight' | 'cloudflare';

export type Workspace = {
  path: string;
  name: string;
  manager: WorkspaceManager | null;
  has_lockfile: boolean;
};

export type Deployable = {
  kind: DeployableKind;
  path: string;
  name: string;
  deploy_target?: DeployTarget;
};

export type MigrationsBlock = {
  system: 'supabase' | 'prisma' | 'drizzle' | 'knex' | 'flyway' | null;
  migrations_dir: string | null;
  types_output: string | null;
  seed_files: string[];
  generate_command: string | null;
  seed_sync_command: string | null;
};

export type CodegenStep = {
  name: string;
  triggers: string[];
  outputs: string[];
  command: string | null;
};

export type TestsBlock = {
  runner: 'jest' | 'vitest' | 'playwright' | 'cypress' | 'detox' | null;
  config_files: string[];
  test_dirs: string[];
  script: string | null;
};

export type ManifestEntry = {
  path: string;
  lockfile: string | null;
};

export type RepoSignals = {
  has_dockerfile: boolean;
  has_docker_compose: boolean;
  has_github_actions: boolean;
  has_eas_json: boolean;
  has_app_store_config: boolean;
  has_env_example: boolean;
  env_example_paths: string[];
};

export type RepoOperationsProfile = {
  schema_version: typeof REPO_OPERATIONS_PROFILE_SCHEMA_VERSION;
  workspaces: Workspace[];
  deployables: Deployable[];
  migrations: MigrationsBlock | null;
  codegen: CodegenStep[];
  tests: TestsBlock | null;
  manifests: ManifestEntry[];
  scripts_by_workspace: Record<string, Record<string, string>>;
  signals: RepoSignals;
};
