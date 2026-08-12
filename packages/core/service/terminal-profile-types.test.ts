import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  DEFAULT_LAUNCH_SESSION_DEFAULTS,
  LAUNCH_SESSION_METADATA_KEY,
  launchSessionSnapshotFromMetadata,
  parseLaunchSessionDefaults,
  parseTerminalProfileJson,
  resolveLaunchSession,
  serializeLaunchSessionDefaults,
  serializeTerminalProfile,
  type TerminalProfile,
  toLaunchSessionSnapshot,
  viewerKindForLauncher
} from './terminal-profile-types.ts';

describe('stored terminal profile', () => {
  test('a row written before the provider existed resolves to direct execution', () => {
    const legacy = '{"launcher":"iTerm2","placement":"window","chord":null,"background":false}';
    const profile = parseTerminalProfileJson(legacy);

    assert.equal(profile.executionProvider, undefined);
    assert.equal(profile.openViewerOnLaunch, undefined);

    const resolved = resolveLaunchSession({ profile });
    assert.equal(resolved.executionProvider.kind, 'direct');
    assert.equal(resolved.viewer.launcher, 'iTerm2');
    assert.equal(resolved.viewer.openOnLaunch, true);
  });

  test('a profile that never opts in serializes byte-identically to today', () => {
    const legacy = '{"launcher":"iTerm2","placement":"window","chord":null,"background":false}';
    assert.equal(serializeTerminalProfile(parseTerminalProfileJson(legacy)), legacy);
  });

  test('the versioned shape round-trips provider and viewer', () => {
    const profile: TerminalProfile = {
      launcher: 'iTerm2',
      placement: 'window',
      chord: null,
      background: false,
      executionProvider: { kind: 'latch', executable: '/opt/homebrew/bin/latch' },
      openViewerOnLaunch: true
    };
    const stored = JSON.parse(serializeTerminalProfile(profile)) as Record<string, unknown>;

    assert.equal(stored.version, 1);
    assert.deepEqual(stored.executionProvider, {
      kind: 'latch',
      executable: '/opt/homebrew/bin/latch'
    });
    assert.deepEqual(stored.viewer, { kind: 'iterm', openOnLaunch: true });
    assert.deepEqual(parseTerminalProfileJson(JSON.stringify(stored)), profile);
  });

  test('toggling the provider off and on leaves the terminal choice untouched', () => {
    const on: TerminalProfile = {
      launcher: 'iTerm2',
      placement: 'chord',
      chord: 'cmd+d',
      background: true,
      executionProvider: { kind: 'latch', executable: 'latch' }
    };
    const off: TerminalProfile = {
      ...on,
      executionProvider: { kind: 'direct', executable: 'latch' }
    };
    const backOn = parseTerminalProfileJson(
      serializeTerminalProfile({
        ...parseTerminalProfileJson(serializeTerminalProfile(off)),
        executionProvider: { kind: 'latch', executable: 'latch' }
      })
    );

    assert.deepEqual(parseTerminalProfileJson(serializeTerminalProfile(off)).launcher, 'iTerm2');
    assert.equal(backOn.launcher, 'iTerm2');
    assert.equal(backOn.placement, 'chord');
    assert.equal(backOn.chord, 'cmd+d');
    assert.equal(backOn.background, true);
    assert.deepEqual(backOn, on);
  });

  test('a custom latch executable survives switching back to direct', () => {
    const stored = serializeTerminalProfile({
      launcher: 'Terminal',
      placement: 'window',
      chord: null,
      executionProvider: { kind: 'direct', executable: '/usr/local/bin/latch' }
    });
    assert.equal(
      parseTerminalProfileJson(stored).executionProvider?.executable,
      '/usr/local/bin/latch'
    );
  });

  test('an unknown provider kind degrades to direct rather than breaking the launch', () => {
    const profile = parseTerminalProfileJson('{"executionProvider":{"kind":"tmux"}}');
    assert.equal(profile.executionProvider?.kind, 'direct');
    assert.equal(profile.executionProvider?.executable, 'latch');
  });

  test('viewer.kind is a projection of the launcher, never a second stored value', () => {
    assert.equal(viewerKindForLauncher('iTerm2'), 'iterm');
    assert.equal(viewerKindForLauncher('Terminal'), 'terminal');
    assert.equal(viewerKindForLauncher(null), 'inline');
    assert.equal(viewerKindForLauncher('wezterm start --'), 'custom');

    // launcher wins over a stale viewer.kind in the same document
    const profile = parseTerminalProfileJson(
      '{"launcher":"Terminal","viewer":{"kind":"iterm","openOnLaunch":true}}'
    );
    assert.equal(profile.launcher, 'Terminal');
  });

  test('a document with only the versioned viewer block recovers the launcher', () => {
    const profile = parseTerminalProfileJson(
      '{"version":1,"executionProvider":{"kind":"latch","executable":"latch"},"viewer":{"kind":"iterm","openOnLaunch":false}}'
    );
    assert.equal(profile.launcher, 'iTerm2');
    assert.equal(profile.openViewerOnLaunch, false);
    assert.equal(profile.executionProvider?.kind, 'latch');
  });
});

describe('user default and target override', () => {
  test('a target with no provider follows the user default', () => {
    const resolved = resolveLaunchSession({
      profile: { launcher: 'Terminal', placement: 'window', chord: null },
      defaults: {
        executionProvider: { kind: 'latch', executable: 'latch' },
        openViewerOnLaunch: false
      }
    });
    assert.equal(resolved.executionProvider.kind, 'latch');
    assert.equal(resolved.executionProviderSource, 'user_default');
    assert.equal(resolved.viewer.openOnLaunch, false);
    assert.equal(resolved.viewerOpenSource, 'user_default');
  });

  test('a target override wins over the user default', () => {
    const resolved = resolveLaunchSession({
      profile: {
        launcher: 'Terminal',
        placement: 'window',
        chord: null,
        executionProvider: { kind: 'direct', executable: 'latch' },
        openViewerOnLaunch: true
      },
      defaults: {
        executionProvider: { kind: 'latch', executable: 'latch' },
        openViewerOnLaunch: false
      }
    });
    assert.equal(resolved.executionProvider.kind, 'direct');
    assert.equal(resolved.executionProviderSource, 'target');
    assert.equal(resolved.viewer.openOnLaunch, true);
    assert.equal(resolved.viewerOpenSource, 'target');
  });

  test('a profile with no stored default reads as direct with a viewer on launch', () => {
    assert.deepEqual(parseLaunchSessionDefaults(undefined), DEFAULT_LAUNCH_SESSION_DEFAULTS);
    assert.deepEqual(
      parseLaunchSessionDefaults(serializeLaunchSessionDefaults(DEFAULT_LAUNCH_SESSION_DEFAULTS)),
      DEFAULT_LAUNCH_SESSION_DEFAULTS
    );
  });

  test('the stored user default round-trips', () => {
    const defaults = {
      executionProvider: { kind: 'latch' as const, executable: 'latch' },
      openViewerOnLaunch: false
    };
    assert.deepEqual(
      parseLaunchSessionDefaults(serializeLaunchSessionDefaults(defaults)),
      defaults
    );
  });
});

describe('execution request snapshot', () => {
  test('a snapshot survives a later settings change', () => {
    const claimed = toLaunchSessionSnapshot(
      resolveLaunchSession({
        profile: {
          launcher: 'iTerm2',
          placement: 'window',
          chord: null,
          executionProvider: { kind: 'latch', executable: 'latch' }
        }
      }),
      '2026-08-12T00:00:00.000Z'
    );
    const metadata = { [LAUNCH_SESSION_METADATA_KEY]: claimed, someOtherKey: 'kept' };

    const read = launchSessionSnapshotFromMetadata(metadata);
    assert.equal(read?.executionProvider.kind, 'latch');
    assert.equal(read?.viewer.launcher, 'iTerm2');
    assert.equal(read?.resolvedAt, '2026-08-12T00:00:00.000Z');
  });

  test('a request claimed before snapshots existed reads as absent, not as an error', () => {
    assert.equal(launchSessionSnapshotFromMetadata({}), null);
    assert.equal(launchSessionSnapshotFromMetadata(null), null);
    assert.equal(launchSessionSnapshotFromMetadata({ launchSession: 'nonsense' }), null);
    assert.equal(launchSessionSnapshotFromMetadata({ launchSession: { version: 99 } }), null);
  });
});
