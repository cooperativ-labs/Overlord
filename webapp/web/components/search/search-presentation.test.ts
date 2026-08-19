import type { SearchResultV3 } from '@overlord/contract';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  flattenSearchRows,
  highlightParts,
  SearchCompletenessNotice,
  searchDestination,
  SearchResultRowContent
} from './search-presentation.tsx';

const mission: SearchResultV3 = {
  id: 'mission-1',
  displayId: 'coo:789',
  title: 'Grouped search rollout',
  statusType: 'execute',
  statusId: 'status-1',
  priority: 'normal',
  projectId: 'project-1',
  projectName: 'Overlord',
  workspaceId: 'workspace-1',
  workspaceName: 'Cooperativ',
  workspaceSlug: 'coo',
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
  dueDatetime: null,
  objectiveCount: 2,
  relevance: 1,
  snippet: 'Search now names matching objectives.',
  matchedTerms: ['search'],
  matchedIn: ['objective'],
  anchorOnly: true,
  matchCounts: { objective: 2, delivery: 1, event: 0 },
  matches: [
    {
      entityType: 'objective',
      id: 'objective-1',
      displayId: 'coo:789.5a0d',
      title: 'Build grouped search results',
      objectiveId: 'objective-1',
      objectiveState: 'executing',
      relevance: 1,
      snippet: 'Build grouped results with keyboard support.',
      matchedTerms: ['grouped'],
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z'
    },
    {
      entityType: 'delivery',
      id: 'delivery-1',
      displayId: null,
      title: 'Search delivery summary',
      objectiveId: 'objective-1',
      objectiveState: null,
      relevance: 0.9,
      snippet: 'Delivery has a follow-up.',
      matchedTerms: ['delivery'],
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z'
    }
  ]
};

test('compact result rows keep a mission anchor and exactly one direct child', () => {
  const rows = flattenSearchRows([mission], { childLimit: 1 });
  assert.deepEqual(
    rows.map(row => row.kind),
    ['mission', 'match']
  );
  assert.equal(rows[1]?.kind === 'match' && rows[1].match.displayId, 'coo:789.5a0d');
});

test('expanded result rows preserve the keyboard traversal order', () => {
  const rows = flattenSearchRows([mission], {
    childLimit: 1,
    expandedMissionIds: new Set([mission.id])
  });
  assert.deepEqual(
    rows.map(row => row.key),
    ['mission:mission-1', 'match:objective-1', 'match:delivery-1']
  );
});

test('objective and delivery rows preserve the established objective deep link', () => {
  const objective = searchDestination(mission, mission.matches[0]);
  const delivery = searchDestination(mission, mission.matches[1]);
  assert.deepEqual(objective, {
    to: '/projects/$projectId/missions/$missionId',
    params: { projectId: 'project-1', missionId: 'mission-1' },
    search: { objective: 'coo:789.5a0d' }
  });
  assert.deepEqual(delivery.search, { objective: 'objective-1' });
});

test('highlights matching text without treating query punctuation as a regex', () => {
  assert.deepEqual(highlightParts('Find foo.bar and Foo.Bar', ['foo.bar']), [
    { text: 'Find ', hit: false },
    { text: 'foo.bar', hit: true },
    { text: ' and ', hit: false },
    { text: 'Foo.Bar', hit: true }
  ]);
});

test('component markup identifies child kind, state, and highlighted evidence', () => {
  const row = flattenSearchRows([mission], { childLimit: 1 })[1]!;
  const html = renderToStaticMarkup(createElement(SearchResultRowContent, { row }));
  assert.match(html, /Objective/);
  assert.match(html, /executing/);
  assert.match(html, /<mark/);
});

test('completeness notice makes candidate truncation visible', () => {
  const html = renderToStaticMarkup(
    createElement(SearchCompletenessNotice, {
      returned: 1,
      totalMatchedBeforeLimit: 12,
      truncatedCandidates: true
    })
  );
  assert.match(html, /Results are incomplete/);
  assert.match(html, /role="status"/);
});
