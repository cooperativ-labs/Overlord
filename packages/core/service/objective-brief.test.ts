import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ServiceError } from './errors.js';
import {
  EMPTY_OBJECTIVE_BRIEF_STATE,
  hashObjectiveInstruction,
  isObjectiveDescriptionStale,
  normalizeObjectiveDescriptionInput,
  OBJECTIVE_DESCRIPTION_MAX_CHARS,
  OBJECTIVE_DESCRIPTION_MIN_INSTRUCTION_CHARS,
  type ObjectiveBriefActor,
  type ObjectiveBriefRow,
  type ObjectiveBriefState,
  planObjectiveBriefForCreate,
  planObjectiveBriefForUpdate,
  planObjectiveBriefPublication,
  planObjectiveDescriptionGenerationRequest
} from './objective-brief.js';

const NOW = '2026-11-14T12:00:00.000Z';
const LONG = `Implement the objective brief state. ${'Keep every constraint. '.repeat(20)}`.trim();
const LONG_2 = `Rewrite the objective brief state. ${'Keep every warning. '.repeat(20)}`.trim();
const SHORT = 'Fix the typo in the README.';

const human: ObjectiveBriefActor = { kind: 'human', workspaceUserId: 'wu-human', agent: null };
const agent: ObjectiveBriefActor = {
  kind: 'agent',
  workspaceUserId: 'wu-human',
  agent: 'claude-code'
};
const automation: ObjectiveBriefActor = { kind: 'automation', workspaceUserId: null, agent: null };

function state(overrides: Partial<ObjectiveBriefState> = {}): ObjectiveBriefState {
  return { ...EMPTY_OBJECTIVE_BRIEF_STATE, ...overrides };
}

function applied(
  base: ObjectiveBriefState,
  patch: Partial<ObjectiveBriefState>
): ObjectiveBriefState {
  return { ...base, ...patch };
}

function row(overrides: Partial<ObjectiveBriefRow> = {}): ObjectiveBriefRow {
  return {
    ...EMPTY_OBJECTIVE_BRIEF_STATE,
    id: 'o1',
    workspace_id: 'w1',
    project_id: 'p1',
    mission_id: 'm1',
    instruction_text: LONG,
    title: 'Title',
    revision: 3,
    deleted_at: null,
    ...overrides
  };
}

describe('description input normalization', () => {
  it('distinguishes omitted, removal and authored values', () => {
    assert.deepEqual(normalizeObjectiveDescriptionInput(undefined), { kind: 'omit' });
    assert.deepEqual(normalizeObjectiveDescriptionInput(null), { kind: 'remove' });
    assert.deepEqual(normalizeObjectiveDescriptionInput('   \n '), { kind: 'remove' });
    assert.deepEqual(normalizeObjectiveDescriptionInput(' Goal.\r\n\r\nDone when. '), {
      kind: 'set',
      text: 'Goal.\n\nDone when.'
    });
  });

  it('rejects non-strings and over-long text with stable codes', () => {
    assert.throws(
      () => normalizeObjectiveDescriptionInput(42),
      (e: unknown) => e instanceof ServiceError && e.code === 'validation_error'
    );
    assert.throws(
      () => normalizeObjectiveDescriptionInput('x'.repeat(OBJECTIVE_DESCRIPTION_MAX_CHARS + 1)),
      (e: unknown) => e instanceof ServiceError && e.code === 'description_too_long'
    );
    // 120 words is a target, not a cap: a long but bounded text is accepted.
    const words = Array.from({ length: 300 }, () => 'word').join(' ');
    assert.equal(normalizeObjectiveDescriptionInput(words).kind, 'set');
  });
});

describe('create', () => {
  it('requests an automatic summary only for long agent/assistant instructions', () => {
    const agentLong = planObjectiveBriefForCreate({
      instructionText: LONG,
      titleProvided: false,
      description: { kind: 'omit' },
      actor: agent,
      now: NOW
    });
    assert.equal(agentLong.descriptionRequested, true);
    assert.equal(agentLong.patch.description_status, 'pending');
    assert.equal(agentLong.patch.description_request_kind, 'automatic');
    assert.equal(agentLong.patch.instruction_author_kind, 'agent');
    assert.equal(agentLong.patch.title_source, 'generated');
    assert.equal(agentLong.titleRequested, true);

    for (const actor of [human, automation]) {
      const plan = planObjectiveBriefForCreate({
        instructionText: LONG,
        titleProvided: false,
        description: { kind: 'omit' },
        actor,
        now: NOW
      });
      assert.equal(plan.descriptionRequested, false, actor.kind);
      assert.equal(plan.patch.description_status, null);
      assert.equal(plan.patch.instruction_author_kind, actor.kind);
    }

    const agentShort = planObjectiveBriefForCreate({
      instructionText: SHORT,
      titleProvided: false,
      description: { kind: 'omit' },
      actor: agent,
      now: NOW
    });
    assert.equal(agentShort.descriptionRequested, false);

    const blank = planObjectiveBriefForCreate({
      instructionText: '   ',
      titleProvided: false,
      description: { kind: 'omit' },
      actor: agent,
      now: NOW
    });
    assert.equal(blank.descriptionRequested, false);
    assert.equal(blank.titleRequested, false);
    assert.equal(blank.patch.instruction_author_kind, null);
  });

  it('records authored titles and descriptions with their owner', () => {
    const plan = planObjectiveBriefForCreate({
      instructionText: LONG,
      titleProvided: true,
      description: { kind: 'set', text: 'Agent summary.' },
      actor: agent,
      now: NOW
    });
    assert.equal(plan.patch.title_source, 'agent');
    assert.equal(plan.titleRequested, false);
    assert.equal(plan.patch.description, 'Agent summary.');
    assert.equal(plan.patch.description_source, 'agent');
    assert.equal(plan.patch.description_author_agent, 'claude-code');
    assert.equal(plan.patch.description_instruction_hash, hashObjectiveInstruction(LONG));
    assert.equal(plan.descriptionRequested, false);

    const humanTitle = planObjectiveBriefForCreate({
      instructionText: LONG,
      titleProvided: true,
      description: { kind: 'remove' },
      actor: human,
      now: NOW
    });
    assert.equal(humanTitle.patch.title_source, 'user');
    assert.equal(humanTitle.patch.description_suppressed, true);
    assert.equal(humanTitle.patch.description, null);
  });
});

describe('instruction edits', () => {
  const update = (
    s: ObjectiveBriefState,
    actor: ObjectiveBriefActor,
    instructionText: string | undefined,
    extra: {
      title?: string | null;
      description?: ReturnType<typeof normalizeObjectiveDescriptionInput>;
    } = {}
  ) =>
    planObjectiveBriefForUpdate({
      state: s,
      currentInstruction: LONG,
      instructionText,
      title: extra.title,
      description: extra.description ?? { kind: 'omit' },
      actor,
      now: NOW
    });

  it('tracks current authorship in both directions', () => {
    const agentWritten = state({
      instruction_author_kind: 'agent',
      description_status: 'pending',
      description_request_kind: 'automatic'
    });
    const byHuman = update(agentWritten, human, LONG_2);
    assert.equal(byHuman.patch.instruction_author_kind, 'human');
    assert.equal(byHuman.descriptionRequested, false);
    assert.equal(byHuman.patch.description_status, null, 'automatic request is withdrawn');

    const humanWritten = state({ instruction_author_kind: 'human' });
    const byAgent = update(humanWritten, agent, LONG_2);
    assert.equal(byAgent.patch.instruction_author_kind, 'agent');
    assert.equal(byAgent.descriptionRequested, true);
    assert.equal(byAgent.patch.description_request_kind, 'automatic');
  });

  it('regenerates generated and agent summaries whoever edits, and clears them when ineligible', () => {
    for (const source of ['generated', 'agent'] as const) {
      const s = state({
        description: 'Old.',
        description_source: source,
        description_generation: 4,
        description_revision: 2
      });
      const longEdit = update(s, human, LONG_2);
      assert.equal(longEdit.descriptionRequested, true, source);
      assert.equal(longEdit.patch.description_generation, 5);
      assert.equal(longEdit.patch.description, undefined, 'old text stays visible until replaced');

      const shortEdit = update(s, agent, SHORT);
      assert.equal(shortEdit.descriptionRequested, false);
      assert.equal(shortEdit.patch.description, null);
      assert.equal(shortEdit.patch.description_revision, 3);

      const blankEdit = update(s, agent, '');
      assert.equal(blankEdit.patch.description, null);
      assert.equal(blankEdit.patch.instruction_author_kind, null);
    }
  });

  it('keeps a person-written summary and marks it stale', () => {
    const s = state({
      description: 'Mine.',
      description_source: 'user',
      description_instruction_hash: hashObjectiveInstruction(LONG)
    });
    const plan = update(s, agent, LONG_2);
    assert.equal(plan.descriptionRequested, false);
    assert.equal(plan.patch.description, undefined);
    assert.equal(isObjectiveDescriptionStale(s, LONG), false);
    assert.equal(isObjectiveDescriptionStale(s, LONG_2), true);
  });

  it('keeps an outstanding explicit request through a human edit', () => {
    const s = state({
      description_status: 'pending',
      description_request_kind: 'explicit',
      description_generation: 7
    });
    const plan = update(s, human, LONG_2);
    assert.equal(plan.descriptionRequested, true);
    assert.equal(plan.patch.description_generation, 8);
    assert.equal(plan.patch.description_request_kind, 'explicit');
  });

  it('never generates while removal suppression is on, including across agent edits', () => {
    const s = state({
      description_suppressed: true,
      instruction_author_kind: 'agent',
      description_generation: 2
    });
    const plan = update(s, agent, LONG_2);
    assert.equal(plan.descriptionRequested, false);
    assert.equal(plan.patch.description_status, null);
    assert.equal(plan.patch.description_suppressed, undefined, 'edits never clear suppression');
    assert.equal(plan.patch.description_generation, 3, 'in-flight results are invalidated');
  });

  it('leaves the brief alone when instructions are unchanged', () => {
    const s = state({ instruction_author_kind: 'agent', title_source: 'generated' });
    const plan = update(s, human, LONG);
    assert.deepEqual(plan.patch, {});
    assert.equal(plan.titleRequested, false);
  });

  it('protects authored and unknown titles and invalidates in-flight titles', () => {
    const generated = update(
      state({ title_source: 'generated', title_generation: 1 }),
      human,
      LONG_2
    );
    assert.equal(generated.titleRequested, true);
    assert.equal(generated.patch.title_generation, 2);

    for (const source of ['agent', 'user', null] as const) {
      const plan = update(state({ title_source: source, title_generation: 1 }), agent, LONG_2);
      assert.equal(plan.titleRequested, false, String(source));
      assert.equal(plan.patch.title_generation, 2);
    }

    const titled = update(state({ title_source: 'generated' }), agent, LONG_2, {
      title: 'Agent title'
    });
    assert.equal(titled.patch.title_source, 'agent');
    assert.equal(titled.titleRequested, false);

    const cleared = update(state({ title_source: 'user' }), human, undefined, { title: '' });
    assert.equal(cleared.patch.title_source, 'generated');
  });

  it('keeps a model title pending for long text and writes a local title for short text', () => {
    const long = update(state({ title_source: 'generated', title_status: null }), agent, LONG_2);
    assert.equal(long.titleRequested, true);
    assert.equal(long.patch.title_status, 'pending');
    assert.equal(long.titleDerived, null);

    const short = update(
      state({ title_source: 'generated', title_status: 'pending' }),
      human,
      SHORT
    );
    assert.equal(short.titleRequested, false);
    assert.equal(short.patch.title_status, null, 'a superseded model title is cancelled');
    assert.equal(short.titleDerived, SHORT);

    const blank = update(state({ title_source: 'generated', title_status: 'pending' }), human, '');
    assert.equal(blank.titleRequested, false);
    assert.equal(blank.titleDerived, null);
    assert.equal(blank.patch.title_status, null);

    // Clearing an authored title hands it back to automation immediately.
    const cleared = update(state({ title_source: 'user' }), human, undefined, { title: '' });
    assert.equal(cleared.titleRequested, true, 'LONG instructions ask for a model title');
    assert.equal(cleared.patch.title_status, 'pending');

    const created = planObjectiveBriefForCreate({
      instructionText: SHORT,
      titleProvided: false,
      description: { kind: 'omit' },
      actor: agent,
      now: NOW
    });
    assert.equal(created.titleRequested, false, 'the create-time local title is final');
    assert.equal(created.patch.title_status, undefined);
  });

  it('applies an authored description written together with new instructions', () => {
    const plan = update(
      state({ description_source: 'generated', description: 'Old.' }),
      agent,
      LONG_2,
      {
        description: { kind: 'set', text: 'New agent summary.' }
      }
    );
    assert.equal(plan.patch.description, 'New agent summary.');
    assert.equal(plan.patch.description_source, 'agent');
    assert.equal(plan.patch.description_instruction_hash, hashObjectiveInstruction(LONG_2));
    assert.equal(plan.descriptionRequested, false);
  });

  it('refuses agent-authored text while suppressed with a warning, not an error', () => {
    const s = state({ description_suppressed: true });
    const plan = update(s, agent, undefined, { description: { kind: 'set', text: 'Sneaky.' } });
    assert.equal(plan.patch.description, undefined);
    assert.deepEqual(
      plan.warnings.map(w => w.code),
      ['description_suppressed']
    );

    const person = update(s, human, undefined, { description: { kind: 'set', text: 'Mine.' } });
    assert.equal(person.patch.description, 'Mine.');
    assert.equal(person.patch.description_source, 'user');
    assert.equal(person.patch.description_author_workspace_user_id, 'wu-human');
    assert.equal(
      person.patch.description_suppressed,
      undefined,
      'only Summarize clears suppression'
    );
  });
});

describe('explicit requests', () => {
  const request = (
    s: ObjectiveBriefState,
    mode: 'summarize' | 'regenerate' | 'retry',
    actor = human,
    text: string | null = LONG
  ) => planObjectiveDescriptionGenerationRequest({ state: s, instructionText: text, mode, actor });

  it('only a person clears suppression via Summarize or Regenerate', () => {
    const suppressed = state({ description_suppressed: true, description_generation: 3 });
    const plan = request(suppressed, 'summarize');
    assert.equal(plan.patch.description_suppressed, false);
    assert.equal(plan.patch.description_status, 'pending');
    assert.equal(plan.patch.description_request_kind, 'explicit');
    assert.equal(plan.patch.description_generation, 4);

    assert.throws(
      () => request(suppressed, 'summarize', agent),
      (e: unknown) =>
        e instanceof ServiceError && e.code === 'description_suppressed' && e.status === 409
    );
    assert.throws(
      () => request(suppressed, 'regenerate', agent),
      (e: unknown) => e instanceof ServiceError && e.code === 'description_suppressed'
    );
  });

  it('deduplicates repeated requests without moving the generation', () => {
    const pending = state({
      description_status: 'pending',
      description_request_kind: 'automatic',
      description_generation: 5
    });
    const again = request(pending, 'regenerate');
    assert.equal(again.descriptionRequested, true);
    assert.deepEqual(again.patch, { description_request_kind: 'explicit' });
    const thrice = request(applied(pending, again.patch), 'regenerate');
    assert.deepEqual(thrice.patch, {});
  });

  it('retries only failed generations and never clears suppression', () => {
    const failed = state({
      description_status: 'failed',
      description_failure_code: 'provider_error',
      description_generation: 2
    });
    const plan = request(failed, 'retry', agent);
    assert.equal(plan.patch.description_status, 'pending');
    assert.equal(plan.patch.description_generation, 3);
    assert.equal(plan.patch.description_failure_code, null);
    assert.equal(plan.patch.description_suppressed, undefined);
    assert.throws(
      () => request(state(), 'retry'),
      (e: unknown) => e instanceof ServiceError && e.code === 'description_not_failed'
    );
  });

  it('refuses requests for short or blank instructions', () => {
    for (const text of [SHORT, '', null]) {
      assert.throws(
        () => request(state(), 'summarize', human, text),
        (e: unknown) => e instanceof ServiceError && e.code === 'description_not_eligible'
      );
    }
    assert.ok(LONG.length >= OBJECTIVE_DESCRIPTION_MIN_INSTRUCTION_CHARS);
  });
});

describe('publication', () => {
  const hash = hashObjectiveInstruction(LONG)!;

  it('publishes only against the exact generation and instruction', () => {
    const r = row({
      description_status: 'pending',
      description_generation: 4,
      title_source: 'generated',
      title_generation: 2
    });
    const ok = planObjectiveBriefPublication({
      row: r,
      result: {
        instructionHash: hash,
        title: { generation: 2, text: 'Add brief state' },
        description: { generation: 4, text: 'Goal. Done when.' }
      },
      now: NOW
    });
    assert.equal(ok.title, 'published');
    assert.equal(ok.description, 'published');
    assert.equal(ok.patch.description_source, 'generated');
    assert.equal(ok.patch.description_status, null);
    assert.equal(ok.patch.description_revision, r.description_revision + 1);

    const staleGeneration = planObjectiveBriefPublication({
      row: r,
      result: { instructionHash: hash, description: { generation: 3, text: 'Old.' } },
      now: NOW
    });
    assert.equal(staleGeneration.description, 'stale');
    assert.deepEqual(staleGeneration.patch, {});

    const staleInstruction = planObjectiveBriefPublication({
      row: r,
      result: {
        instructionHash: hashObjectiveInstruction(LONG_2)!,
        description: { generation: 4, text: 'Old.' }
      },
      now: NOW
    });
    assert.equal(staleInstruction.description, 'stale');
  });

  it('never restores a removed summary or overwrites authored titles', () => {
    const removed = row({
      description_suppressed: true,
      description_status: null,
      description_generation: 9
    });
    const late = planObjectiveBriefPublication({
      row: removed,
      result: { instructionHash: hash, description: { generation: 9, text: 'Late.' } },
      now: NOW
    });
    assert.equal(late.description, 'suppressed');
    assert.deepEqual(late.patch, {});

    for (const source of ['agent', 'user', null] as const) {
      const titled = planObjectiveBriefPublication({
        row: row({ title_source: source, title_generation: 0 }),
        result: { instructionHash: hash, title: { generation: 0, text: 'Generated' } },
        now: NOW
      });
      assert.equal(titled.title, 'stale', String(source));
    }

    const deleted = planObjectiveBriefPublication({
      row: row({ deleted_at: NOW, description_status: 'pending' }),
      result: { instructionHash: hash, description: { generation: 0, text: 'Text.' } },
      now: NOW
    });
    assert.equal(deleted.description, 'stale');
  });

  it('rejects an empty generated description as invalid output', () => {
    const r = row({ description_status: 'pending', description_generation: 1 });
    const out = planObjectiveBriefPublication({
      row: r,
      result: { instructionHash: hash, description: { generation: 1, text: '   ' } },
      now: NOW
    });
    assert.equal(out.description, 'invalid');
    assert.deepEqual(out.patch, {});
  });
});
