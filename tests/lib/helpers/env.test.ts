import { getWorkspaceRoot } from '@/lib/env';

describe('workspace root helpers', () => {
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;

  afterEach(() => {
    if (originalWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    }
  });

  it('uses the provided fallback when WORKSPACE_ROOT is unset', () => {
    delete process.env.WORKSPACE_ROOT;

    expect(getWorkspaceRoot('/tmp/project-root')).toBe('/tmp/project-root');
  });

  it('ignores blank WORKSPACE_ROOT values and falls back to the project directory', () => {
    process.env.WORKSPACE_ROOT = '   ';

    expect(getWorkspaceRoot('/tmp/project-root')).toBe('/tmp/project-root');
  });

  it('prefers a non-empty WORKSPACE_ROOT value', () => {
    process.env.WORKSPACE_ROOT = ' /tmp/env-root ';

    expect(getWorkspaceRoot('/tmp/project-root')).toBe('/tmp/env-root');
  });
});
