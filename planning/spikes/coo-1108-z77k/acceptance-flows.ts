/* eslint-disable no-console -- acceptance harness */
// coo:1108.z77k live acceptance run, part two: questions, targets, relaunch, notifications,
// proposals and Create, restart recovery, revocation, prompt injection and limits.
// NOT production code. See acceptance.ts for the stack this runs against.

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  A,
  api,
  B,
  counts,
  evidenceOf,
  extra,
  newThread,
  NOTE_MARKER,
  P,
  rec,
  say,
  state,
  T,
  toolCalls
} from './acceptance.ts';
import {
  db,
  kbControl,
  lastAssistant,
  rows,
  sleep,
  streamUntil,
  textOf,
  waitSettled,
  WORK
} from './lib.ts';

/** Runs the scratch stack control script. Output is discarded so a daemonized child cannot hold a pipe open. */
const stack = (command: string, env: Record<string, string> = {}) => {
  execSync(`${path.join(WORK, 'stack.sh')} ${command}`, {
    env: { ...process.env, ...env },
    stdio: 'ignore',
    timeout: 90_000
  });
};

const terminal = (frame: any) =>
  frame.event?.kind === 'run.updated' &&
  ['completed', 'failed', 'cancelled'].includes(frame.event.run.state);
const settledFrame = (frame: any) =>
  frame.event?.kind === 'run.updated' &&
  ['completed', 'failed', 'cancelled', 'waiting_user'].includes(frame.event.run.state);

const notifications = (threadId: string) =>
  rows<{
    id: string;
    type: string;
    transition_key: string;
    state: string;
    event_seq: number;
    thread_title: string | null;
    last_error: string | null;
  }>(
    'SELECT id, type, transition_key, state, event_seq, thread_title, last_error FROM chat_notifications WHERE thread_id = $1 ORDER BY created_at, transition_key',
    [threadId]
  );
async function waitNotification(
  threadId: string,
  key: string,
  states: string[],
  timeoutMs = 20_000
) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const row = (await notifications(threadId)).find(n => n.transition_key === key);
    if (row && states.includes(row.state)) return row;
    if (Date.now() > until) return row ?? null;
    await sleep(300);
  }
}
const presence = (
  token: string,
  threadId: string,
  clientId: string,
  value: 'foreground' | 'released',
  platform = 'ios'
) =>
  api(token, 'PUT', `/api/chat/threads/${threadId}/presence`, { clientId, platform, state: value });
const ack = (token: string, threadId: string, clientId: string, seq: number) =>
  api(token, 'POST', `/api/chat/threads/${threadId}/ack`, { clientId, seq });

/** Answers open questions with the first option (or the given text) until the run settles. */
async function answerThrough(
  threadId: string,
  pick: (question: any) => { optionId?: string; text: string },
  max = 4
) {
  const asked: any[] = [];
  for (let i = 0; i < max; i++) {
    const snap = await waitSettled(A, threadId);
    if (!snap.openQuestion) return { snap, asked };
    asked.push(snap.openQuestion);
    const choice = pick(snap.openQuestion);
    const answered = await api(A, 'POST', `/api/chat/questions/${snap.openQuestion.id}/answer`, {
      clientRequestId: randomUUID(),
      expectedRevision: snap.openQuestion.revision,
      ...choice
    });
    if (answered.status !== 200)
      throw new Error(`answer ${answered.status} ${JSON.stringify(answered.body)}`);
  }
  return { snap: await waitSettled(A, threadId), asked };
}
const firstOption = (q: any) =>
  q.options?.length
    ? { optionId: q.options[0].id, text: q.options[0].label }
    : { text: 'Use your best judgement.' };

/** Registers a primary resource (no target binding) for projects that have no checkout here. */
async function ensureRefineryResource() {
  for (const [project, workspace, label] of [
    ['refinery', 'labs', 'Refinery'],
    ['scribe', 'engineering', 'Scribe (macOS app)'],
    ['scribeServer', 'engineering', 'Scribe Server (Node API)']
  ] as const) {
    const existing = await rows(
      'SELECT id FROM project_resources WHERE project_id = $1 AND deleted_at IS NULL',
      [P[project]]
    );
    if (existing.length) continue;
    const now = new Date().toISOString();
    await rows(
      `INSERT INTO project_resources (id, workspace_id, project_id, resource_key, label, is_primary, status, metadata_json, created_at, updated_at, revision) VALUES ($1, $2, $3, 'primary', $4, true, 'active', '{}', $5, $5, 1)`,
      [randomUUID(), state.workspaces![workspace], P[project], label, now]
    );
  }
}

const DRAFT_PROMPT =
  'Prepare draft missions now, without asking me anything else: (1) in the Overlord project, primary resource, one objective to add a GET /api/health/deep endpoint that checks the database connection; (2) in the Refinery project, primary resource, one objective to write a README that explains the product. Use agent codex with model gpt-5.5 and medium reasoning for both.';

async function proposalThread(prompt = DRAFT_PROMPT) {
  await ensureRefineryResource();
  const t = await newThread(A, prompt);
  const { snap } = await answerThrough(t.thread.id, firstOption);
  return { t, snap, proposal: snap.openProposals?.[0] ?? null };
}
const create = (
  token: string,
  proposalId: string,
  revision: number,
  clientRequestId = randomUUID()
) =>
  api(token, 'POST', `/api/chat/proposals/${proposalId}/create`, {
    clientRequestId,
    expectedRevision: revision
  });
const missionIds = (body: any): string[] =>
  (body?.receipt?.missions ?? []).map((m: any) => m.missionId).sort();

export function register(scenarios: Record<string, () => Promise<void>>) {
  Object.assign(scenarios, {
    /** Row 3 (similar project names) and row 10 (a message while a question is open). */
    async names() {
      await ensureRefineryResource();
      const before = await counts();
      const t = await newThread(
        A,
        'I want rate limiting added to Scribe so one client cannot flood it. Draft a mission for that.'
      );
      const busy = await say(A, t.thread.id, 'Also add logging.');
      rec.record(
        'q.busy-conflict',
        'A message while the assistant is working is a conflict',
        busy.status === 409 && busy.body.code === 'run_in_progress',
        { status: busy.status, code: busy.body?.code }
      );
      const snap = await waitSettled(A, t.thread.id);
      const question = snap.openQuestion;
      const proposal = snap.openProposals?.[0];
      const namesBoth = (text: string) =>
        /scribe server/i.test(text) && /scribe(?! server)/i.test(text);
      const asked =
        Boolean(question) &&
        namesBoth(`${question.prompt} ${question.options.map((o: any) => o.label).join(' ')}`);
      extra.similarNames = {
        asked: Boolean(question),
        question: question && {
          prompt: question.prompt,
          options: question.options.map((o: any) => o.label)
        },
        proposedProjects: proposal?.current.missions.map((m: any) => m.projectName) ?? null,
        answer: textOf(lastAssistant(snap)).slice(0, 800)
      };
      rec.record(
        'q.similar-names',
        'Two similarly named projects produce a clarifying question naming both, or a justified single owner',
        asked || (Boolean(proposal) && proposal.current.missions.length === 1),
        extra.similarNames as Record<string, unknown>
      );
      if (!question) return;
      // The answer arrives as a plain message, not through the card.
      const runBefore = snap.activeRun.id;
      const answered = await say(
        A,
        t.thread.id,
        'Scribe Server — the Node API, not the macOS app.'
      );
      const runs = await rows<{ id: string }>('SELECT id FROM chat_runs WHERE thread_id = $1', [
        t.thread.id
      ]);
      rec.record(
        'q.message-answers',
        'A typed message while a question is open answers it and resumes the same run',
        answered.status === 200 &&
          answered.body.run.id === runBefore &&
          runs.length === 1 &&
          answered.body.message.answersQuestionId === question.id,
        {
          status: answered.status,
          sameRun: answered.body?.run?.id === runBefore,
          runs: runs.length
        }
      );
      const stale = await api(A, 'POST', `/api/chat/questions/${question.id}/answer`, {
        clientRequestId: randomUUID(),
        expectedRevision: question.revision,
        text: 'Scribe'
      });
      rec.record(
        'q.stale-card',
        'The card for an already answered question is rejected as stale',
        stale.status === 409 && stale.body.code === 'stale_revision',
        { status: stale.status, code: stale.body?.code }
      );
      const done = await answerThrough(t.thread.id, firstOption);
      const final = done.snap.openProposals?.[0];
      rec.record(
        'q.routed-after-answer',
        'After the answer the proposal names the chosen project by id',
        Boolean(final) && final.current.missions.every((m: any) => m.projectId === P.scribeServer),
        {
          projects: final?.current.missions.map((m: any) => m.projectName),
          followUpQuestions: done.asked.map(q => q.prompt)
        }
      );
      const after = await counts();
      rec.record(
        'q.no-work-before-create',
        'Preparing a proposal creates no missions or objectives',
        JSON.stringify(before) === JSON.stringify(after),
        { before, after }
      );
    },

    /** Row 4: two targets holding the same resource in different states. */
    async targets() {
      const t = await newThread(
        A,
        'The Sandbox Service is checked out on two machines. For each machine, tell me the branch, the HEAD commit and whether there are uncommitted changes, and say how they differ.'
      );
      const snap = await waitSettled(A, t.thread.id);
      const answer = textOf(lastAssistant(snap));
      const calls = await toolCalls(t.run.id);
      const reads = calls.filter(c => c.tool_id === 'repository_read');
      const targetsRead = new Set(reads.map(c => c.arguments_json?.executionTargetId));
      const evidence = evidenceOf(lastAssistant(snap)).filter(e => e.source.kind === 'repository');
      extra.twoTargets = {
        answer,
        usage: snap.latestRun?.usage,
        evidence: evidence.map(e => e.label)
      };
      rec.record(
        't.both-read',
        'Both execution targets were read',
        targetsRead.has(T.t1) && targetsRead.has(T.t2),
        { reads: reads.length }
      );
      rec.record(
        't.attributed',
        'The answer attributes branch and HEAD to each machine by name',
        /jake mac/i.test(answer) &&
          /build box/i.test(answer) &&
          /release/.test(answer) &&
          /main/.test(answer) &&
          /8377c67/.test(answer) &&
          /a9a0ac1/.test(answer),
        {
          mentions: {
            jakeMac: /jake mac/i.test(answer),
            buildBox: /build box/i.test(answer),
            heads: [/8377c67/.test(answer), /a9a0ac1/.test(answer)]
          }
        }
      );
      rec.record(
        't.evidence-per-target',
        'Evidence entries carry each target id',
        [T.t1, T.t2].every(id => evidence.some(e => e.source.executionTargetId === id)),
        {}
      );
      // Failure table: an offline target is reported, never guessed.
      await rows(
        `UPDATE execution_target_runner_registrations SET last_heartbeat_at = $1 WHERE execution_target_id = $2`,
        [new Date(Date.now() - 3_600_000).toISOString(), T.t2]
      ).catch(() => []);
      stack('runner-stop 2');
      await rows(
        `UPDATE execution_target_runner_registrations SET last_heartbeat_at = $1 WHERE execution_target_id = $2`,
        [new Date(Date.now() - 3_600_000).toISOString(), T.t2]
      );
      const off = await newThread(
        A,
        'What branch is the Sandbox Service on, on the Build Box machine and on Jake Mac?'
      );
      const offSnap = await waitSettled(A, off.thread.id);
      const offAnswer = textOf(lastAssistant(offSnap));
      const offCalls = await toolCalls(off.run.id);
      extra.offlineTarget = {
        answer: offAnswer,
        calls: offCalls.map(c => ({ tool: c.tool_id, outcome: c.outcome }))
      };
      rec.record(
        't.offline-stated',
        'With one runner stopped, the answer says that target is unreachable and still reports the other',
        /offline|unreachable|not reachable|unavailable|could not|couldn't|cannot/i.test(
          offAnswer
        ) && /main/.test(offAnswer),
        { answer: offAnswer.slice(0, 500) }
      );
      stack('runner-start 2');
      await sleep(3000);
    },

    /** Row 5: background and relaunch — same run, ordered transcript, no duplicate message. */
    async relaunch() {
      const text =
        'Read the git status of the Overlord primary resource and of the mobile resource, then tell me which has more modified files.';
      const thread = await api(A, 'POST', '/api/chat/threads', {});
      const threadId = thread.body.thread.id;
      const clientRequestId = randomUUID();
      const first = await api(A, 'POST', `/api/chat/threads/${threadId}/messages`, {
        clientRequestId,
        text
      });
      // Foreground: read a few frames, then the app is backgrounded (connection dropped).
      const head = await streamUntil(
        A,
        threadId,
        0,
        (_f, frames) => frames.filter(f => f.type === 'event').length >= 3,
        30_000
      );
      const seen = head.filter(f => f.type === 'event').map(f => f.event.seq);
      const cursor = seen.at(-1) ?? 0;
      // A retry of the same submission while the first response was lost.
      const retry = await api(A, 'POST', `/api/chat/threads/${threadId}/messages`, {
        clientRequestId,
        text
      });
      // Relaunch: snapshot, then resume the stream from the snapshot cursor.
      await sleep(4000);
      const snapshot = await api(A, 'GET', `/api/chat/threads/${threadId}`);
      const tail = await streamUntil(A, threadId, snapshot.body.eventCursor, terminal, 240_000);
      const tailSeqs = tail.filter(f => f.type === 'event').map(f => f.event.seq);
      const final = await waitSettled(A, threadId);
      // A client that kept its own older cursor replays exactly the missed range.
      const replay = await api(
        A,
        'GET',
        `/api/chat/threads/${threadId}/events?after=${cursor}&poll=1`
      );
      const replaySeqs = replay.body.events.map((e: any) => e.seq);
      const userMessages = final.messages.filter(
        (m: any) => m.role === 'user' && textOf(m) === text
      );
      const runs = await rows('SELECT id FROM chat_runs WHERE thread_id = $1', [threadId]);
      rec.record(
        'l.idempotent-submit',
        'Repeating the submission returns the original message and run',
        retry.status === 200 &&
          retry.body.replayed === true &&
          retry.body.run.id === first.body.run.id &&
          retry.body.message.id === first.body.message.id,
        { replayed: retry.body?.replayed }
      );
      rec.record(
        'l.one-message-one-run',
        'The transcript holds one user message and one run',
        userMessages.length === 1 && runs.length === 1,
        { userMessages: userMessages.length, runs: runs.length }
      );
      rec.record(
        'l.resume-from-snapshot',
        'The stream resumed from the snapshot cursor continues at the next sequence without a gap',
        tailSeqs.length > 0 &&
          tailSeqs[0] === snapshot.body.eventCursor + 1 &&
          tailSeqs.every((s, i) => i === 0 || s === tailSeqs[i - 1]! + 1),
        { snapshotCursor: snapshot.body.eventCursor, first: tailSeqs[0], last: tailSeqs.at(-1) }
      );
      rec.record(
        'l.replay-after-cursor',
        'Polling after an older cursor returns the missed events in order',
        replaySeqs[0] === cursor + 1 &&
          replaySeqs.every((s: number, i: number) => i === 0 || s === replaySeqs[i - 1] + 1),
        { cursor, first: replaySeqs[0], count: replaySeqs.length, hasMore: replay.body.hasMore }
      );
      rec.record(
        'l.completed-while-away',
        'The run finished while no client was connected',
        final.latestRun?.state === 'completed',
        {
          run: final.latestRun?.state,
          messages: final.messages.map((m: any) => `${m.role}:${m.state}`)
        }
      );
      const beyond = await api(
        A,
        'GET',
        `/api/chat/threads/${threadId}/events?after=${final.eventCursor + 50}&poll=1`
      );
      rec.record(
        'l.future-cursor',
        'A cursor beyond the last event is rejected rather than silently accepted',
        beyond.status === 400,
        { status: beyond.status }
      );
      const renamed = await api(A, 'PATCH', `/api/chat/threads/${threadId}`, {
        expectedRevision: final.thread.revision,
        title: 'Modified files comparison'
      });
      const staleRename = await api(A, 'PATCH', `/api/chat/threads/${threadId}`, {
        expectedRevision: final.thread.revision,
        title: 'x'
      });
      const archived = await api(A, 'PATCH', `/api/chat/threads/${threadId}`, {
        expectedRevision: renamed.body.revision,
        archived: true
      });
      const listed = await api(A, 'GET', '/api/chat/threads');
      const listedArchived = await api(A, 'GET', '/api/chat/threads?archived=1');
      rec.record(
        'l.rename-archive',
        'Rename and archive are revision-checked; archived threads leave the default list',
        renamed.status === 200 &&
          staleRename.status === 409 &&
          archived.status === 200 &&
          !listed.body.items.some((x: any) => x.id === threadId) &&
          listedArchived.body.items.some((x: any) => x.id === threadId),
        { stale: staleRename.body?.code }
      );
    },

    /** Rows 6–9: mission-less notifications, acknowledgement suppression, stale sockets, repeated questions. */
    async notify() {
      const missionNotifications = async () =>
        Number((await rows<{ n: string }>('SELECT COUNT(*) AS n FROM notifications'))[0]!.n);
      const beforeMission = await missionNotifications();
      const quick = 'Reply with the single word "done". Do not use tools.';

      // n1: nobody is watching.
      const n1 = await newThread(A, quick);
      await waitSettled(A, n1.thread.id);
      const row1 = await waitNotification(n1.thread.id, 'terminal:completed', [
        'dispatched',
        'failed',
        'cancelled',
        'suppressed'
      ]);
      const history = await api(A, 'GET', '/api/chat/notifications');
      const item = history.body.items?.find((x: any) => x.threadId === n1.thread.id);
      const raw = await rows<Record<string, unknown>>(
        'SELECT * FROM chat_notifications WHERE thread_id = $1',
        [n1.thread.id]
      );
      rec.record(
        'n.dispatched-unattended',
        'With no foreground client the finished transition dispatches after the grace period',
        row1?.state === 'dispatched',
        { row: row1 }
      );
      rec.record(
        'n.history',
        'History lists it by owner, organization, thread and run, with no mission',
        Boolean(item) &&
          item.type === 'chat_finished' &&
          item.runId === n1.run.id &&
          item.organizationId === state.organizationId &&
          !('missionId' in item) &&
          history.body.unreadCount >= 1,
        { item, unreadCount: history.body.unreadCount }
      );
      rec.record(
        'n.no-content',
        'The stored notification holds a title and ids only',
        !JSON.stringify(raw).toLowerCase().includes('"done"') &&
          String(row1?.thread_title).length <= 80,
        { title: row1?.thread_title, columns: Object.keys(raw[0] ?? {}).length }
      );
      const read = await api(A, 'POST', `/api/chat/notifications/${item?.id}/read`, {
        expectedRevision: item?.revision
      });
      const staleRead = await api(A, 'POST', `/api/chat/notifications/${item?.id}/read`, {
        expectedRevision: item?.revision
      });
      const afterRead = await api(A, 'GET', '/api/chat/notifications');
      rec.record(
        'n.read',
        'Marking read is revision-checked and lowers the unread count',
        read.status === 200 &&
          staleRead.status === 409 &&
          afterRead.body.unreadCount === history.body.unreadCount - 1,
        {
          stale: staleRead.body?.code,
          unread: [history.body.unreadCount, afterRead.body.unreadCount]
        }
      );

      // n2: a foreground client renders and acknowledges.
      const n2 = await api(A, 'POST', '/api/chat/threads', {});
      const id2 = n2.body.thread.id;
      const phone = randomUUID();
      await presence(A, id2, phone, 'foreground');
      await say(A, id2, quick);
      const frames2 = await streamUntil(A, id2, 0, terminal, 120_000);
      const last2 = frames2.filter(f => f.type === 'event').at(-1)!.event.seq;
      const acked = await ack(A, id2, phone, last2);
      const row2 = await waitNotification(id2, 'terminal:completed', ['suppressed', 'dispatched']);
      await sleep(7000);
      const row2Later = (await notifications(id2)).find(
        n => n.transition_key === 'terminal:completed'
      );
      rec.record(
        'n.ack-suppresses',
        'A foreground acknowledgement of the rendered event suppresses the candidate for good',
        acked.status === 200 &&
          acked.body.suppressedNotificationIds.length === 1 &&
          row2?.state === 'suppressed' &&
          row2Later?.state === 'suppressed',
        { ack: acked.body, state: row2Later?.state }
      );
      const lower = await ack(A, id2, phone, 1);
      const beyond = await ack(A, id2, phone, last2 + 100);
      rec.record(
        'n.ack-monotonic',
        'A lower acknowledgement keeps the stored value; one beyond the last event is rejected',
        lower.status === 200 && lower.body.ackedSeq === last2 && beyond.status === 400,
        { lower: lower.body?.ackedSeq, beyond: beyond.status }
      );

      // n3: the socket stays open and presence is held, but nothing is acknowledged.
      const n3 = await api(A, 'POST', '/api/chat/threads', {});
      const id3 = n3.body.thread.id;
      const stale = randomUUID();
      await presence(A, id3, stale, 'foreground');
      await say(A, id3, quick);
      const held = streamUntil(A, id3, 0, () => false, 25_000); // open, never acknowledged
      await waitSettled(A, id3);
      const row3 = await waitNotification(id3, 'terminal:completed', ['dispatched', 'suppressed']);
      rec.record(
        'n.stale-socket',
        'An open stream with presence but no acknowledgement still dispatches',
        row3?.state === 'dispatched',
        { state: row3?.state }
      );

      // n4: an acknowledgement from a client that released presence suppresses nothing.
      const n4 = await api(A, 'POST', '/api/chat/threads', {});
      const id4 = n4.body.thread.id;
      const backgrounded = randomUUID();
      await presence(A, id4, backgrounded, 'foreground');
      await say(A, id4, quick);
      const frames4 = await streamUntil(A, id4, 0, terminal, 120_000);
      await presence(A, id4, backgrounded, 'released');
      const late = await ack(
        A,
        id4,
        backgrounded,
        frames4.filter(f => f.type === 'event').at(-1)!.event.seq
      );
      const row4 = await waitNotification(id4, 'terminal:completed', ['dispatched', 'suppressed']);
      rec.record(
        'n.released-presence',
        'An acknowledgement after presence was released does not suppress',
        late.status === 200 &&
          late.body.suppressedNotificationIds.length === 0 &&
          row4?.state === 'dispatched',
        { ack: late.body, state: row4?.state }
      );

      // n5: two devices; only the second is foreground and acknowledges.
      const n5 = await api(A, 'POST', '/api/chat/threads', {});
      const id5 = n5.body.thread.id;
      const desk = randomUUID();
      const pocket = randomUUID();
      await presence(A, id5, pocket, 'foreground', 'ios');
      await presence(A, id5, pocket, 'released', 'ios');
      await presence(A, id5, desk, 'foreground', 'web');
      await say(A, id5, quick);
      const frames5 = await streamUntil(A, id5, 0, terminal, 120_000);
      const last5 = frames5.filter(f => f.type === 'event').at(-1)!.event.seq;
      const pocketAck = await ack(A, id5, pocket, last5);
      const deskAck = await ack(A, id5, desk, last5);
      const row5 = await waitNotification(id5, 'terminal:completed', ['suppressed', 'dispatched']);
      rec.record(
        'n.either-device',
        'The backgrounded device cannot suppress; the foreground device does',
        pocketAck.body.suppressedNotificationIds.length === 0 &&
          deskAck.body.suppressedNotificationIds.length === 1 &&
          row5?.state === 'suppressed',
        { state: row5?.state }
      );
      const otherOwner = await ack(B, id5, randomUUID(), last5);
      rec.record(
        'n.ack-owner-scoped',
        "Another person cannot acknowledge the owner's thread",
        otherOwner.status === 404,
        { status: otherOwner.status }
      );

      // n6/n7: repeated questions are independent; an answered question is not pushed late.
      const n6 = await newThread(
        A,
        'Before you answer, ask me exactly two clarifying questions, one at a time, each through the question tool: first which color I prefer (red or blue), then which size I prefer (small or large). After both answers, reply with my choices. Do not use other tools.'
      );
      const id6 = n6.thread.id;
      const s6a = await waitSettled(A, id6);
      const q1 = s6a.openQuestion;
      const row6a = await waitNotification(id6, 'question:1', [
        'dispatched',
        'suppressed',
        'cancelled'
      ]);
      await api(A, 'POST', `/api/chat/questions/${q1?.id}/answer`, {
        clientRequestId: randomUUID(),
        expectedRevision: q1?.revision,
        ...(q1 ? firstOption(q1) : { text: 'red' })
      });
      const s6b = await waitSettled(A, id6);
      const q2 = s6b.openQuestion;
      // The second question is answered inside the grace period, with no acknowledgement.
      if (q2)
        await api(A, 'POST', `/api/chat/questions/${q2.id}/answer`, {
          clientRequestId: randomUUID(),
          expectedRevision: q2.revision,
          ...firstOption(q2)
        });
      const s6c = await waitSettled(A, id6);
      const row6b = await waitNotification(id6, 'question:2', [
        'cancelled',
        'dispatched',
        'suppressed'
      ]);
      await waitNotification(id6, 'terminal:completed', ['dispatched', 'suppressed', 'cancelled']);
      const all6 = await notifications(id6);
      extra.repeatedQuestions = {
        rows: all6.map(n => ({ key: n.transition_key, type: n.type, state: n.state })),
        questions: [q1?.prompt, q2?.prompt],
        final: textOf(lastAssistant(s6c)).slice(0, 300)
      };
      rec.record(
        'n.question-dispatched',
        'An unanswered question dispatches a needs-answer notification',
        Boolean(q1) && row6a?.state === 'dispatched' && row6a.type === 'chat_needs_answer',
        { row: row6a }
      );
      rec.record(
        'n.questions-independent',
        'A second question in the same run gets its own candidate',
        Boolean(q2) &&
          all6.some(n => n.transition_key === 'question:1') &&
          all6.some(n => n.transition_key === 'question:2') &&
          s6c.latestRun?.id === s6a.activeRun?.id,
        { keys: all6.map(n => n.transition_key) }
      );
      rec.record(
        'n.answered-not-pushed',
        'A question answered before the grace period ends is cancelled, not pushed',
        row6b?.state === 'cancelled',
        { row: row6b }
      );
      await held;
      rec.record(
        'n.mission-table-untouched',
        'Conversation notifications never write mission notification rows',
        (await missionNotifications()) === beforeMission,
        { before: beforeMission }
      );
      const duplicates = await rows<{ n: string }>(
        `SELECT COUNT(*) AS n FROM (SELECT thread_id, run_id, type, transition_key FROM chat_notifications GROUP BY 1,2,3,4 HAVING COUNT(*) > 1) d`
      );
      rec.record(
        'n.one-candidate-per-transition',
        'Every transition has exactly one candidate',
        Number(duplicates[0]!.n) === 0,
        {}
      );
    },

    /** Rows 13–15 and 17: frozen assignments, concurrent and recovered Create, atomic failure, Cancel versus Create. */
    async create() {
      await api(A, 'PUT', `/api/projects/${P.overlord}/launch-preference`, {
        agent: 'codex',
        model: 'gpt-5.5',
        reasoningEffort: 'medium'
      });
      const before = await counts();
      const { t, proposal } = await proposalThread();
      if (!proposal) {
        rec.record('c.proposal', 'A two-project proposal is prepared', false, {
          answer: textOf(lastAssistant(await waitSettled(A, t.thread.id))).slice(0, 800)
        });
        return;
      }
      const missions = proposal.current.missions;
      const assignments = missions.flatMap((m: any) =>
        m.objectives.map((o: any) => ({
          project: m.projectName,
          ...o.assignment,
          resourceKey: o.resourceKey
        }))
      );
      extra.proposal = {
        id: proposal.id,
        revision: proposal.currentRevision,
        missions: missions.map((m: any) => ({
          project: m.projectName,
          workspaceId: m.workspaceId,
          title: m.title,
          objectives: m.objectives.length,
          audienceWarning: m.audienceWarning
        })),
        assignments
      };
      rec.record(
        'c.proposal',
        'A two-project proposal is prepared with explicit project ids, resources and frozen assignments',
        missions.length === 2 &&
          missions.some((m: any) => m.projectId === P.overlord) &&
          missions.some((m: any) => m.projectId === P.refinery) &&
          assignments.every(
            (a: any) => a.agent === 'codex' && a.model === 'gpt-5.5' && a.resourceKey === 'primary'
          ),
        { assignments }
      );
      rec.record(
        'c.discussion-creates-nothing',
        'Nothing exists before Create is tapped',
        JSON.stringify(before) === JSON.stringify(await counts()),
        {}
      );
      const others = await Promise.all([
        create(B, proposal.id, proposal.currentRevision),
        api(null, 'POST', `/api/chat/proposals/${proposal.id}/create`, {})
      ]);
      const staleCreate = await create(A, proposal.id, proposal.currentRevision + 1);
      rec.record(
        'c.guards',
        'Another person, an anonymous caller and a stale revision cannot create',
        others[0]!.status === 404 &&
          others[1]!.status === 401 &&
          staleCreate.status === 409 &&
          staleCreate.body.code === 'stale_revision',
        { other: others[0]!.status, anonymous: others[1]!.status, stale: staleCreate.body?.code }
      );
      // The project default changes after the card was shown.
      await api(A, 'PUT', `/api/projects/${P.overlord}/launch-preference`, {
        agent: 'claude',
        model: 'claude-opus-4-8',
        reasoningEffort: 'high'
      });
      const requestId = randomUUID();
      const burst = await Promise.all([
        ...Array.from({ length: 4 }, () =>
          create(A, proposal.id, proposal.currentRevision, requestId)
        ),
        ...Array.from({ length: 2 }, () =>
          create(A, proposal.id, proposal.currentRevision, randomUUID())
        )
      ]);
      const ids = burst.map(r => JSON.stringify(missionIds(r.body)));
      const created = await counts();
      rec.record(
        'c.concurrent-identical',
        'Six concurrent Create calls return one identical set of mission ids',
        burst.every(r => r.status === 200) &&
          new Set(ids).size === 1 &&
          missionIds(burst[0]!.body).length === 2 &&
          created.missions === before.missions + 2 &&
          created.objectives === before.objectives + 2,
        {
          statuses: burst.map(r => r.status),
          replayed: burst.map(r => r.body?.replayed),
          distinctIdSets: new Set(ids).size,
          missions: created.missions - before.missions
        }
      );
      const made = missionIds(burst[0]!.body);
      const saved = await rows<any>(
        `SELECT m.id, m.project_id, m.workspace_id, m.status_type, m.created_by_kind, m.created_by_agent, m.created_from_chat_thread_id, m.assigned_workspace_user_id, wu.profile_id AS responsible_profile, o.assigned_agent, o.model, o.reasoning_effort, o.state AS objective_state, o.resource_key,
                (SELECT COUNT(*) FROM execution_requests e WHERE e.mission_id = m.id) AS launches,
                (SELECT COUNT(*) FROM entity_changes c WHERE c.entity_id = m.id) AS changes
           FROM missions m JOIN objectives o ON o.mission_id = m.id LEFT JOIN workspace_users wu ON wu.id = m.assigned_workspace_user_id WHERE m.id = ANY($1)`,
        [made]
      );
      extra.createdDrafts = saved.map(r => ({ ...r, id: undefined }));
      rec.record(
        'c.drafts-only',
        'Created missions are agent-stamped drafts linked to the conversation; nothing is queued or launched',
        saved.length === 2 &&
          saved.every(
            r =>
              r.status_type === 'draft' &&
              r.objective_state === 'draft' &&
              r.created_by_kind === 'agent' &&
              r.created_by_agent === 'overlord-assistant' &&
              r.created_from_chat_thread_id === t.thread.id &&
              Number(r.launches) === 0 &&
              Number(r.changes) > 0
          ),
        {
          rows: saved.map(r => ({
            status: r.status_type,
            objective: r.objective_state,
            by: r.created_by_agent,
            launches: Number(r.launches),
            changes: Number(r.changes)
          }))
        }
      );
      rec.record(
        'c.frozen-assignment',
        'Saved assignments match the card, not the project default changed afterwards',
        saved.every(
          r =>
            r.assigned_agent === 'codex' && r.model === 'gpt-5.5' && r.reasoning_effort === 'medium'
        ),
        {
          saved: saved.map(r => `${r.assigned_agent}/${r.model}/${r.reasoning_effort}`),
          projectDefaultNow: 'claude/claude-opus-4-8/high'
        }
      );
      rec.record(
        'c.responsible-person',
        'The acting user is the responsible person through their membership in each destination workspace',
        saved.every(r => r.responsible_profile === state.users.a!.profileId) &&
          new Set(saved.map(r => r.workspace_id)).size === 2 &&
          new Set(saved.map(r => r.assigned_workspace_user_id)).size === 2,
        {}
      );
      // Crash after commit: the backend dies; a new process answers the retry from the receipt.
      stack('backend-kill9');
      await sleep(1000);
      stack('backend-start');
      const recovered = await create(A, proposal.id, proposal.currentRevision, requestId);
      rec.record(
        'c.recovered-receipt',
        'After the backend is killed and restarted, the retried Create returns the identical ids',
        recovered.status === 200 &&
          recovered.body.replayed === true &&
          JSON.stringify(missionIds(recovered.body)) === ids[0] &&
          (await counts()).missions === created.missions,
        { replayed: recovered.body?.replayed }
      );
      const reload = await api(A, 'GET', `/api/chat/threads/${t.thread.id}`);
      const shown = [...reload.body.openProposals, ...reload.body.referencedProposals].find(
        (p: any) => p.id === proposal.id
      );
      rec.record(
        'c.receipt-in-snapshot',
        'A reloaded snapshot shows the proposal as created with its receipt',
        shown?.state === 'created' &&
          JSON.stringify((shown.receipt?.missions ?? []).map((m: any) => m.missionId).sort()) ===
            ids[0],
        { state: shown?.state }
      );

      // One failing project: nothing is created. (Archiving is not a failure: the existing
      // mission route also accepts an archived project, and Create mirrors that rule.)
      const second = await proposalThread();
      if (!second.proposal) {
        rec.record('c.atomic-failure', 'One failing project creates nothing', false, {
          reason: 'no proposal prepared'
        });
      } else {
        // (a) The owner's membership in the second workspace is disabled after the card was shown.
        const base = await counts();
        const member = await rows<{ id: string }>(
          `UPDATE workspace_users SET status = 'disabled' WHERE workspace_id = $1 AND profile_id = $2 RETURNING id`,
          [state.workspaces!.labs, state.users.a!.profileId]
        );
        const failed = await create(A, second.proposal.id, second.proposal.currentRevision);
        const afterFail = await counts();
        const receipts = await rows('SELECT id FROM chat_work_receipts WHERE proposal_id = $1', [
          second.proposal.id
        ]);
        rec.record(
          'c.atomic-failure',
          'With mission-create access lost in one destination workspace, Create fails and creates no mission in either project',
          member.length === 1 &&
            failed.status === 409 &&
            JSON.stringify(base) === JSON.stringify(afterFail) &&
            receipts.length === 0,
          {
            create: failed.status,
            code: failed.body?.code,
            created: afterFail.missions - base.missions
          }
        );
        await rows(`UPDATE workspace_users SET status = 'active' WHERE id = $1`, [member[0]!.id]);
        // (b) A destination project is deleted after the card was shown.
        const doomed = await api(A, 'POST', '/api/projects', {
          name: `Temp ${randomUUID().slice(0, 8)}`,
          description: 'Scratch project that is deleted before Create.',
          workspaceId: state.workspaces!.labs
        });
        await rows(
          `INSERT INTO project_resources (id, workspace_id, project_id, resource_key, label, is_primary, status, metadata_json, created_at, updated_at, revision) VALUES ($1, $2, $3, 'primary', 'Temp', true, 'active', '{}', $4, $4, 1)`,
          [randomUUID(), state.workspaces!.labs, doomed.body.id, new Date().toISOString()]
        );
        const third = await proposalThread(
          `Prepare draft missions now, without asking me anything else: (1) in the Overlord project, primary resource, one objective to add a GET /api/version endpoint; (2) in the project named "${doomed.body.name}", primary resource, one objective to write a CHANGELOG. Use agent codex with model gpt-5.5 and medium reasoning for both.`
        );
        if (!third.proposal || third.proposal.current.missions.length !== 2) {
          rec.record(
            'c.atomic-deleted-project',
            'A deleted destination project creates nothing',
            false,
            {
              reason: 'no two-project proposal prepared',
              missions: third.proposal?.current.missions.length
            }
          );
        } else {
          const baseline = await counts();
          const deleted = await api(A, 'DELETE', `/api/projects/${doomed.body.id}`);
          const failedDelete = await create(A, third.proposal.id, third.proposal.currentRevision);
          const afterDelete = await counts();
          rec.record(
            'c.atomic-deleted-project',
            'With one destination project deleted, Create fails and creates no mission in the surviving project',
            deleted.status === 200 &&
              failedDelete.status !== 200 &&
              afterDelete.missions === baseline.missions &&
              afterDelete.objectives === baseline.objectives,
            {
              delete: deleted.status,
              create: failedDelete.status,
              code: failedDelete.body?.code,
              created: afterDelete.missions - baseline.missions
            }
          );
        }
        // Losing access invalidated the card for good: restoring access does not revive it.
        const retried = await create(A, second.proposal.id, second.proposal.currentRevision);
        const reloaded = await api(A, 'GET', `/api/chat/threads/${second.t.thread.id}`);
        const card = [...reloaded.body.openProposals, ...reloaded.body.referencedProposals].find(
          (p: any) => p.id === second.proposal.id
        );
        rec.record(
          'c.invalidated-stays-invalid',
          'After access was lost the card stays invalidated when access returns; a new proposal is required',
          retried.status === 409 &&
            retried.body.code === 'proposal_not_creatable' &&
            card?.current.invalidated === true,
          {
            status: retried.status,
            code: retried.body?.code,
            invalidated: card?.current.invalidated
          }
        );
      }

      // Cancel versus Create on a published revision.
      await ensureRefineryResource();
      const race = await api(A, 'POST', '/api/chat/threads', {});
      const raceId = race.body.thread.id;
      const submitted = await say(
        A,
        raceId,
        `${DRAFT_PROMPT} After preparing the card, also read the git status of the Overlord primary resource and summarize it.`
      );
      const published = await streamUntil(
        A,
        raceId,
        0,
        frame => frame.event?.kind === 'proposal.revised' || settledFrame(frame),
        180_000
      );
      const revised = published.find(f => f.event?.kind === 'proposal.revised')?.event.proposal;
      if (!revised) {
        rec.record('c.cancel-vs-create', 'Cancel and Create race on a published revision', false, {
          reason: 'no proposal was published before the run settled'
        });
      } else {
        const base = await counts();
        const [cancelled, createdRace] = await Promise.all([
          api(A, 'POST', `/api/chat/runs/${submitted.body.run.id}/cancel`, {
            clientRequestId: randomUUID()
          }),
          create(A, revised.id, revised.currentRevision)
        ]);
        const end = await waitSettled(A, raceId);
        const afterRace = await counts();
        extra.cancelVsCreate = {
          cancel: cancelled.body?.state,
          create: createdRace.status,
          run: end.latestRun?.state,
          missions: afterRace.missions - base.missions
        };
        rec.record(
          'c.cancel-vs-create',
          'Create of a published revision succeeds despite a concurrent Cancel, and the Cancel does not remove the drafts',
          createdRace.status === 200 &&
            afterRace.missions === base.missions + revised.current.missions.length &&
            ['cancelled', 'completed'].includes(end.latestRun?.state),
          extra.cancelVsCreate as Record<string, unknown>
        );
        const again = await api(A, 'POST', `/api/chat/runs/${submitted.body.run.id}/cancel`, {
          clientRequestId: randomUUID()
        });
        rec.record(
          'c.cancel-idempotent',
          'Cancelling again returns the same terminal run',
          again.status === 200 && again.body.state === end.latestRun?.state,
          { state: again.body?.state }
        );
      }
    },

    /** Cancellation is authoritative: no tool work continues afterwards. */
    async cancel() {
      const t = await newThread(
        A,
        'Read at least ten different source files from the Overlord primary resource, one after another in separate steps, and summarize each.'
      );
      await streamUntil(A, t.thread.id, 0, frame => frame.event?.kind === 'tool.updated', 60_000);
      const cancelled = await api(A, 'POST', `/api/chat/runs/${t.run.id}/cancel`, {
        clientRequestId: randomUUID()
      });
      const callsAt = (await toolCalls(t.run.id)).length;
      await sleep(8000);
      const later = await toolCalls(t.run.id);
      const snap = await api(A, 'GET', `/api/chat/threads/${t.thread.id}`);
      rec.record(
        'x.cancelled',
        'Cancel ends the run as cancelled immediately',
        cancelled.status === 200 &&
          cancelled.body.state === 'cancelled' &&
          snap.body.latestRun?.state === 'cancelled' &&
          !snap.body.activeRun,
        { state: cancelled.body?.state }
      );
      rec.record(
        'x.no-work-after-cancel',
        'No tool call is requested after the cancel',
        later.length === callsAt &&
          later.every(c => ['completed', 'failed', 'cancelled'].includes(c.state)),
        { at: callsAt, later: later.length, states: [...new Set(later.map(c => c.state))] }
      );
      const next = await say(A, t.thread.id, 'Reply with the single word "ok". No tools.');
      const end = await waitSettled(A, t.thread.id);
      rec.record(
        'x.next-message',
        'A new message is accepted after a cancel and gets its own run',
        next.status === 200 &&
          next.body.run.id !== t.run.id &&
          end.latestRun?.state === 'completed',
        {}
      );
      const notes = await rows<{ transition_key: string }>(
        'SELECT transition_key FROM chat_notifications WHERE run_id = $1',
        [t.run.id]
      );
      rec.record(
        'x.no-notification',
        'A cancelled run sends no finished notification',
        notes.length === 0,
        { keys: notes.map(n => n.transition_key) }
      );
    },

    /** Row 11 and row 16: kill the backend at each tool boundary; recovery resumes from the checkpoint; the stale attempt is fenced. */
    async restart() {
      stack('backend-stop');
      await sleep(1500);
      stack('backend-start', { EXTRA_ENV: 'CHAT_ATTEMPT_LEASE_MS=8000' });
      const outcomes: any[] = [];
      for (const phase of ['tool_requested', 'tool_results_joined'] as const) {
        const t = await newThread(
          A,
          phase === 'tool_requested'
            ? 'In parallel, read the git status of the Overlord primary resource and of the mobile resource. Then read README.md from the mobile resource. Then tell me which resource has more modified files and what the mobile README says in one sentence.'
            : 'Check our notes for the Sandbox Service rate limiting decision, and in parallel read src/server.ts from the Sandbox Service on Jake Mac. Then tell me whether the code already implements the decision.'
        );
        // Wait for the wanted checkpoint boundary, then kill the process without warning.
        let killedAt: string | null = null;
        const until = Date.now() + 90_000;
        while (Date.now() < until) {
          const cp = await rows<{ phase: string }>(
            'SELECT phase FROM chat_provider_checkpoints WHERE run_id = $1',
            [t.run.id]
          );
          if (cp[0]?.phase === phase) {
            stack('backend-kill9');
            killedAt = phase;
            break;
          }
          const run = await rows<{ state: string }>('SELECT state FROM chat_runs WHERE id = $1', [
            t.run.id
          ]);
          if (['completed', 'failed', 'cancelled'].includes(run[0]?.state ?? '')) break;
          await sleep(15);
        }
        const atKill = {
          run: (
            await rows('SELECT state, current_fence FROM chat_runs WHERE id = $1', [t.run.id])
          )[0],
          calls: (await toolCalls(t.run.id)).map(c => ({
            tool: c.tool_id,
            state: c.state,
            executions: c.executions
          })),
          checkpoint:
            (
              await rows('SELECT phase, fence FROM chat_provider_checkpoints WHERE run_id = $1', [
                t.run.id
              ])
            )[0] ?? null
        };
        await sleep(1000);
        stack('backend-start', { EXTRA_ENV: 'CHAT_ATTEMPT_LEASE_MS=8000' });
        const restartedAt = Date.now();
        const snap = await waitSettled(A, t.thread.id, 240_000);
        const attempts = await rows<any>(
          'SELECT attempt_number, fence, state, recovery_mode, failure_code FROM chat_run_attempts WHERE run_id = $1 ORDER BY attempt_number',
          [t.run.id]
        );
        const calls = await toolCalls(t.run.id);
        const assistant = snap.messages.filter(
          (m: any) => m.role === 'assistant' && m.runId === t.run.id
        );
        const seqs = (
          await rows<{ seq: number }>(
            'SELECT seq FROM chat_events WHERE thread_id = $1 ORDER BY seq',
            [t.thread.id]
          )
        ).map(r => Number(r.seq));
        const leftover = await rows(
          'SELECT run_id FROM chat_provider_checkpoints WHERE run_id = $1',
          [t.run.id]
        );
        const outcome = {
          phase,
          killedAt,
          atKill,
          recoveryMs: Date.now() - restartedAt,
          attempts,
          calls: calls.map(c => ({
            tool: c.tool_id.replace(/kb_[0-9a-f]+_/, 'kb:'),
            state: c.state,
            executions: c.executions,
            outcome: c.outcome
          })),
          run: snap.latestRun,
          answer: textOf(lastAssistant(snap)).slice(0, 700)
        };
        outcomes.push(outcome);
        rec.record(
          `s.${phase}.killed`,
          `Backend killed at the ${phase} boundary`,
          killedAt === phase,
          { atKill }
        );
        rec.record(
          `s.${phase}.resumed`,
          'A new attempt resumes from the provider checkpoint and the run completes',
          snap.latestRun?.state === 'completed' &&
            attempts.length >= 2 &&
            attempts.at(-1).recovery_mode === 'checkpoint' &&
            attempts[0].state !== 'leased',
          { attempts, run: snap.latestRun?.state }
        );
        rec.record(
          `s.${phase}.reads-once`,
          'Completed reads are not repeated; an interrupted read reruns under its original operation',
          calls.every(c => c.state === 'completed' && c.executions <= 2) &&
            (phase === 'tool_results_joined'
              ? calls
                  .filter(c =>
                    atKill.calls.some((k: any) => k.state === 'completed' && k.tool === c.tool_id)
                  )
                  .every(c => c.executions === 1)
              : true),
          { executions: calls.map(c => c.executions) }
        );
        rec.record(
          `s.${phase}.transcript`,
          'One assistant message for the run, gap-free events, and the checkpoint is deleted at completion',
          assistant.length === 1 &&
            seqs.every((s, i) => i === 0 || s === seqs[i - 1]! + 1) &&
            leftover.length === 0,
          { assistantMessages: assistant.length, events: seqs.length }
        );
        // Row 16: a write carrying the dead attempt's fence is rejected by the database itself.
        const dead = attempts[0];
        const deadAttempt = (
          await rows<{ id: string }>(
            'SELECT id FROM chat_run_attempts WHERE run_id = $1 AND attempt_number = 1',
            [t.run.id]
          )
        )[0]!;
        // Advance the thread sequence in the same transaction so the fence check, not the
        // gap-free sequence check, is what refuses the row.
        const client = await db().connect();
        let staleEvent = 'accepted';
        try {
          await client.query('BEGIN');
          await client.query(
            'UPDATE chat_threads SET last_event_seq = last_event_seq + 1 WHERE id = $1',
            [t.thread.id]
          );
          await client.query(
            `INSERT INTO chat_events (id, thread_id, seq, kind, run_id, attempt_id, fence, payload_json, created_at) VALUES ($1, $2, (SELECT last_event_seq FROM chat_threads WHERE id = $2), 'message.delta', $3, $4, $5, '{}', $6)`,
            [
              randomUUID(),
              t.thread.id,
              t.run.id,
              deadAttempt.id,
              dead.fence,
              new Date().toISOString()
            ]
          );
        } catch (error) {
          staleEvent = String((error as Error).message).slice(0, 160);
        } finally {
          await client.query('ROLLBACK').catch(() => undefined);
          client.release();
        }
        const staleCheckpoint = await rows(
          `INSERT INTO chat_provider_checkpoints (run_id, attempt_id, fence, schema_version, provider, model, config_digest, phase, payload_json, created_at, updated_at) VALUES ($1, $2, $3, 1, 'gemini', 'gemini-3.8-flash', 'x', 'tool_requested', '{}', $4, $4)`,
          [t.run.id, deadAttempt.id, dead.fence, new Date().toISOString()]
        ).then(
          () => 'accepted',
          error => String(error.message).slice(0, 160)
        );
        rec.record(
          `s.${phase}.stale-writes`,
          'An event or checkpoint written with the dead attempt’s fence is rejected',
          staleEvent !== 'accepted' && staleCheckpoint !== 'accepted',
          { staleEvent, staleCheckpoint }
        );
      }
      extra.restart = outcomes;
      stack('backend-stop');
      await sleep(1500);
      stack('backend-start');
    }
  });
}
