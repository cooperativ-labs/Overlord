import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import { WRITING_RULES as DELIVERY_WRITING_RULES } from '../compose-delivery/compose.js';
import { MISSION_SUMMARY_SYSTEM_INSTRUCTION } from '../compose-mission-summary/compose.js';

import { lintSte, OBJECTIVE_WRITING_RULES, WRITING_RULES } from './ste.js';

const codes = (text: string) => lintSte(text).map(violation => violation.code);

describe('shared writing rules', () => {
  it('keeps the base profile byte-identical for delivery and mission-summary composers', () => {
    // Moving the rules must not change delivery or mission-summary behavior.
    assert.equal(
      createHash('sha256').update(WRITING_RULES).digest('hex'),
      '1d5afd88437fadd2d69eb12291e9c4dd468024bd06d3ee6c9c44f210207272fc'
    );
    assert.equal(DELIVERY_WRITING_RULES, WRITING_RULES);
    assert.ok(MISSION_SUMMARY_SYSTEM_INSTRUCTION.endsWith(WRITING_RULES));
    assert.doesNotMatch(MISSION_SUMMARY_SYSTEM_INSTRUCTION, /Decision needed/);
  });

  it('extends the base profile for objectives', () => {
    assert.ok(OBJECTIVE_WRITING_RULES.startsWith(WRITING_RULES));
    assert.match(OBJECTIVE_WRITING_RULES, /CAUTION:/);
    assert.match(OBJECTIVE_WRITING_RULES, /It is possible that X/);
  });
});

describe('lintSte', () => {
  it('accepts plain STE prose and the approved confidence forms', () => {
    assert.deepEqual(codes('Add the column. The test passed.'), []);
    assert.deepEqual(
      codes('The failure is probably a timeout, because it occurs only on slow runs.'),
      []
    );
    assert.deepEqual(
      codes('It is possible that iOS also reads this field. A search of the app will confirm it.'),
      []
    );
  });

  it('flags ambiguous modals with a replacement, but not inside quotes or code', () => {
    const [violation] = lintSte('The worker might retry the job.');
    assert.equal(violation?.code, 'ambiguous_modal');
    assert.match(violation?.suggestion ?? '', /It is possible that/);
    assert.deepEqual(codes('Rename `--may-run` and the text "you should run this".'), []);
  });

  it('flags contractions, semicolons, long sentences, stacked and unsupported hedges', () => {
    assert.ok(codes("Don't edit the file.").includes('contraction'));
    assert.ok(codes('Edit the file; run the tests.').includes('semicolon'));
    assert.ok(codes(`Edit ${'the file and '.repeat(10)}stop.`).includes('sentence_too_long'));
    assert.ok(codes('The bug is probably possibly fixed.').includes('stacked_hedge'));
    assert.ok(codes('The bug is probably fixed. Ship it.').includes('unsupported_hedge'));
  });

  it('keeps the possessive and does not split file names', () => {
    assert.deepEqual(codes("The agent's text stays in objective-brief.ts. It is short."), []);
  });
});
