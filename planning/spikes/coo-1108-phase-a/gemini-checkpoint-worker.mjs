/* eslint-disable no-console -- proof script */
// coo:1108 Phase A feasibility proof — NOT production code and NOT a contracted interface.
//
// A single-run Gemini tool-loop worker that persists a private, versioned provider
// checkpoint in SQLite (node:sqlite) and can be SIGKILLed at named boundaries:
//
//   request_persisted  the complete model function-call turn is checkpointed; no tool ran yet
//   tool_started       a tool receipt is in `requested` state; its result is not recorded
//   result_persisted   every result of the batch is recorded and joined to the checkpoint;
//                      the next provider request has not been sent
//
// Usage: node gemini-checkpoint-worker.mjs --db <path> --run <id> --scenario <name>
//          [--crash-at <boundary>] [--crash-on-turn <n>]
//
// Logs carry IDs, counts and digests only. Checkpoint payloads, provider parts and
// signatures are never printed.

import { createHash, randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { openStore, StaleFenceError } from './checkpoint-store.mjs';
import { SCENARIOS, TOOL_DECLARATIONS, executeTool } from './fixtures.mjs';

export const MODEL = process.env.CHAT_PROOF_MODEL ?? 'gemini-3.8-flash';
export const CHECKPOINT_SCHEMA_VERSION = 1;

const args = parseArgs(process.argv.slice(2));
const store = openStore(args.db);
const scenario = SCENARIOS[args.scenario];
if (!scenario) throw new Error(`unknown scenario ${args.scenario}`);
const crashAt = args['crash-at'] ?? null;
const crashOnTurn = Number(args['crash-on-turn'] ?? 0);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const attemptId = randomUUID();
const fence = store.claimAttempt(args.run, attemptId, args.scenario);
log('attempt.claimed', { fence });

const generationConfig = {
  systemInstruction: scenario.system,
  tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
  temperature: 0
};
const configDigest = digest(JSON.stringify({ model: MODEL, generationConfig }));

let cp = store.loadCheckpoint(args.run);
if (cp) {
  if (cp.schemaVersion !== CHECKPOINT_SCHEMA_VERSION || cp.model !== MODEL || cp.configDigest !== configDigest) {
    // Not resumable: the caller must choose fresh-generation recovery explicitly.
    log('checkpoint.incompatible', { schemaVersion: cp.schemaVersion });
    process.exit(3);
  }
  log('checkpoint.restored', { turns: cp.contents.length, pending: cp.pending?.calls.length ?? 0 });
} else {
  cp = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    model: MODEL,
    configDigest,
    contents: [{ role: 'user', parts: [{ text: scenario.prompt }] }],
    pending: null,
    providerRequests: 0
  };
  store.saveCheckpoint(args.run, fence, cp, 'ready');
}

try {
  for (;;) {
    if (cp.pending) {
      await resolvePending();
      continue;
    }
    if (cp.providerRequests >= 12) throw new Error('tool budget exhausted');
    const turn = await streamModelTurn();
    cp.providerRequests += 1;
    const calls = turn.parts.filter((p) => p.functionCall);
    cp.contents.push({ role: 'model', parts: turn.parts });
    if (calls.length === 0) {
      store.saveCheckpoint(args.run, fence, cp, 'completed');
      store.completeRun(args.run, fence, turn.text);
      log('run.completed', { providerRequests: cp.providerRequests, textChars: turn.text.length });
      break;
    }
    const turnIndex = cp.contents.length - 1;
    cp.pending = {
      turnIndex,
      calls: calls.map((p, order) => ({
        order,
        providerCallId: p.functionCall.id ?? null,
        // A stable ID even when the provider omits one: turn index + order in the turn.
        callId: p.functionCall.id ?? `t${turnIndex}.c${order}`,
        name: p.functionCall.name,
        args: p.functionCall.args ?? {}
      }))
    };
    for (const call of cp.pending.calls) {
      store.recordToolRequest(args.run, fence, operationId(call), call);
    }
    store.saveCheckpoint(args.run, fence, cp, 'tool_requested');
    log('tools.requested', {
      turnIndex,
      calls: cp.pending.calls.map((c) => `${c.order}:${c.name}:${c.providerCallId ? 'provider-id' : 'synth-id'}`),
      signedParts: turn.parts.filter((p) => p.thoughtSignature).length
    });
    maybeCrash('request_persisted');
  }
} catch (error) {
  if (error instanceof StaleFenceError) {
    log('attempt.fenced', { fence });
    process.exit(4);
  }
  log('attempt.failed', { status: error.status ?? null, message: String(error.message).slice(0, 200) });
  process.exit(2);
}

async function resolvePending() {
  const { turnIndex, calls } = cp.pending;
  for (const call of calls) {
    const opId = operationId(call);
    const receipt = store.getToolReceipt(opId);
    if (receipt?.state === 'completed') continue;
    // A `requested` receipt may have been executing when the worker died. Every tool in
    // this proof is a read, so it is re-executed under the same operation ID; a write
    // would instead be reconciled against its target before any retry.
    store.markToolStarted(args.run, fence, opId);
    maybeCrash('tool_started');
    const result = await executeTool(call.name, call.args);
    store.recordToolResult(args.run, fence, opId, result);
  }
  // Results join the checkpoint in the provider's original call order, never completion order.
  const responses = calls.map((call) => {
    const { result } = store.getToolReceipt(operationId(call));
    return {
      functionResponse: {
        ...(call.providerCallId ? { id: call.providerCallId } : {}),
        name: call.name,
        response: result
      }
    };
  });
  cp.contents.push({ role: 'user', parts: responses });
  cp.pending = null;
  store.saveCheckpoint(args.run, fence, cp, 'results_joined');
  log('tools.results_joined', { turnIndex, results: responses.length });
  maybeCrash('result_persisted');
}

async function streamModelTurn() {
  const stream = await ai.models.generateContentStream({
    model: MODEL,
    contents: cp.contents,
    config: generationConfig
  });
  const parts = [];
  let text = '';
  let chunks = 0;
  for await (const chunk of stream) {
    chunks += 1;
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (part.functionCall?.partialArgs || part.functionCall?.willContinue) {
        throw new Error('streamed partial function-call arguments are not handled by this proof');
      }
      // Keep every provider part verbatim and in arrival order. Merging text fragments
      // could detach a thought signature from the part it was issued on.
      parts.push(part);
      if (part.text && !part.thought) {
        text += part.text;
        store.appendEvent(args.run, fence, 'text.delta', { chars: part.text.length });
      }
    }
  }
  log('provider.turn', {
    chunks,
    parts: parts.length,
    functionCalls: parts.filter((p) => p.functionCall).length,
    signatures: parts.filter((p) => p.thoughtSignature).map((p) => digest(p.thoughtSignature).slice(0, 8))
  });
  return { parts, text };
}

function operationId(call) {
  return `${args.run}:${cp.pending?.turnIndex ?? 'x'}:${call.order}`;
}

function maybeCrash(boundary) {
  if (crashAt !== boundary) return;
  // Provider requests so far: 1 = the first function-call batch, 2 = the second, ...
  if (crashOnTurn && cp.providerRequests !== crashOnTurn) return;
  log('worker.sigkill', { boundary });
  process.kill(process.pid, 'SIGKILL');
}

function log(event, data) {
  console.log(JSON.stringify({ event, run: args.run, attempt: attemptId.slice(0, 8), ...data }));
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}
