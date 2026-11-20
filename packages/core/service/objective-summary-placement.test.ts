import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { objectiveSummaryPlacementWarnings } from './objective-brief.js';
import {
  assessObjectiveSummaryPlacement,
  OBJECTIVE_FIELDS_SWAPPED_CODE,
  summaryInstructionStructure
} from './objective-summary-placement.js';

/** The inputs an agent sent when it created coo:1320 with the two texts swapped. */
const coo1320 = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/coo-1320-create-submission.json', import.meta.url)),
    'utf8'
  )
) as { objective: string; objectiveDescription: string };

const LONG_INSTRUCTIONS = [
  '## Context',
  'The run queue retries a failed launch three times, then gives up silently.',
  'People only notice when a mission stays in Execute for hours with nothing running.',
  '',
  '## Steps',
  '1. Record each retry with its error code in the objective events.',
  '2. After the last retry, block the queue entry with reason launch_failed.',
  '3. Show the reason on the board card.',
  '',
  '## Done when',
  'A launch that fails three times blocks its queue entry and the board shows why.'
].join('\n');

const GOOD_SUMMARY =
  'This objective makes repeated launch failures visible. The run queue records every retry ' +
  'and blocks the entry after the last one, so people see why the work stopped. Done when a ' +
  'launch that fails three times shows its reason on the board.';

describe('objective instructions/summary swap guard (coo:1321)', () => {
  it('flags the coo:1320 submission as a likely swap, names both fields, and never throws', () => {
    const placement = assessObjectiveSummaryPlacement({
      instructions: coo1320.objective,
      summary: coo1320.objectiveDescription
    });
    assert.equal(placement.verdict, 'warn');
    assert.ok(placement.verdict === 'warn');
    assert.equal(placement.severity, 'likely');
    assert.match(placement.message, /instructions and summary look swapped/);
    assert.match(placement.message, /15\.3 times longer/);
    assert.match(placement.message, /--objective-instructions/);
    assert.match(placement.message, /--objective-summary/);
    assert.match(placement.message, /executing agent receives/);
    assert.match(placement.message, /1703 characters; the instructions are 111/);
    assert.match(placement.message, /Both texts were stored as written/);

    const warnings = objectiveSummaryPlacementWarnings({
      instructions: coo1320.objective,
      summary: coo1320.objectiveDescription
    });
    assert.deepEqual(
      warnings.map(warning => warning.code),
      [OBJECTIVE_FIELDS_SWAPPED_CODE]
    );
  });

  it('accepts the coo:1320 texts the right way round', () => {
    assert.deepEqual(
      assessObjectiveSummaryPlacement({
        instructions: coo1320.objectiveDescription,
        summary: coo1320.objective
      }),
      { verdict: 'ok' }
    );
  });

  it('leaves a normal create alone', () => {
    assert.deepEqual(
      assessObjectiveSummaryPlacement({ instructions: LONG_INSTRUCTIONS, summary: GOOD_SUMMARY }),
      { verdict: 'ok' }
    );
    assert.deepEqual(
      objectiveSummaryPlacementWarnings({ instructions: LONG_INSTRUCTIONS, summary: GOOD_SUMMARY }),
      []
    );
  });

  it('allows a summary somewhat longer than terse instructions', () => {
    // 1.22x was the largest legitimate ratio in production data.
    const instructions = 'x'.repeat(371);
    assert.equal(
      assessObjectiveSummaryPlacement({ instructions, summary: 'y'.repeat(452) }).verdict,
      'ok'
    );
    // A short summary never warns, whatever the ratio.
    assert.equal(
      assessObjectiveSummaryPlacement({ instructions: 'Fix it', summary: 'z'.repeat(200) }).verdict,
      'ok'
    );
  });

  it('warns when the summary is clearly longer but below the reject ratio', () => {
    const warnings = objectiveSummaryPlacementWarnings({
      instructions: 'x'.repeat(200),
      summary: 'y'.repeat(500)
    });
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]!.code, OBJECTIVE_FIELDS_SWAPPED_CODE);
    assert.match(warnings[0]!.message, /may be swapped: the summary is 2\.5 times longer/);
    assert.equal(
      (
        assessObjectiveSummaryPlacement({
          instructions: 'x'.repeat(200),
          summary: 'y'.repeat(500)
        }) as {
          severity: string;
        }
      ).severity,
      'possible'
    );
    assert.match(warnings[0]!.message, /Both texts were stored as written/);
  });

  it('warns when a summary holds instruction structure over short instructions', () => {
    const summary = 'Do this:\n1. First step.\n2. Second step.';
    const warnings = objectiveSummaryPlacementWarnings({
      instructions: 'Fix the parser so it accepts trailing commas in arrays and objects.',
      summary
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!.message, /contains numbered steps/);
    // With long instructions, structure alone is not a reason to warn.
    assert.deepEqual(
      objectiveSummaryPlacementWarnings({ instructions: LONG_INSTRUCTIONS, summary }),
      []
    );
  });

  it('calls a swap likely past the clear ratio only when the summary is long enough', () => {
    const severity = (summaryChars: number) => {
      const placement = assessObjectiveSummaryPlacement({
        instructions: 'x'.repeat(100),
        summary: 'y'.repeat(summaryChars)
      });
      return placement.verdict === 'warn' ? placement.severity : placement.verdict;
    };
    assert.equal(severity(399), 'possible');
    assert.equal(severity(400), 'likely');
  });

  it('detects instruction structure', () => {
    assert.deepEqual(summaryInstructionStructure(GOOD_SUMMARY), []);
    assert.deepEqual(summaryInstructionStructure(coo1320.objectiveDescription), [
      'Markdown headings',
      'numbered steps'
    ]);
    assert.deepEqual(summaryInstructionStructure('**Done when:** the build passes.'), [
      'a "Done when:" label'
    ]);
    // A done-when sentence is how a summary should end.
    assert.deepEqual(summaryInstructionStructure('Done when the build passes.'), []);
    assert.deepEqual(summaryInstructionStructure('Step 1. is not a list item.'), []);
  });
});
