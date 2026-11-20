import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  instructionLengthLabel,
  mentionBadgeLabel,
  objectiveSummaryView,
  summaryCodeSegments,
  summaryFailureMessage,
  summaryMarkerSegments,
  summaryMentions,
  summaryParagraphs,
  summaryProvenanceLabel,
  summaryWordCount
} from './objective-brief.ts';

const SUMMARY =
  'Add a summary to each objective. Decision needed: include the inbox now or later.\n\nCAUTION: Do not change the launch payload. The work is done when people can read both texts.';

describe('summaryMentions', () => {
  it('counts sentence-initial markers only', () => {
    assert.deepEqual(summaryMentions(SUMMARY), { decisions: 1, cautions: 1 });
    assert.deepEqual(summaryMentions('Use caution: it is mid-sentence. Plain text.'), {
      decisions: 0,
      cautions: 0
    });
    assert.deepEqual(
      summaryMentions('Decision needed: A or B. Decision needed: C or D. Done when merged.'),
      { decisions: 2, cautions: 0 }
    );
    assert.deepEqual(summaryMentions(null), { decisions: 0, cautions: 0 });
  });
});

describe('summaryParagraphs and markers', () => {
  it('splits on blank lines and drops empty paragraphs', () => {
    assert.deepEqual(summaryParagraphs('One.\n\n  \n\nTwo.\n \nThree.'), [
      'One.',
      'Two.',
      'Three.'
    ]);
    assert.deepEqual(summaryParagraphs(''), []);
  });

  it('marks only sentence-initial prefixes, keeping all text', () => {
    const segments = summaryMarkerSegments(
      'Goal first. Decision needed: pick one. Use caution: not a marker.'
    );
    assert.equal(
      segments.map(s => s.text).join(''),
      'Goal first. Decision needed: pick one. Use caution: not a marker.'
    );
    assert.deepEqual(
      segments.filter(s => s.marker).map(s => [s.marker, s.text]),
      [['decision', 'Decision needed:']]
    );
    assert.deepEqual(summaryMarkerSegments('CAUTION: first.')[0], {
      text: 'CAUTION:',
      marker: 'caution'
    });
  });

  it('treats markup in stored prose as text', () => {
    const segments = summaryMarkerSegments('<img src=x onerror=alert(1)> stays text.');
    assert.equal(segments.length, 1);
    assert.equal(segments[0]!.marker, null);
  });
});

const LONG = 'x'.repeat(400);

describe('objectiveSummaryView', () => {
  it('treats an older server DTO with no brief fields as "no summary"', () => {
    const view = objectiveSummaryView({ instructionText: LONG });
    assert.equal(view.summary, null);
    assert.equal(view.canSummarize, false);
    assert.equal(view.canRemove, false);
    assert.equal(view.pending, false);
  });

  it('offers Summarize only for eligible text with nothing outstanding', () => {
    assert.equal(
      objectiveSummaryView({ instructionText: LONG, summaryEligible: true }).canSummarize,
      true
    );
    assert.equal(
      objectiveSummaryView({ instructionText: 'short', summaryEligible: false }).canSummarize,
      false
    );
    const pending = objectiveSummaryView({
      instructionText: LONG,
      summaryEligible: true,
      summaryStatus: 'pending'
    });
    assert.equal(pending.canSummarize, false);
    assert.equal(pending.canRemove, true, 'a pending first summary can be stopped');
  });

  it('keeps a removed summary absent and offers Summarize to re-enable it', () => {
    const view = objectiveSummaryView({
      instructionText: LONG,
      summary: null,
      summaryEligible: true,
      summarySuppressed: true
    });
    assert.equal(view.summary, null);
    assert.equal(view.suppressed, true);
    assert.equal(view.canSummarize, true);
    assert.equal(view.canRegenerate, false);
  });

  it('keeps the prior summary while regeneration is pending or failed', () => {
    const pending = objectiveSummaryView({
      instructionText: LONG,
      summary: SUMMARY,
      summaryEligible: true,
      summaryStatus: 'pending',
      summaryStale: true
    });
    assert.equal(pending.summary, SUMMARY);
    assert.equal(pending.canRegenerate, false);
    assert.equal(pending.stale, true);
    const failed = objectiveSummaryView({
      instructionText: LONG,
      summary: SUMMARY,
      summaryEligible: true,
      summaryStatus: 'failed',
      summaryFailureCode: 'provider_unavailable'
    });
    assert.equal(failed.canRetry, true);
    assert.equal(failed.canRegenerate, true);
    assert.equal(failed.failureCode, 'provider_unavailable');
  });

  it('never reports a stale flag without a summary', () => {
    assert.equal(objectiveSummaryView({ instructionText: LONG, summaryStale: true }).stale, false);
  });
});

describe('summaryProvenanceLabel', () => {
  const members = [
    { workspaceUserId: 'wu-me', displayName: 'Me', handle: null, email: null, isOperator: true },
    { workspaceUserId: 'wu-ana', displayName: 'Ana', handle: 'ana', email: null, isOperator: false }
  ];
  const base = { instructionText: LONG, summary: SUMMARY };

  it('labels generated and agent text', () => {
    assert.equal(summaryProvenanceLabel({ ...base, summarySource: 'generated' }, []), 'AI summary');
    assert.equal(
      summaryProvenanceLabel(
        { ...base, summarySource: 'agent', summaryAuthorAgent: 'claude-code' },
        []
      ),
      'Written by Claude Code'
    );
    assert.equal(
      summaryProvenanceLabel({ ...base, summarySource: 'agent', summaryAuthorAgent: null }, []),
      'Written by agent'
    );
  });

  it('says "Edited by you" only to the editor', () => {
    const mine = {
      ...base,
      summarySource: 'user' as const,
      summaryAuthorWorkspaceUserId: 'wu-me'
    };
    const anas = {
      ...base,
      summarySource: 'user' as const,
      summaryAuthorWorkspaceUserId: 'wu-ana'
    };
    assert.equal(summaryProvenanceLabel(mine, members), 'Edited by you');
    assert.equal(summaryProvenanceLabel(anas, members), 'Edited by Ana');
    assert.equal(summaryProvenanceLabel(anas, undefined), 'Edited by a person');
    assert.equal(
      summaryProvenanceLabel({ ...mine, summaryAuthorWorkspaceUserId: null }, members),
      'Edited by a person'
    );
  });

  it('has no provenance without a summary', () => {
    assert.equal(
      summaryProvenanceLabel({ instructionText: LONG, summarySource: 'generated' }, []),
      null
    );
  });
});

describe('labels', () => {
  it('formats counts and failures without provider text', () => {
    assert.equal(instructionLengthLabel(' abc '), '3 characters');
    assert.equal(instructionLengthLabel('x'.repeat(1240)), '1,240 characters');
    assert.equal(mentionBadgeLabel('decision', 1), '1 decision');
    assert.equal(mentionBadgeLabel('caution', 2), '2 cautions');
    assert.equal(summaryWordCount('  one two\nthree '), 3);
    assert.match(summaryFailureMessage('provider_unavailable'), /no model provider/);
    assert.equal(summaryFailureMessage(null), 'Summary unavailable.');
  });
});

describe('summaryCodeSegments', () => {
  it('renders backtick spans as code without the backticks', () => {
    assert.deepEqual(summaryCodeSegments('Edit `backend/app.ts` now.'), [
      { text: 'Edit ', code: false },
      { text: 'backend/app.ts', code: true },
      { text: ' now.', code: false }
    ]);
  });
  it('keeps an unmatched backtick literal', () => {
    assert.deepEqual(summaryCodeSegments('a ` b'), [{ text: 'a ` b', code: false }]);
  });
});
