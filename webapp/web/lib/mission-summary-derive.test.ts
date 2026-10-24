import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type {
  AgentRequestDto,
  FileChangeDto,
  MissionSummaryDto,
  MissionSummaryEvidenceDto,
  MissionSummaryResponse,
  StatusType
} from '../../shared/contract.ts';

import {
  laterWatermark,
  missionSummaryActions,
  missionSummaryFiles,
  missionSummaryRisks,
  missionSummaryRunningSentences,
  missionSummarySectionState,
  missionSummarySources,
  missionSummaryStatusChip,
  missionSummarySuggestions,
  normaliseSummaryText,
  openSummaryQuestions,
  SUMMARY_FILE_CHIP_LIMIT,
  type SummaryDeliveryStamp,
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
    agentRequests: AgentRequestDto[];
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
  assert.ok(suggestions.filter(row => row.state === 'open').every(row => row.isNew));
  assert.ok(suggestions.filter(row => row.state === 'resolved').every(row => !row.isNew));
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
      isNew: row.isNew
    })
  );
  assert.deepEqual(rows, expected.actions);
});

test('fixture: suggestions list open rows first and never dot a resolved row', () => {
  const rows = missionSummarySuggestions({ summary, objectives, baseline }).map(row => ({
    actionId: row.actionId,
    state: row.state,
    objectiveKey: row.objectiveKey,
    isNew: row.isNew
  }));
  assert.deepEqual(rows, expected.suggestions);
});

test('fixture: risks dot only deliveries newer than the baseline', () => {
  const rows = missionSummaryRisks({ summary, objectives, baseline }).map(row => ({
    deliveryId: row.deliveryId,
    objectiveKey: row.objectiveKey,
    isNew: row.isNew
  }));
  assert.deepEqual(rows, expected.risks);
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
  ] as AgentRequestDto[];
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
  ] as AgentRequestDto[];
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
