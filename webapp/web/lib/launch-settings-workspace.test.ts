import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveLaunchSettingsWorkspaceId } from './launch-settings-workspace.ts';

describe('resolveLaunchSettingsWorkspaceId', () => {
  const workspaces = [{ id: 'workspace-a' }, { id: 'workspace-b' }];

  it('uses the explicit workspace selected for this machine', () => {
    assert.equal(
      resolveLaunchSettingsWorkspaceId({
        selectedWorkspaceId: 'workspace-b',
        defaultWorkspaceId: 'workspace-a',
        workspaces
      }),
      'workspace-b'
    );
  });

  it('uses the server default when the user has not selected a workspace', () => {
    assert.equal(
      resolveLaunchSettingsWorkspaceId({
        selectedWorkspaceId: null,
        defaultWorkspaceId: 'workspace-b',
        workspaces
      }),
      'workspace-b'
    );
  });

  it('falls back to the first accessible workspace and never returns a stale scope', () => {
    assert.equal(
      resolveLaunchSettingsWorkspaceId({
        selectedWorkspaceId: 'removed-workspace',
        defaultWorkspaceId: 'also-removed',
        workspaces
      }),
      'workspace-a'
    );
    assert.equal(
      resolveLaunchSettingsWorkspaceId({
        selectedWorkspaceId: null,
        defaultWorkspaceId: null,
        workspaces: []
      }),
      null
    );
  });
});
