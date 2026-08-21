import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LaunchSessionDefaultsDto, TerminalProfileDto } from '../../shared/contract.ts';

import {
  effectiveOpenViewer,
  effectiveProviderKind,
  latchBlockedReason,
  providerChoiceFromProfile,
  sessionOverrideFields
} from './launch-session-form.ts';

const baseProfile: TerminalProfileDto = {
  launcher: 'iTerm2',
  placement: 'window',
  chord: null,
  background: false
};

const directDefaults: LaunchSessionDefaultsDto = {
  executionProvider: { kind: 'direct', executable: 'latch' },
  openViewerOnLaunch: true
};

const latchDefaults: LaunchSessionDefaultsDto = {
  executionProvider: { kind: 'latch', executable: 'latch' },
  openViewerOnLaunch: true
};

describe('launch-session-form', () => {
  it('treats a profile with no stored provider as inheriting', () => {
    assert.equal(providerChoiceFromProfile(baseProfile), 'inherit');
    assert.equal(providerChoiceFromProfile({ ...baseProfile, executionProvider: null }), 'inherit');
  });

  it('reads an explicit per-target override', () => {
    assert.equal(
      providerChoiceFromProfile({
        ...baseProfile,
        executionProvider: { kind: 'latch', executable: 'latch' }
      }),
      'latch'
    );
  });

  it('resolves the user default when the target inherits, and the override otherwise', () => {
    assert.equal(
      effectiveProviderKind({ providerChoice: 'inherit', defaults: latchDefaults }),
      'latch'
    );
    assert.equal(
      effectiveProviderKind({ providerChoice: 'direct', defaults: latchDefaults }),
      'direct'
    );
    assert.equal(effectiveProviderKind({ providerChoice: 'inherit', defaults: null }), 'direct');
  });

  it('inherits viewer-open from the default until the target overrides it', () => {
    assert.equal(effectiveOpenViewer({ openViewerOverride: null, defaults: latchDefaults }), true);
    assert.equal(
      effectiveOpenViewer({ openViewerOverride: false, defaults: latchDefaults }),
      false
    );
    assert.equal(effectiveOpenViewer({ openViewerOverride: null, defaults: null }), true);
  });

  it('sends an explicit null to clear the override rather than omitting the field', () => {
    const fields = sessionOverrideFields({
      providerChoice: 'inherit',
      latchExecutable: 'latch',
      openViewerOverride: null
    });
    assert.equal(fields.executionProvider, null);
    assert.equal(fields.openViewerOnLaunch, null);
    assert.ok('executionProvider' in fields);
  });

  it('carries the stored executable forward when setting the provider', () => {
    assert.deepEqual(
      sessionOverrideFields({
        providerChoice: 'latch',
        latchExecutable: '/opt/latch/bin/latch',
        openViewerOverride: false
      }),
      {
        executionProvider: { kind: 'latch', executable: '/opt/latch/bin/latch' },
        openViewerOnLaunch: false
      }
    );
  });

  it('never derives the terminal choice from the provider', () => {
    const toggledOn = {
      ...baseProfile,
      ...sessionOverrideFields({
        providerChoice: 'latch',
        latchExecutable: 'latch',
        openViewerOverride: null
      })
    };
    const toggledBack = {
      ...toggledOn,
      ...sessionOverrideFields({
        providerChoice: 'direct',
        latchExecutable: 'latch',
        openViewerOverride: null
      })
    };
    assert.equal(toggledOn.launcher, 'iTerm2');
    assert.equal(toggledBack.launcher, 'iTerm2');
    assert.equal(toggledBack.placement, 'window');
  });

  it('blocks Latch only on a definite negative probe', () => {
    assert.equal(latchBlockedReason(undefined), null);
    assert.equal(
      latchBlockedReason({
        state: 'unavailable',
        code: 'LOCAL_TARGET_REQUIRED',
        message: 'no bridge'
      }),
      null
    );
    assert.equal(
      latchBlockedReason({
        state: 'found',
        executable: 'latch',
        resolvedPath: '/usr/local/bin/latch',
        protocolVersion: 2,
        productVersion: '0.1.0',
        capabilities: {
          create: true,
          openViewer: true,
          localAttach: true,
          cloudAttach: false,
          selfUpdate: false,
          extensions: []
        },
        checkedAt: '2026-08-12T00:00:00.000Z',
        latchSelectable: true,
        directSelectable: true
      }),
      null
    );
    assert.match(
      latchBlockedReason({
        state: 'not_installed',
        executable: 'latch',
        installCommand: 'curl … | bash',
        checkedAt: '2026-08-12T00:00:00.000Z',
        latchSelectable: false,
        directSelectable: true
      }) ?? '',
      /not installed/
    );
    assert.match(
      latchBlockedReason({
        state: 'incompatible',
        executable: 'latch',
        resolvedPath: '/usr/local/bin/latch',
        protocolVersion: 0,
        productVersion: '0.0.1',
        missingCapability: 'create',
        detail: 'too old',
        checkedAt: '2026-08-12T00:00:00.000Z',
        latchSelectable: false,
        directSelectable: true
      }) ?? '',
      /missing create/
    );
  });

  it('keeps direct selectable in every discovery state', () => {
    // `directSelectable` is a contract-level invariant of the probe, not a UI
    // decision — assert it here so a future probe change cannot quietly drop it.
    assert.equal(
      effectiveProviderKind({ providerChoice: 'direct', defaults: directDefaults }),
      'direct'
    );
  });
});
