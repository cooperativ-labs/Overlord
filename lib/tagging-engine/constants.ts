import type { TagDefinition, TagRule } from './types';

export const TAG_SCORE_WEIGHTS = {
  explicitPathMatch: 100,
  workspaceMatch: 50,
  strongKeywordHit: 25,
  repoProfileSignal: 15,
  contradictorySignal: -20
} as const;

export const DEFAULT_TAG_THRESHOLD = 25;

export const OVERLORD_DEFAULT_TAG_DEFINITIONS: TagDefinition[] = [
  { key: 'webapp', label: 'webapp' },
  { key: 'desktop', label: 'desktop' },
  { key: 'mobile-app', label: 'mobile app' },
  { key: 'edge', label: 'edge' },
  { key: 'database', label: 'database' }
];

export const OVERLORD_TAG_RULES: TagRule[] = [
  {
    key: 'webapp',
    label: 'webapp',
    pathPrefixes: ['apps/web'],
    exactPaths: [],
    keywords: ['next.js', 'nextjs', 'app router', 'vercel'],
    repoProfileHints: [
      { workspacePath: 'apps/web' },
      { deployablePath: 'apps/web', deployableKind: 'nextjs-app' },
      { deployTarget: 'vercel' }
    ]
  },
  {
    key: 'desktop',
    label: 'desktop',
    pathPrefixes: ['apps/desktop'],
    exactPaths: [],
    keywords: ['electron', 'desktop', 'ipc', 'preload', 'packaged app'],
    repoProfileHints: [
      { workspacePath: 'apps/desktop' },
      { deployablePath: 'apps/desktop', deployableKind: 'electron-app' }
    ]
  },
  {
    key: 'mobile-app',
    label: 'mobile app',
    pathPrefixes: ['apps/mobile'],
    exactPaths: [],
    keywords: ['expo', 'react native', 'device build'],
    repoProfileHints: [
      { workspacePath: 'apps/mobile' },
      { deployablePath: 'apps/mobile', deployableKind: 'expo-app' }
    ]
  },
  {
    key: 'edge',
    label: 'edge',
    pathPrefixes: ['supabase/functions'],
    exactPaths: [],
    keywords: ['edge function', 'supabase function', 'webhook', 'deno'],
    repoProfileHints: [
      {
        deployablePath: 'supabase/functions',
        deployableKind: 'edge-function',
        deployTarget: 'supabase'
      }
    ]
  },
  {
    key: 'database',
    label: 'database',
    pathPrefixes: ['supabase/migrations'],
    exactPaths: ['seed.ts', 'supabase/seed.sql', 'types/database.types.ts'],
    keywords: ['migration', 'schema', 'rls', 'sql', 'seed'],
    repoProfileHints: [
      {
        migrationSystem: 'supabase',
        migrationsDir: 'supabase/migrations',
        typesOutput: 'types/database.types.ts',
        seedPaths: ['seed.ts', 'supabase/seed.sql']
      }
    ]
  }
];
