import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { missionSearchCoverageFloor, parseMissionSearchQuery } from './mission-search-query.js';

describe('parseMissionSearchQuery', () => {
  it('treats blank and punctuation-only input as explicit fallback', () => {
    assert.equal(parseMissionSearchQuery('').mode, 'fallback');
    assert.equal(parseMissionSearchQuery('   ').mode, 'fallback');
    assert.equal(parseMissionSearchQuery('???').mode, 'fallback');
    assert.equal(parseMissionSearchQuery('the and of').mode, 'fallback');
  });

  it('short-circuits display-id-shaped queries including objective ids', () => {
    const mission = parseMissionSearchQuery('coo:781');
    assert.equal(mission.mode, 'display_id');
    assert.equal(mission.displayId, 'coo:781');

    const objective = parseMissionSearchQuery('coo:784.k8xe');
    assert.equal(objective.mode, 'display_id');
    assert.equal(objective.displayId, 'coo:784');
  });

  it('drops stop words and keeps a portable coverage floor', () => {
    const parsed = parseMissionSearchQuery(
      'that thing where we were going to stop the webhooks from firing too fast'
    );
    assert.equal(parsed.mode, 'any');
    assert.ok(parsed.terms.includes('webhooks'));
    assert.ok(parsed.terms.includes('stop'));
    assert.ok(!parsed.terms.includes('the'));
    assert.ok(!parsed.terms.includes('we'));
    assert.equal(parsed.coverageFloor, missionSearchCoverageFloor(parsed.terms.length));
    assert.ok((parsed.coverageFloor ?? 0) >= 2);
  });
});

describe('missionSearchCoverageFloor', () => {
  it('is min(3, max(1, ceil(termCount / 2)))', () => {
    assert.equal(missionSearchCoverageFloor(0), 0);
    assert.equal(missionSearchCoverageFloor(1), 1);
    assert.equal(missionSearchCoverageFloor(2), 1);
    assert.equal(missionSearchCoverageFloor(3), 2);
    assert.equal(missionSearchCoverageFloor(4), 2);
    assert.equal(missionSearchCoverageFloor(5), 3);
    assert.equal(missionSearchCoverageFloor(12), 3);
  });
});
