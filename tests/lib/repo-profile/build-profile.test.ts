import path from 'node:path';

import { buildRepoOperationsProfile } from '@/lib/repo-profile/build-profile';

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('buildRepoOperationsProfile (against this repo)', () => {
  it('detects supabase migrations + types output + edge functions + nextjs/expo deployables', async () => {
    const { profile, fingerprint } = await buildRepoOperationsProfile(REPO_ROOT);

    expect(profile.schema_version).toBe(1);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);

    expect(profile.migrations?.system).toBe('supabase');
    expect(profile.migrations?.migrations_dir).toBe('supabase/migrations');
    expect(profile.migrations?.types_output).toMatch(/database\.types\.ts$/);
    expect(profile.migrations?.generate_command).toBe('generate');

    const kinds = new Set(profile.deployables.map(d => d.kind));
    expect(kinds.has('edge-function')).toBe(true);
    expect(kinds.has('nextjs-app')).toBe(true);
    expect(kinds.has('expo-app')).toBe(true);

    const edgeFns = profile.deployables.filter(d => d.kind === 'edge-function');
    expect(edgeFns.find(f => f.name === 'generate-feed-post')).toBeDefined();

    const manifestPaths = new Set(profile.manifests.map(m => m.path));
    expect(manifestPaths.has('package.json')).toBe(true);

    expect(profile.signals.has_github_actions).toBe(true);
  });

  it('produces a stable serialized size under 16 KB', async () => {
    const { profile } = await buildRepoOperationsProfile(REPO_ROOT);
    const size = Buffer.byteLength(JSON.stringify(profile), 'utf8');
    expect(size).toBeLessThan(16 * 1024);
  });
});
