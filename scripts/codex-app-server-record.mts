/**
 * Dev tool: drive the real `codex-app-server` supervisor against a live `codex app-server` and
 * record every JSON-RPC frame, so a Codex upgrade is a re-recording and a diff rather than a
 * hand edit of fixtures (plan §8).
 *
 * It spawns a private server for a throwaway git repo, runs the supervisor with an in-memory
 * channel, and walks one scenario:
 *   1. the objective prompt runs a command → command approval, answered "allow" through the
 *      channel; while it is pending, an inbox instruction is steered into the running turn;
 *   2. the patch approval is answered by a second client first → the card is resolved elsewhere;
 *   3. at the turn boundary a second inbox instruction starts a new turn, whose command approval
 *      is held until Overlord stops the session → the running turn is interrupted.
 * Scenario `b` records patch approvals (answered elsewhere, then denied) and a structured
 * question. Scenario `c` records child threads and history (coo:1325.nagv): the prompt has the
 * agent spawn a subagent that writes a file (its approval is answered through the channel); once
 * the root turn completes, a second client forks the thread, and a second supervisor resumes it
 * with `importHistory`, recording `thread/turns/list` and `thread/list` pages.
 *
 * Usage (spends model tokens; needs a logged-in Codex):
 *   TSX_TSCONFIG_PATH=scripts/codex-app-server.tsconfig.json \
 *     node --import tsx scripts/codex-app-server-record.mts <out-dir> [a|b|c]
 *
 * Output: <out-dir>/frames.jsonl (raw, unredacted — redact before committing) and
 * <out-dir>/channel.jsonl. Never commit raw output: it contains local paths.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';

import type { CodecSpec } from '../packages/core/service/agent-session/pure/codec.ts';
import { createFakeChannel } from '../cli/src/agent-session/codex-app-server/fake-channel.ts';
import {
  readCodexVersion,
  spawnPrivateAppServer
} from '../cli/src/agent-session/codex-app-server/server.ts';
import { runCodexAppServerSupervisor } from '../cli/src/agent-session/codex-app-server/supervisor.ts';
import {
  connectWebSocket,
  type MessageTransport
} from '../cli/src/agent-session/codex-app-server/transport.ts';

const outDir = path.resolve(process.argv[2] ?? mkdtempSync(path.join(tmpdir(), 'cx-record-')));
mkdirSync(outDir, { recursive: true });
const framesPath = path.join(outDir, 'frames.jsonl');
const channelPath = path.join(outDir, 'channel.jsonl');
writeFileSync(framesPath, '');
writeFileSync(channelPath, '');
const t0 = Date.now();
const log = (file: string, entry: unknown) =>
  appendFileSync(file, `${JSON.stringify({ t: Date.now() - t0, ...(entry as object) })}\n`);

const repo = mkdtempSync(path.join(tmpdir(), 'cx-probe-repo-'));
execFileSync('git', ['init', '-q'], { cwd: repo });
writeFileSync(path.join(repo, 'README.md'), '# probe\n');
execFileSync('git', ['add', '.'], { cwd: repo });
execFileSync(
  'git',
  ['-c', 'user.email=probe@example.invalid', '-c', 'user.name=probe', 'commit', '-qm', 'init'],
  { cwd: repo }
);

const codec = parseYaml(
  readFileSync('connectors/adapters/codex-app-server/codec/codex-app-server.codec.yaml', 'utf8')
) as CodecSpec;

console.log(`codex ${readCodexVersion('codex', process.env)}; repo ${repo}; out ${outDir}`);
const server = await spawnPrivateAppServer({ cwd: repo, env: process.env });

function recording(inner: MessageTransport, who: string): MessageTransport {
  inner.onMessage(text => log(framesPath, { who, dir: 'in', msg: JSON.parse(text) }));
  return {
    send: text => {
      log(framesPath, { who, dir: 'out', msg: JSON.parse(text) });
      inner.send(text);
    },
    onMessage: listener => inner.onMessage(listener),
    onClose: listener => inner.onClose(listener),
    close: () => inner.close()
  };
}

// Scenario state. `a`: command approval + steer + interrupt. `b`: patch approvals (answered
// elsewhere, then denied) and a structured question.
const scenario = process.argv[3] === 'b' ? 'b' : process.argv[3] === 'c' ? 'c' : 'a';
let commandCards = 0;
let steerArmed = false;
let steerSent = false;
let boundaryArmed = false;
let boundarySent = false;
const controller = new AbortController();
let observerAnswered = false;
let turnsCompleted = 0;
const boundaryInputs =
  scenario === 'c'
    ? []
    : scenario === 'a'
      ? ['Now run the shell command: sleep 30']
      : [
          'Use apply_patch (not the shell) to append a second line, bye, to notes.md.',
          'Use the request_user_input tool to ask me one question: do I prefer red or blue? Offer the options red and blue. After I answer, reply with only my answer.'
        ];
let boundaryIndex = 0;
const resolutions = new Map<string, unknown>();

const channel = createFakeChannel({
  onCall: call => log(channelPath, call)
});
const basePost = channel.post;
let cardCount = 0;
channel.post = async <T,>(p: string, body?: unknown) => {
  if (p === '/requests') {
    cardCount += 1;
    const reqId = `req-${cardCount}`;
    const card = body as { kind?: string; details?: { codexKind?: string } };
    if (card.details?.codexKind === 'command') {
      commandCards += 1;
      if (scenario === 'a' && commandCards === 1) steerArmed = true;
      if (scenario === 'a' && commandCards === 2) setTimeout(() => controller.abort(), 4000);
      if (scenario === 'b') resolutions.set(reqId, { decision: 'allow' });
    }
    if (card.details?.codexKind === 'fileChange') {
      if (!observerAnswered) {
        observerAnswered = true;
        void answerAsObserver();
      } else {
        resolutions.set(reqId, { decision: 'deny' });
      }
    }
    if (card.details?.codexKind === 'requestUserInput') {
      resolutions.set(reqId, { optionId: 'option-1' });
    }
    // Scenario c allows everything, the subagent's approvals included.
    if (scenario === 'c') resolutions.set(reqId, { decision: 'allow' });
  }
  if (p === '/inputs/claim') {
    if (steerArmed && !steerSent) {
      steerSent = true;
      await basePost(p, body);
      return {
        ok: true,
        value: {
          input: {
            id: 'input-steer',
            kind: 'instruction',
            body: 'Also make notes.md end with a second line: bye',
            leaseId: 'lease-steer'
          }
        }
      } as never;
    }
    if (boundaryArmed && boundaryIndex < boundaryInputs.length && boundarySent === false) {
      boundarySent = true;
      const bodyText = boundaryInputs[boundaryIndex]!;
      boundaryIndex += 1;
      await basePost(p, body);
      return {
        ok: true,
        value: {
          input: {
            id: `input-boundary-${boundaryIndex}`,
            kind: 'instruction',
            body: bodyText,
            leaseId: `lease-boundary-${boundaryIndex}`
          }
        }
      } as never;
    }
  }
  const leaseMatch = /^\/requests\/(req-\d+)\/lease$/.exec(p);
  if (leaseMatch) {
    const reqId = leaseMatch[1]!;
    const ready = scenario === 'a' ? reqId === 'req-1' && steerSent : resolutions.has(reqId);
    if (ready) {
      await basePost(p, body);
      const resolution = scenario === 'a' ? { decision: 'allow' } : resolutions.get(reqId);
      return { ok: true, value: { leaseId: 'lease-1', status: 'resolved', resolution } } as never;
    }
  }
  if (p === '/events') {
    const event = (body as { events?: { nativeEvent?: string; subagentId?: string | null }[] })
      .events?.[0];
    if (scenario === 'c' && event?.nativeEvent === 'turn/completed' && !event.subagentId) {
      setTimeout(() => controller.abort(), 1500);
    }
    if (event?.nativeEvent === 'turn/completed') {
      turnsCompleted += 1;
      boundaryArmed = true;
      boundarySent = false;
      if (scenario === 'b' && turnsCompleted > boundaryInputs.length) {
        setTimeout(() => controller.abort(), 500);
      }
    }
  }
  return basePost(p, body);
};

let threadIdForObserver: string | null = null;
async function answerAsObserver(): Promise<void> {
  const observer = recording(
    await connectWebSocket({ kind: 'unix', socketPath: server.socketPath }),
    'observer'
  );
  let id = 100;
  const send = (method: string, params: unknown) => {
    id += 1;
    observer.send(JSON.stringify({ id, method, params }));
  };
  observer.onMessage(text => {
    const msg = JSON.parse(text) as { id?: unknown; method?: string };
    if (msg.method === 'item/fileChange/requestApproval' && msg.id !== undefined) {
      observer.send(JSON.stringify({ id: msg.id, result: { decision: 'accept' } }));
      setTimeout(() => observer.close(), 500);
    }
  });
  send('initialize', {
    clientInfo: { name: 'overlord_observer', title: null, version: '0' },
    capabilities: { experimentalApi: false, requestAttestation: false }
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  observer.send(JSON.stringify({ method: 'initialized' }));
  send('thread/resume', { threadId: threadIdForObserver });
}

const result = await runCodexAppServerSupervisor({
  codec,
  client: channel,
  connect: async () => {
    const transport = recording(
      await connectWebSocket({ kind: 'unix', socketPath: server.socketPath }),
      'overlord'
    );
    transport.onMessage(text => {
      const msg = JSON.parse(text) as { result?: { thread?: { id?: string } } };
      if (msg.result?.thread?.id) threadIdForObserver = msg.result.thread.id;
    });
    return transport;
  },
  cwd: repo,
  clientVersion: 'record',
  firstPrompt:
    scenario === 'c'
      ? 'Spawn exactly one subagent (use your spawn_agent tool) and ask it to create a file named child.txt containing the single line "from child" using apply_patch, and nothing else. Wait for it to finish. Then yourself create parent.txt containing "from parent" using apply_patch. Reply "done".'
      : scenario === 'a'
        ? 'Run the shell command `sleep 4 && echo step-one`. Then create a file notes.md whose only line is: hello. Do nothing else.'
        : 'Use your apply_patch tool (not the shell) to create a file notes.md whose only line is: hello. Do nothing else.',
  threadSettings: { approvalPolicy: 'untrusted', sandbox: 'workspace-write', effort: 'low' },
  heartbeatIntervalMs: 0,
  injectIntervalMs: 500,
  stopSignal: controller.signal,
  maxReconnects: 0
});

console.log(JSON.stringify(result, null, 2));

if (scenario === 'c' && result.threadId) {
  // A second client forks the thread, as `/fork` in an attached TUI would.
  const forker = recording(
    await connectWebSocket({ kind: 'unix', socketPath: server.socketPath }),
    'forker'
  );
  forker.send(
    JSON.stringify({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'overlord_forker', title: null, version: '0' },
        capabilities: { experimentalApi: true, requestAttestation: false }
      }
    })
  );
  await new Promise(resolve => setTimeout(resolve, 300));
  forker.send(JSON.stringify({ method: 'initialized' }));
  forker.send(
    JSON.stringify({ id: 2, method: 'thread/fork', params: { threadId: result.threadId } })
  );
  await new Promise(resolve => setTimeout(resolve, 1500));
  forker.close();
  // A resumed supervisor imports the tree's history.
  const resumeController = new AbortController();
  setTimeout(() => resumeController.abort(), 5000);
  const resumed = await runCodexAppServerSupervisor({
    codec,
    client: createFakeChannel({ onCall: call => log(channelPath, { phase: 'resume', ...call }) }),
    connect: async () =>
      recording(
        await connectWebSocket({ kind: 'unix', socketPath: server.socketPath }),
        'overlord-resume'
      ),
    cwd: repo,
    clientVersion: 'record',
    threadId: result.threadId,
    importHistory: true,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0,
    stopSignal: resumeController.signal,
    maxReconnects: 0
  });
  console.log(JSON.stringify(resumed, null, 2));
}
await server.stop();
console.log(`frames: ${framesPath}`);
