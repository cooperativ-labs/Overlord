import type { RepoOperationsProfile } from '@/lib/repo-profile/types';
import {
  buildTaggingInspector,
  formatTaggingDebugOutput,
  reconcileEngineAssignments,
  runTaggingEngine
} from '@/lib/tagging-engine';

const baseProfile: RepoOperationsProfile = {
  schema_version: 1,
  workspaces: [
    { path: '', name: 'overlord', manager: 'yarn', has_lockfile: true },
    { path: 'apps/web', name: '@overlord/web', manager: 'yarn', has_lockfile: false },
    { path: 'apps/desktop', name: '@overlord/desktop', manager: 'yarn', has_lockfile: false },
    { path: 'apps/mobile', name: '@overlord/mobile', manager: 'yarn', has_lockfile: false }
  ],
  deployables: [
    { kind: 'nextjs-app', path: 'apps/web', name: '@overlord/web', deploy_target: 'vercel' },
    { kind: 'electron-app', path: 'apps/desktop', name: '@overlord/desktop' },
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
  tests: {
    runner: 'jest',
    config_files: ['jest.config.js'],
    test_dirs: ['tests'],
    script: 'test'
  },
  manifests: [{ path: 'package.json', lockfile: 'yarn.lock' }],
  scripts_by_workspace: { '.': { test: 'jest' } },
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

describe('runTaggingEngine', () => {
  it('maps explicit Overlord paths to the expected tags', () => {
    const result = runTaggingEngine({
      description: {
        title: 'Update path-based tagging',
        objective:
          'Touch apps/web/app/page.tsx, apps/desktop/electron/main.ts, apps/mobile/app/index.tsx, supabase/functions/mcp/index.ts, supabase/migrations/20260502_add_tags.sql, and types/database.types.ts.'
      }
    });

    expect(result.matchedTags.map(tag => tag.key)).toEqual([
      'database',
      'desktop',
      'edge',
      'mobile-app',
      'webapp'
    ]);
  });

  it('combines keywords, repo profile signals, and execution paths deterministically', () => {
    const result = runTaggingEngine({
      description: {
        title: 'Deploy webhook updates for the browser component',
        acceptanceCriteria: 'Update the Next.js app router flow and the Supabase function webhook.'
      },
      repoProfile: baseProfile,
      executionEvidence: {
        changedPaths: [
          'apps/web/app/api/protocol/update/route.ts',
          'supabase/functions/mcp/index.ts'
        ]
      }
    });

    expect(result.scores[0]?.tagKey).toBe('webapp');
    expect(result.matchedTags.map(tag => tag.key)).toEqual(
      expect.arrayContaining(['webapp', 'edge', 'database', 'desktop', 'mobile-app'])
    );
  });

  it('supports thresholded matching with structured debug output', () => {
    const result = runTaggingEngine({
      description: {
        title: 'Investigate migration plan',
        acceptanceCriteria: 'Review SQL table changes and seed workflow.'
      },
      threshold: 40
    });

    expect(result.matchedTags.map(tag => tag.key)).toEqual(['database']);

    const debug = formatTaggingDebugOutput(result.debug);
    expect(debug).toContain('threshold: 40');
    expect(debug).toContain('database:');
    expect(debug).toContain('[ticket-text] keyword_match +25');
  });

  it('derives execution enrichment from commands and file change metadata', () => {
    const result = runTaggingEngine({
      description: {
        title: 'Follow-up tagging pass'
      },
      executionEvidence: {
        commands: [
          'yarn workspace @overlord/web test',
          'supabase functions deploy generate-feed-post'
        ],
        fileChanges: [
          {
            filePath: 'apps/web/app/api/protocol/update/route.ts',
            summary: 'Update browser-facing protocol route'
          }
        ]
      }
    });

    expect(result.matchedTags.map(tag => tag.key)).toEqual(
      expect.arrayContaining(['edge', 'webapp'])
    );
    expect(result.debug.consideredCommands).toEqual([
      'supabase functions deploy generate-feed-post',
      'yarn workspace @overlord/web test'
    ]);
    expect(result.debug.consideredPaths).toContain('apps/web/app/api/protocol/update/route.ts');
  });
});

describe('reconcileEngineAssignments', () => {
  it('adds and removes only engine-owned assignments while respecting suppressions', () => {
    const result = reconcileEngineAssignments({
      candidates: [
        { tagKey: 'webapp', total: 165, matched: true },
        { tagKey: 'database', total: 115, matched: true },
        { tagKey: 'desktop', total: 0, matched: false }
      ],
      existingAssignments: [
        { tagKey: 'desktop', source: 'engine' },
        { tagKey: 'database', source: 'engine' },
        { tagKey: 'webapp', source: 'user' }
      ],
      suppressions: [{ tagKey: 'database', reason: 'user_removed_engine_tag' }]
    });

    expect(result.addEngineTagKeys).toEqual(['webapp']);
    expect(result.removeEngineTagKeys).toEqual(['database', 'desktop']);
    expect(result.userOwnedTagKeys).toEqual(['webapp']);
    expect(result.suppressedTagKeys).toEqual(['database']);
  });

  it('builds a structured inspector with provenance and suppressions', () => {
    const engineResult = runTaggingEngine({
      description: {
        title: 'Review browser deploy and migration commands',
        acceptanceCriteria: 'Run the Next.js workflow and Supabase migration.'
      }
    });

    const existingAssignments = [
      { tagKey: 'webapp', source: 'engine' as const },
      { tagKey: 'database', source: 'user' as const }
    ];
    const suppressions = [{ tagKey: 'edge', reason: 'user_removed_engine_tag' }];
    const reconciliation = reconcileEngineAssignments({
      candidates: engineResult.scores,
      existingAssignments,
      suppressions
    });

    const inspector = buildTaggingInspector({
      debug: engineResult.debug,
      existingAssignments,
      reconciliation,
      suppressions
    });

    expect(inspector.tags.find(tag => tag.tagKey === 'webapp')).toMatchObject({
      engineDecision: 'keep'
    });
    expect(inspector.tags.find(tag => tag.tagKey === 'database')).toMatchObject({
      assignments: [{ source: 'user', state: 'present' }]
    });
    expect(inspector.tags.find(tag => tag.tagKey === 'edge')).toMatchObject({
      suppressions: [{ reason: 'user_removed_engine_tag', tagKey: 'edge' }]
    });
  });
});
