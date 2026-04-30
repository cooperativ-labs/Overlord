import { deriveCandidateActions } from '@/lib/feed/operations-rules';
import type { RepoOperationsProfile } from '@/lib/repo-profile/types';

const baseProfile: RepoOperationsProfile = {
  schema_version: 1,
  workspaces: [
    { path: '', name: 'overlord', manager: 'yarn', has_lockfile: true },
    { path: 'apps/web', name: '@overlord/web', manager: 'yarn', has_lockfile: false },
    { path: 'apps/mobile', name: '@overlord/mobile', manager: 'yarn', has_lockfile: false }
  ],
  deployables: [
    { kind: 'nextjs-app', path: 'apps/web', name: '@overlord/web', deploy_target: 'vercel' },
    { kind: 'expo-app', path: 'apps/mobile', name: '@overlord/mobile', deploy_target: 'eas' },
    {
      kind: 'edge-function',
      path: 'supabase/functions/generate-feed-post',
      name: 'generate-feed-post',
      deploy_target: 'supabase'
    }
  ],
  migrations: {
    system: 'supabase',
    migrations_dir: 'supabase/migrations',
    types_output: 'types/database.types.ts',
    seed_files: ['seed.ts', 'supabase/seed.sql'],
    generate_command: 'generate',
    seed_sync_command: 'seed:sync'
  },
  codegen: [],
  tests: { runner: 'jest', config_files: ['jest.config.js'], test_dirs: ['tests'], script: 'test' },
  manifests: [
    { path: 'package.json', lockfile: 'yarn.lock' },
    { path: 'apps/web/package.json', lockfile: null },
    { path: 'apps/mobile/package.json', lockfile: null }
  ],
  scripts_by_workspace: {
    '.': { generate: 'node scripts/x.js', 'seed:sync': 'node scripts/seed-sync.js' }
  },
  signals: {
    has_dockerfile: false,
    has_docker_compose: false,
    has_github_actions: true,
    has_eas_json: true,
    has_app_store_config: false,
    has_env_example: true,
    env_example_paths: ['.env.example']
  }
};

describe('deriveCandidateActions', () => {
  it('returns no candidates when changedPaths is empty', () => {
    expect(deriveCandidateActions(baseProfile, [])).toEqual([]);
  });

  it('returns no candidates when profile is null', () => {
    expect(deriveCandidateActions(null, ['apps/web/page.tsx'])).toEqual([]);
  });

  it('fires migration + regenerate-types when a migration changes', () => {
    const ids = deriveCandidateActions(baseProfile, ['supabase/migrations/20260430_x.sql']).map(
      a => a.id
    );
    expect(ids).toEqual(
      expect.arrayContaining(['supabase.run-migrations', 'supabase.regenerate-types'])
    );
  });

  it('fires seed-sync when seed file changes', () => {
    const ids = deriveCandidateActions(baseProfile, ['seed.ts']).map(a => a.id);
    expect(ids).toContain('supabase.seed-sync');
  });

  it('fires deploy-edge-fn and suppresses vercel.redeploy when both would match', () => {
    const ids = deriveCandidateActions(baseProfile, [
      'supabase/functions/generate-feed-post/index.ts'
    ]).map(a => a.id);
    expect(ids).toContain('supabase.deploy-edge-fn');
    expect(ids).not.toContain('vercel.redeploy');
  });

  it('fires vercel.redeploy when only the next.js app changes', () => {
    const ids = deriveCandidateActions(baseProfile, ['apps/web/app/page.tsx']).map(a => a.id);
    expect(ids).toContain('vercel.redeploy');
    expect(ids).not.toContain('supabase.deploy-edge-fn');
  });

  it('fires expo.rebuild-dev-client on native file change', () => {
    const ids = deriveCandidateActions(baseProfile, ['apps/mobile/ios/Podfile']).map(a => a.id);
    expect(ids).toContain('expo.rebuild-dev-client');
  });

  it('fires pkg.reinstall when a package.json changes', () => {
    const ids = deriveCandidateActions(baseProfile, ['apps/web/package.json']).map(a => a.id);
    expect(ids).toContain('pkg.reinstall');
  });

  it('fires lockfile-conflict only when lockfile changed without manifest', () => {
    const both = deriveCandidateActions(baseProfile, ['package.json', 'yarn.lock']).map(a => a.id);
    expect(both).not.toContain('pkg.lockfile-conflict');

    const lockOnly = deriveCandidateActions(baseProfile, ['yarn.lock']).map(a => a.id);
    expect(lockOnly).toContain('pkg.lockfile-conflict');
  });

  it('fires env.new-vars when .env.example changes', () => {
    const ids = deriveCandidateActions(baseProfile, ['.env.example']).map(a => a.id);
    expect(ids).toContain('env.new-vars');
  });

  it('fires ci.workflow-changed for workflow yml edits', () => {
    const ids = deriveCandidateActions(baseProfile, ['.github/workflows/ci.yml']).map(a => a.id);
    expect(ids).toContain('ci.workflow-changed');
  });

  it('does not fire test-runner suggestions by default', () => {
    const ids = deriveCandidateActions(baseProfile, ['apps/web/lib/foo.ts']).map(a => a.id);
    expect(ids).not.toContain('tests.run-targeted');
  });

  it('produces at most ~12 candidates with fully-saturated changes', () => {
    const ids = deriveCandidateActions(baseProfile, [
      'supabase/migrations/x.sql',
      'seed.ts',
      'supabase/functions/generate-feed-post/index.ts',
      'apps/web/app/page.tsx',
      'apps/mobile/ios/Podfile',
      'package.json',
      '.env.example',
      '.github/workflows/ci.yml'
    ]).map(a => a.id);
    expect(ids.length).toBeLessThanOrEqual(12);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
