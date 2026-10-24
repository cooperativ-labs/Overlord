import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import { composeDeliveryWithGemini, WRITING_RULES } from '../compose-delivery/compose.js';

import { type ComposeMissionSummaryInput, composeMissionSummaryWithGemini } from './compose.js';

const input: ComposeMissionSummaryInput = {
  mission: { title: 'Export CSV', statusType: 'review' },
  previousSummary: null,
  objectives: [],
  newestDelivery: null,
  openActions: [],
  openQuestions: [],
  pendingSuggestions: [],
  knownRisks: [],
  counts: { deliveries: 1, filePaths: 1 }
};

it('both composers use the writing rules and fixture examples without rewriting deferred work', async () => {
  for (const composer of ['compose-delivery', 'compose-mission-summary']) {
    const fixture = JSON.parse(
      readFileSync(
        new URL(`../${composer}/fixtures/operator-writing.json`, import.meta.url),
        'utf8'
      )
    );
    const before = JSON.stringify(fixture.deferredWork);
    const generate = async ({
      prompt,
      systemInstruction,
      responseSchema
    }: {
      prompt: string;
      systemInstruction: string;
      responseSchema: { properties?: object };
    }) => {
      assert.ok(systemInstruction.includes(WRITING_RULES));
      for (const rule of [
        'One topic per sentence',
        'active voice',
        'present tense',
        'imperative',
        'one term',
        'common words',
        'articles',
        'idioms',
        'copied exactly',
        'unclear'
      ]) {
        assert.match(systemInstruction.toLowerCase(), new RegExp(rule.toLowerCase()));
      }
      assert.equal('deferredWork' in (responseSchema.properties ?? {}), false);
      assert.ok(!prompt.includes(fixture.deferredWork.change));
      assert.match(prompt, /export capability/);
      return JSON.stringify(fixture.after);
    };
    const result =
      composer === 'compose-delivery'
        ? await composeDeliveryWithGemini({
            input: {
              summary: fixture.before,
              humanActions: [],
              tradeoffsMade: [],
              knownRisks: [],
              assumptions: [],
              candidateActions: []
            },
            generate
          })
        : await composeMissionSummaryWithGemini({
            input: {
              ...input,
              newestDelivery: { objectiveKey: 'test:1.abcd', markdown: fixture.before }
            },
            generate
          });
    assert.deepEqual(result, fixture.after);
    assert.equal(JSON.stringify(fixture.deferredWork), before);
  }
});

it('the summary automation rejects missing, malformed, scalar and array drafts', async () => {
  for (const draft of [null, '', '{', 'null', '1', '[]']) {
    assert.equal(
      await composeMissionSummaryWithGemini({ input, generate: async () => draft }),
      null
    );
  }
});
