import path from 'node:path';

import { envWithUserCliPath, prependUserCliBinsToPath } from '@/lib/os/cli-path-env';

describe('prependUserCliBinsToPath', () => {
  it('prefixes standard dirs before the existing PATH', () => {
    const next = prependUserCliBinsToPath('/usr/bin:/bin');
    expect(next.endsWith(`${path.delimiter}/usr/bin:/bin`)).toBe(true);
    if (process.platform === 'win32') {
      expect(next.length).toBeGreaterThan('/usr/bin:/bin'.length);
    } else {
      expect(next).toContain('/opt/homebrew/bin');
    }
  });

  it('returns only prefixes when PATH is empty', () => {
    const next = prependUserCliBinsToPath(undefined);
    expect(next.length).toBeGreaterThan(0);
    if (process.platform !== 'win32') {
      expect(next).toMatch(/homebrew|\.local|cargo/);
    }
  });
});

describe('envWithUserCliPath', () => {
  it('merges PATH without dropping other keys', () => {
    const env = envWithUserCliPath({ FOO: 'bar', PATH: '/x' });
    expect(env.FOO).toBe('bar');
    expect(env.PATH).toContain('/x');
  });
});
