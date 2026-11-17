import type {
  FileChangeDto,
  HumanAgentRequestDto,
  MissionSummaryDto,
  MissionSummaryEvidenceDto,
  MissionSummaryResponse,
  StatusType
} from '@overlord/contract';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  laterWatermark,
  missionItemOutcomeLabel,
  missionItemResolver,
  missionItemResolverText,
  missionLiveStatus,
  missionSummaryActions,
  missionSummaryClosedItems,
  missionSummaryFiles,
  missionSummaryProvenance,
  missionSummaryRisks,
  missionSummaryRunningSentences,
  missionSummarySectionState,
  missionSummarySources,
  missionSummaryStatusChip,
  missionSummarySuggestions,
  normaliseSummaryText,
  openSummaryQuestions,
  SUMMARY_FILE_CHIP_LIMIT,
  summaryCoverageComplete,
  summaryCoverageRequirements,
  type SummaryDeliveryStamp,
  summaryGroupResolveNote,
  type SummaryMember,
  type SummaryObjective,
  summaryWatermarkIsDisplayed,
  updatingSourceObjective,
  watermarkNeedsAck
} from './mission-summary-derive.ts';

/** The fixture shared with the iOS derivation tests (plan §5.6, §6.3). */
const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contract/mission-summary-derive-fixtures.json', import.meta.url),
    'utf8'
  )
).reviewMission as {
  input: {
    mission: { id: string; statusType: StatusType; objectives: SummaryObjective[] };
    deliveries: SummaryDeliveryStamp[];
    summaryResponse: Extract<MissionSummaryResponse, { eligible: true }>;
    agentRequests: HumanAgentRequestDto[];
    members: SummaryMember[];
    fileChanges: { truncated: boolean; items: FileChangeDto[] };
  };
  expected: Record<string, any>;
};

const { input, expected } = fixture;
const summary = input.summaryResponse.summary as MissionSummaryDto;
const evidence = input.summaryResponse.evidence;
const objectives = input.mission.objectives;
const baseline = input.summaryResponse.seenAt;
const openQuestions = openSummaryQuestions(input.agentRequests, input.mission.id);

test('older current-run risks and suggestions keep new dots without delivery-feed timestamps', () => {
  const beforeAll = '2026-10-19T00:00:00.000Z';
  const risks = missionSummaryRisks({ summary, objectives, baseline: beforeAll });
  assert.equal(risks.find(row => row.deliveryId === 'delivery-a1')?.isNew, true);
  const suggestions = missionSummarySuggestions({ summary, objectives, baseline: beforeAll });
  assert.ok(suggestions.length > 0 && suggestions.every(row => row.isNew));
});

test('a newer question watermark is not acknowledged before the separate requests query displays it', () => {
  const watermark = '2099-01-01T00:00:00.000Z';
  assert.equal(summaryWatermarkIsDisplayed(watermark, evidence, []), false);
  assert.equal(summaryWatermarkIsDisplayed(watermark, evidence, [{ createdAt: watermark }]), true);
  assert.equal(summaryWatermarkIsDisplayed(null, evidence, []), false);
});

test('fixture: the visit baseline is the stored seenAt', () => {
  assert.equal(baseline, expected.visitBaseline);
});

test('fixture: status chip pairs a label with the tone', () => {
  assert.deepEqual(missionSummaryStatusChip(input.mission.statusType), expected.statusChip);
});

test('fixture: running sentences name executing and pending-delivery objectives', () => {
  assert.deepEqual(
    missionSummaryRunningSentences(objectives, openQuestions),
    expected.runningSentences
  );
});

test('fixture: sources are newest first with live and unassigned rows', () => {
  const sources = missionSummarySources(evidence, objectives).map(source => ({
    deliveryId: source.deliveryId,
    objectiveKey: source.objectiveKey,
    label: source.label,
    live: source.live
  }));
  assert.deepEqual(sources, expected.sources);
});

test('fixture: actions merge questions, dedupe by text and rank blocking first', () => {
  const rows = missionSummaryActions({ evidence, openQuestions, objectives, baseline }).map(
    row => ({
      key: row.key,
      kind: row.kind,
      title: row.title,
      blocking: row.blocking,
      objectiveKey: row.objectiveKey,
      isNew: row.isNew,
      itemId: row.itemId
    })
  );
  assert.deepEqual(rows, expected.actions);
});

test('fixture: suggestions are the open rows in server order, with item ids', () => {
  const rows = missionSummarySuggestions({ summary, objectives, baseline }).map(row => ({
    id: row.id,
    actionId: row.actionId,
    objectiveKey: row.objectiveKey,
    isNew: row.isNew
  }));
  assert.deepEqual(rows, expected.suggestions);
});

test('fixture: risks dot only deliveries newer than the baseline', () => {
  const rows = missionSummaryRisks({ summary, objectives, baseline }).map(row => ({
    itemId: row.itemId,
    deliveryId: row.deliveryId,
    objectiveKey: row.objectiveKey,
    isNew: row.isNew
  }));
  assert.deepEqual(rows, expected.risks);
});

test('fixture: the provenance line names the authoring objective', () => {
  assert.deepEqual(missionSummaryProvenance(summary, objectives), expected.provenance);
});

test('fixture: closed items name who closed them, the outcome and the reason', () => {
  const rows = missionSummaryClosedItems({ summary, objectives, members: input.members }).map(
    row => ({
      id: row.id,
      kindLabel: row.kindLabel,
      outcomeLabel: row.outcomeLabel,
      reason: row.reason,
      resolver: row.resolver,
      resolverText: row.resolver ? missionItemResolverText(row.resolver) : null,
      objectiveKey: row.objectiveKey
    })
  );
  assert.deepEqual(rows, expected.closedItems);
});

test('fallback and model summaries read as automatic; a deleted authoring objective stays an agent', () => {
  for (const kind of ['gemini', 'deterministic'] as const) {
    const automatic = { ...summary, author: { kind, objectiveId: null, deliveryId: null } };
    assert.deepEqual(missionSummaryProvenance(automatic, objectives), { kind: 'automatic' });
  }
  const orphan = {
    ...summary,
    author: { kind: 'agent' as const, objectiveId: 'obj-gone', deliveryId: 'delivery-gone' }
  };
  assert.deepEqual(missionSummaryProvenance(orphan, objectives), {
    kind: 'agent',
    objectiveKey: null
  });
});

test('a person no longer in the workspace and an empty reason read plainly', () => {
  const resolver = missionItemResolver(
    { kind: 'person', workspaceUserId: null, objectiveId: null, deliveryId: null },
    { objectives, members: input.members }
  );
  assert.deepEqual(resolver, { kind: 'person', name: 'a person' });
  assert.equal(missionItemResolver(null, { objectives, members: [] }), null);
  const [first] = missionSummaryClosedItems({
    summary: { ...summary, closedItems: [{ ...summary.closedItems[0]!, reason: '  ' }] },
    objectives,
    members: []
  });
  assert.equal(first!.reason, null);
  assert.equal(
    missionItemOutcomeLabel({ status: 'done', outcome: 'mission_created', outcomeRef: 'coo:7' }),
    'Mission coo:7 created'
  );
  assert.equal(
    missionItemOutcomeLabel({ status: 'dismissed', outcome: null, outcomeRef: null }),
    'Dismissed'
  );
});

test('fixture: files are distinct paths, newest first, with provenance badges', () => {
  const files = missionSummaryFiles(input.fileChanges.items, {
    truncated: input.fileChanges.truncated
  });
  assert.equal(files.total, expected.files.total);
  assert.equal(files.truncated, expected.files.truncated);
  assert.equal(files.resourceCount, expected.files.resourceCount);
  assert.equal(files.showResourceKey, expected.files.showResourceKey);
  assert.deepEqual(
    files.chips.slice(0, SUMMARY_FILE_CHIP_LIMIT).map(chip => ({
      resourceKey: chip.resourceKey,
      directory: chip.directory,
      basename: chip.basename,
      badge: chip.badge
    })),
    expected.files.collapsedChips
  );
  assert.equal(Math.max(0, files.total - SUMMARY_FILE_CHIP_LIMIT), expected.files.hiddenCount);
});

test('fixture: section state, trailer, updating source and watermark', () => {
  const state = missionSummarySectionState({
    response: input.summaryResponse,
    isError: false,
    runningSentences: missionSummaryRunningSentences(objectives, openQuestions)
  });
  assert.equal(state.kind, expected.sectionState);
  assert.equal(summary.generatedAt, expected.trailer.generatedAt);
  assert.equal(evidence.totals.currentRunDeliveries, expected.trailer.currentRunDeliveries);
  assert.equal(
    updatingSourceObjective({ summary, evidence, deliveries: input.deliveries, objectives })
      ?.displayId ?? null,
    expected.updatingSourceObjectiveKey
  );
  assert.equal(input.summaryResponse.watermark, expected.watermark);
  assert.equal(
    watermarkNeedsAck(input.summaryResponse.watermark, baseline),
    expected.watermarkNeedsAck
  );
});

// ---- Rules beyond the fixture ----

const emptyEvidence: MissionSummaryEvidenceDto = {
  actions: [],
  sources: [],
  totals: { actions: 0, sources: 0, currentRunDeliveries: 0 },
  truncated: { actions: false, sources: false }
};

function pendingSummary(overrides: Partial<MissionSummaryDto> = {}): MissionSummaryDto {
  return {
    ...summary,
    status: 'pending',
    headline: '',
    summary: '',
    risks: [],
    suggestions: [],
    generatedAt: null,
    model: null,
    ...overrides
  };
}

test('a null baseline gives no dots on the first visit', () => {
  const rows = missionSummaryActions({ evidence, openQuestions, objectives, baseline: null });
  assert.ok(rows.every(row => !row.isNew));
  assert.ok(missionSummaryRisks({ summary, objectives, baseline: null }).every(row => !row.isNew));
});

test('section states follow §5.4', () => {
  const running = ['Write the docs is running.'];
  assert.deepEqual(
    missionSummarySectionState({ response: undefined, isError: false, runningSentences: [] }),
    { kind: 'hidden' }
  );
  assert.deepEqual(
    missionSummarySectionState({ response: undefined, isError: true, runningSentences: [] }),
    { kind: 'error' }
  );
  assert.deepEqual(
    missionSummarySectionState({
      response: { eligible: false, summary: null, evidence: null, watermark: null, seenAt: null },
      isError: false,
      runningSentences: running
    }),
    { kind: 'hidden' }
  );
  assert.deepEqual(
    missionSummarySectionState({
      response: {
        eligible: true,
        summary: null,
        evidence: emptyEvidence,
        watermark: null,
        seenAt: null
      },
      isError: false,
      runningSentences: running
    }),
    { kind: 'awaiting', running }
  );
  assert.deepEqual(
    missionSummarySectionState({
      response: {
        eligible: true,
        summary: pendingSummary(),
        evidence: emptyEvidence,
        watermark: null,
        seenAt: null
      },
      isError: false,
      runningSentences: running
    }),
    { kind: 'first_pending', running }
  );
  const retained = pendingSummary({ headline: 'Old headline.', summary: 'Old text.' });
  assert.deepEqual(
    missionSummarySectionState({
      response: {
        eligible: true,
        summary: retained,
        evidence: emptyEvidence,
        watermark: null,
        seenAt: null
      },
      isError: false,
      runningSentences: []
    }),
    { kind: 'summary', summary: retained, updating: true }
  );
});

test('a choice request reads as a choice and a question without an objective stays generic', () => {
  const requests = [
    { ...input.agentRequests[0], id: 'c1', kind: 'choice', objectiveId: 'obj-d' },
    { ...input.agentRequests[0], id: 'q9', objectiveId: null, summary: '' }
  ] as HumanAgentRequestDto[];
  const rows = missionSummaryActions({
    evidence: emptyEvidence,
    openQuestions: openSummaryQuestions(requests, input.mission.id),
    objectives,
    baseline: null
  });
  assert.deepEqual(
    rows.map(row => [row.kind, row.title, row.detail]),
    [
      [
        'choice',
        'Choose an option for Write the docs',
        '“Should the formatter live in OverlordCore or the app target?”'
      ],
      ['question', "Answer the agent's question", null]
    ]
  );
});

test('requests of another mission, other kinds and closed states are not questions', () => {
  const requests = [
    { ...input.agentRequests[0], id: 'a', missionId: 'mission-2' },
    { ...input.agentRequests[0], id: 'b', kind: 'retry' },
    { ...input.agentRequests[0], id: 'c', status: 'expired' },
    { ...input.agentRequests[0], id: 'd' }
  ] as HumanAgentRequestDto[];
  assert.deepEqual(
    openSummaryQuestions(requests, input.mission.id).map(request => request.id),
    ['d']
  );
});

test('dedupe keeps the newest action even when the older duplicate is blocking', () => {
  const rows = missionSummaryActions({
    evidence: {
      ...emptyEvidence,
      actions: [
        {
          ...evidence.actions[0],
          deliveryId: 'old',
          blocking: true,
          deliveredAt: '2026-10-01T00:00:00.000Z',
          action: 'Run it.'
        },
        {
          ...evidence.actions[0],
          deliveryId: 'new',
          blocking: false,
          deliveredAt: '2026-10-02T00:00:00.000Z',
          action: 'run it'
        }
      ]
    },
    openQuestions: [],
    objectives,
    baseline: null
  });
  assert.deepEqual(
    rows.map(row => row.deliveryId),
    ['new']
  );
});

test('normalisation ignores case, spacing and trailing punctuation', () => {
  assert.equal(normaliseSummaryText('  Add  the KEY.  '), 'add the key');
});

test('watermarks only move forward', () => {
  assert.equal(laterWatermark(null, '2026-10-01T00:00:00.000Z'), '2026-10-01T00:00:00.000Z');
  assert.equal(
    laterWatermark('2026-10-02T00:00:00.000Z', '2026-10-01T00:00:00.000Z'),
    '2026-10-02T00:00:00.000Z'
  );
  assert.equal(watermarkNeedsAck('2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z'), false);
  assert.equal(watermarkNeedsAck(null, null), false);
});

test('a truncated file page is reported, and one resource hides the resource key', () => {
  const files = missionSummaryFiles(
    input.fileChanges.items.filter(change => change.resourceKey === 'web'),
    { truncated: true }
  );
  assert.equal(files.truncated, true);
  assert.equal(files.showResourceKey, false);
});

test('coverage requires every nonempty evidence group with its current content', () => {
  const action = { key: 'request:q1', introducedAt: '2026-10-01T00:00:00.000Z' };
  const required = summaryCoverageRequirements({
    actionRows: [action],
    riskRows: [{ key: 'risk:1' }],
    suggestionRows: []
  });
  assert.deepEqual(Object.keys(required).sort(), ['for_you', 'risks']);
  assert.equal(summaryCoverageComplete(required, {}), false);
  assert.equal(summaryCoverageComplete(required, { for_you: required.for_you! }), false);
  const all = { for_you: required.for_you!, risks: required.risks! };
  assert.equal(summaryCoverageComplete(required, all), true);
  const changed = summaryCoverageRequirements({
    actionRows: [action, { key: 'request:q2', introducedAt: '2026-10-02T00:00:00.000Z' }],
    riskRows: [{ key: 'risk:1' }],
    suggestionRows: []
  });
  assert.equal(summaryCoverageComplete(changed, all), false, 'new evidence invalidates coverage');
  assert.equal(
    summaryCoverageComplete(
      summaryCoverageRequirements({ actionRows: [], riskRows: [], suggestionRows: [] }),
      {}
    ),
    true
  );
});

// ---- Live status and grouped items (coo:1294.jp1p) ----

const stateOf = (...states: SummaryObjective['state'][]) => states.map(state => ({ state }));

test('live status: a blocking action blocks, then a question waits, then a running objective progresses', () => {
  const base = { statusType: 'execute' as StatusType, objectives: stateOf('executing') };
  const blocking = [{ kind: 'action' as const, blocking: true }];
  const optional = [{ kind: 'action' as const, blocking: false }];
  const question = [{ kind: 'question' as const, blocking: false }];

  const blocked = missionLiveStatus({ ...base, openQuestions: [{}], actionRows: blocking });
  assert.deepEqual([blocked.kind, blocked.label], ['blocked', 'Blocked']);
  assert.equal(blocked.detail, '1 blocking action needs you.');

  const waiting = missionLiveStatus({ ...base, openQuestions: [{}, {}], actionRows: question });
  assert.deepEqual([waiting.kind, waiting.detail], ['waiting', '2 open questions need an answer.']);

  const running = missionLiveStatus({ ...base, openQuestions: [], actionRows: optional });
  assert.deepEqual([running.kind, running.detail], ['in_progress', '1 objective is running.']);
  assert.equal(
    missionLiveStatus({
      ...base,
      objectives: stateOf('executing', 'pending_delivery'),
      openQuestions: [],
      actionRows: []
    }).detail,
    '2 objectives are running.'
  );
});

test('live status: closing the last blocker, answering the last question, and finishing each change it', () => {
  const objectives = stateOf('complete', 'executing');
  const at = (openQuestions: unknown[], actionRows: Array<{ kind: 'action'; blocking: boolean }>) =>
    missionLiveStatus({ statusType: 'execute', objectives, openQuestions, actionRows }).kind;
  assert.equal(at([{}], [{ kind: 'action', blocking: true }]), 'blocked');
  assert.equal(at([{}], []), 'waiting');
  assert.equal(at([], []), 'in_progress');

  const done = stateOf('complete', 'complete');
  assert.equal(
    missionLiveStatus({
      statusType: 'complete',
      objectives: done,
      openQuestions: [],
      actionRows: []
    }).kind,
    'complete'
  );
  assert.equal(
    missionLiveStatus({
      statusType: 'execute',
      objectives: stateOf('launching'),
      openQuestions: [],
      actionRows: []
    }).kind,
    'launching'
  );
  assert.equal(
    missionLiveStatus({
      statusType: 'next',
      objectives: stateOf('draft'),
      openQuestions: [],
      actionRows: []
    }).kind,
    'idle'
  );
});

test('live status ignores the agent-written prose entirely', () => {
  // The inputs hold no summary field: a status cannot be stale because prose is.
  const keys = Object.keys(
    missionLiveStatus({ statusType: 'execute', objectives: [], openQuestions: [], actionRows: [] })
  );
  assert.deepEqual(keys.sort(), [
    'blockingActions',
    'detail',
    'kind',
    'label',
    'openQuestions',
    'running'
  ]);
});

test('fixture: duplicate actions group under the newest record, blocking if any is, one id per record', () => {
  const rows = missionSummaryActions({ evidence, openQuestions, objectives, baseline });
  const flag = rows.find(row => /overlord_flag/i.test(row.title))!;
  assert.equal(flag.group.count, 2);
  assert.deepEqual(flag.group.itemIds, ['item-action-c4-1', 'item-action-x3-0']);
  assert.deepEqual(
    flag.group.sources.map(source => source.objectiveKey),
    ['coo:900.cccc', null],
    'a deleted objective has no key'
  );
  assert.match(summaryGroupResolveNote(flag.group) ?? '', /closes all 2 matching records/);
  const single = rows.find(row => /migration/i.test(row.title))!;
  assert.equal(single.group.count, 1);
  assert.equal(summaryGroupResolveNote(single.group), null);

  // An older blocking duplicate keeps the group blocking even when the newest is not.
  const ev = structuredClone(evidence);
  const older = ev.actions.find(action => action.id === 'item-action-x3-0')!;
  older.blocking = true;
  const grouped = missionSummaryActions({ evidence: ev, openQuestions: [], objectives, baseline });
  assert.equal(grouped.find(row => /overlord_flag/i.test(row.title))!.blocking, true);
});

test('risks and suggestions carry the records they stand for from the server grouping', () => {
  const grouped = structuredClone(summary);
  grouped.risks[0]!.duplicates = [
    {
      id: 'dup-1',
      deliveryId: 'd1',
      objectiveId: 'obj-a',
      deliveredAt: '2026-10-20T00:00:00.000Z'
    },
    { id: 'dup-2', deliveryId: 'd2', objectiveId: 'obj-a', deliveredAt: '2026-10-19T00:00:00.000Z' }
  ];
  const [risk] = missionSummaryRisks({ summary: grouped, objectives, baseline });
  assert.equal(risk!.group.count, 3);
  assert.deepEqual(risk!.group.itemIds, [risk!.itemId, 'dup-1', 'dup-2']);
  assert.equal(risk!.group.sources.length, 2, 'two reports from one objective are one source');

  const plain = missionSummarySuggestions({ summary, objectives, baseline });
  assert.ok(plain.every(row => row.group.count === 1 && row.group.itemIds[0] === row.id));
});
