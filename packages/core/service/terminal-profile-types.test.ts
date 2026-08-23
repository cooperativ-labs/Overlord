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
    assert.deepEqual(stored.viewer, { kind: 'iterm', openAs: 'window', openOnLaunch: true });
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

describe('window-or-tab preference reaching a delegated viewer', () => {
  test('the resolved viewer projects the profile placement, not a second setting', () => {
    const profile = (placement: TerminalProfile['placement']): TerminalProfile => ({
      launcher: 'iTerm2',
      placement,
      chord: placement === 'chord' ? 'cmd d' : null,
      background: false,
      executionProvider: { kind: 'latch', executable: 'latch' }
    });

    assert.equal(resolveLaunchSession({ profile: profile('tab') }).viewer.openAs, 'tab');
    assert.equal(resolveLaunchSession({ profile: profile('window') }).viewer.openAs, 'window');
    // Latch cannot send a split-pane keystroke, so `chord` degrades to a window
    // rather than failing the open of a session that is already running.
    assert.equal(resolveLaunchSession({ profile: profile('chord') }).viewer.openAs, 'window');
  });

  test('the claim-time snapshot carries the shape through to the open', () => {
    const claimed = toLaunchSessionSnapshot(
      resolveLaunchSession({
        profile: {
          launcher: 'iTerm2',
          placement: 'tab',
          chord: null,
          executionProvider: { kind: 'latch', executable: 'latch' }
        }
      }),
      '2026-08-14T00:00:00.000Z'
    );
    const read = launchSessionSnapshotFromMetadata({ [LAUNCH_SESSION_METADATA_KEY]: claimed });
    assert.equal(read?.viewer.openAs, 'tab');
  });

  test('a snapshot frozen before the shape existed reads as window', () => {
    const read = launchSessionSnapshotFromMetadata({
      [LAUNCH_SESSION_METADATA_KEY]: {
        version: 1,
        executionProvider: { kind: 'latch', executable: 'latch' },
        viewer: { kind: 'iterm', launcher: 'iTerm2', openOnLaunch: true },
        resolvedAt: '2026-08-12T00:00:00.000Z'
      }
    });
    assert.equal(read?.viewer.openAs, 'window');
  });

  test('a document carrying only the viewer block recovers its placement', () => {
    const parsed = parseTerminalProfileJson(
      JSON.stringify({
        version: 1,
        executionProvider: { kind: 'latch', executable: 'latch' },
        viewer: { kind: 'iterm', openAs: 'tab', openOnLaunch: true }
      })
    );
    assert.equal(parsed.placement, 'tab');
    assert.equal(parsed.launcher, 'iTerm2');
  });
});

describe('the provider and the viewer stay orthogonal', () => {
  test('provider=latch with no viewer is a valid, complete choice', () => {
    // A Latch session can be created headless: the agent runs, and nobody is
    // looking at it yet. Collapsing Latch into the terminal list would make
    // this state unrepresentable.
    const profile: TerminalProfile = {
      launcher: null,
      placement: 'window',
      chord: null,
      executionProvider: { kind: 'latch', executable: 'latch' },
      openViewerOnLaunch: false
    };
    const resolved = resolveLaunchSession({ profile });

    assert.equal(resolved.executionProvider.kind, 'latch');
    assert.equal(resolved.viewer.kind, 'inline');
    assert.equal(resolved.viewer.launcher, null);
    assert.equal(resolved.viewer.openOnLaunch, false);

    // And it survives a storage round trip rather than being normalized into
    // some viewer the user did not pick.
    const stored = parseTerminalProfileJson(serializeTerminalProfile(profile));
    assert.equal(stored.executionProvider?.kind, 'latch');
    assert.equal(stored.launcher, null);
    assert.equal(stored.openViewerOnLaunch, false);
  });

  test('changing the viewer leaves the provider session untouched', () => {
    // Latch attach is exclusive: opening a session in a different terminal
    // steals the one surface rather than creating a second one. That is only
    // safe if changing the viewer does not also change the provider, which
    // would recreate the agent session instead of moving the window.
    const provider = { kind: 'latch' as const, executable: '/opt/homebrew/bin/latch' };
    const before: TerminalProfile = {
      launcher: 'iTerm2',
      placement: 'window',
      chord: null,
      executionProvider: provider
    };
    const after: TerminalProfile = { ...before, launcher: 'Terminal', placement: 'tab' };

    const first = resolveLaunchSession({ profile: before });
    const second = resolveLaunchSession({ profile: after });

    assert.equal(first.viewer.kind, 'iterm');
    assert.equal(second.viewer.kind, 'terminal');
    assert.equal(second.viewer.openAs, 'tab');
    assert.deepEqual(second.executionProvider, first.executionProvider);
    assert.equal(second.executionProviderSource, first.executionProviderSource);

    // Switching all the way to no viewer is the same story.
    const none = resolveLaunchSession({
      profile: { ...before, launcher: null }
    });
    assert.equal(none.viewer.kind, 'inline');
    assert.deepEqual(none.executionProvider, first.executionProvider);
  });

  test('a viewer choice alone never turns execution into a Latch session', () => {
    // The inverse direction: picking a terminal is not a way to opt into the
    // persistent provider, so the two axes cannot be collapsed from either end.
    const resolved = resolveLaunchSession({
      profile: { launcher: 'iTerm2', placement: 'window', chord: null }
    });
    assert.equal(resolved.executionProvider.kind, 'direct');
    assert.equal(resolved.viewer.kind, 'iterm');
  });
});
