import assert from 'node:assert/strict';
import test from 'node:test';

import {
  missionBannerShellCommands,
  missionDeepLink,
  missionLinkLine,
  missionTerminalTitle,
  sanitizeTerminalText,
  shouldUseTerminalHyperlinks
} from '../src/mission-link.ts';

test('missionDeepLink builds the credential-free Desktop URL', () => {
  assert.equal(missionDeepLink('coo:502'), 'overlord://missions/coo:502');
  assert.equal(missionDeepLink('  coo:502  '), 'overlord://missions/coo:502');
});

test('missionLinkLine plain form includes the URL and optional title', () => {
  assert.equal(
    missionLinkLine({ displayId: 'coo:502', hyperlink: false }),
    'coo:502 · overlord://missions/coo:502'
  );
  assert.equal(
    missionLinkLine({
      displayId: 'coo:502',
      title: 'Investigate linking',
      hyperlink: false
    }),
    'coo:502 · overlord://missions/coo:502 — Investigate linking'
  );
});

test('missionLinkLine OSC 8 wraps the titled label', () => {
  const line = missionLinkLine({
    displayId: 'coo:502',
    title: 'Investigate linking',
    hyperlink: true
  });
  assert.equal(
    line,
    '\u001b]8;;overlord://missions/coo:502\u001b\\coo:502 — Investigate linking\u001b]8;;\u001b\\'
  );
});

test('shouldUseTerminalHyperlinks honours escape hatches', () => {
  assert.equal(shouldUseTerminalHyperlinks({ env: {}, isTty: true }), true);
  assert.equal(shouldUseTerminalHyperlinks({ env: {}, isTty: false }), false);
  assert.equal(
    shouldUseTerminalHyperlinks({ env: { OVERLORD_NO_TERMINAL_LINKS: '1' }, isTty: true }),
    false
  );
  assert.equal(shouldUseTerminalHyperlinks({ env: { NO_COLOR: '1' }, isTty: true }), false);
  assert.equal(shouldUseTerminalHyperlinks({ env: { TERM: 'dumb' }, isTty: true }), false);
});

test('sanitizeTerminalText strips control characters', () => {
  assert.equal(sanitizeTerminalText('hi\u0007there\n'), 'hi there');
  assert.equal(
    missionTerminalTitle({ displayId: 'coo:1', title: 'A\u001b[31mB' }),
    'coo:1 — A [31mB'
  );
});

test('missionBannerShellCommands emits plain printf plus OSC title', () => {
  const commands = missionBannerShellCommands({
    displayId: 'coo:502',
    title: 'Investigate linking'
  });
  assert.ok(
    commands.includes(
      `printf '%s\\n' 'coo:502 · overlord://missions/coo:502 — Investigate linking'`
    )
  );
  assert.ok(commands.includes(`printf '%b' '\\033]0;coo:502 — Investigate linking\\007'`));
});

test('missionBannerShellCommands shell-quotes apostrophes in titles', () => {
  const commands = missionBannerShellCommands({
    displayId: 'coo:1',
    title: "it's fine"
  });
  // shellQuote turns it's into: it'\''s  (end quote, escaped quote, reopen)
  assert.ok(commands.includes(`it'\\''s fine`));
});
