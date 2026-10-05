/* eslint-disable no-console -- acceptance harness */
// coo:1108.z77k acceptance harness helpers — NOT production code.
//
// Everything here talks to a scratch backend the way a remote client does: HTTP with a
// bearer credential. Database access is used only to seed target bindings that the REST
// surface would otherwise write into a checkout, and to assert on rows no DTO exposes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const ROOT = path.resolve(import.meta.dirname, '../../..');
export const WORK =
  process.env.ACCEPTANCE_WORK_DIR ??
  (() => {
    throw new Error('ACCEPTANCE_WORK_DIR is required (scratch directory outside the repository)');
  })();
export const BASE = process.env.ACCEPTANCE_BASE_URL ?? 'http://127.0.0.1:4411';
export const KB_CONTROL = process.env.ACCEPTANCE_KB_CONTROL_URL ?? 'http://127.0.0.1:4412';
export const DATABASE_URL =
  process.env.ACCEPTANCE_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54790/overlord_accept';
export const STATE_FILE = path.join(WORK, 'state.json');

export interface State {
  users: Record<string, { email: string; token: string; profileId: string }>;
  organizationId?: string;
  otherOrganizationId?: string;
  workspaces?: Record<string, string>;
  projects?: Record<string, string>;
  targets?: Record<string, string>;
  runnerTokens?: Record<string, string>;
  knowledgebase?: { connectionId: string; notes: Record<string, string> };
}

export function loadState(): State {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { users: {} };
}
export function saveState(state: State) {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
  headers: Headers;
  ms: number;
}

/** One JSON request. Never throws on an HTTP status; callers assert on it. */
export async function api<T = any>(
  token: string | null,
  method: string,
  route: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<ApiResult<T>> {
  const started = Date.now();
  const response = await fetch(BASE + route, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Origin: BASE,
      ...extraHeaders
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual'
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body stays text */
  }
  return {
    status: response.status,
    body: parsed as T,
    headers: response.headers,
    ms: Date.now() - started
  };
}

export async function kbControl<T = any>(route: string, body: unknown = {}): Promise<T> {
  const response = await fetch(KB_CONTROL + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return (await response.json()) as T;
}

let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  return (pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 4 }));
}
export async function rows<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query(sql, params)).rows as T[];
}
export async function closeDb() {
  await pool?.end();
  pool = null;
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Polls the snapshot until the thread has no running run (terminal or waiting on the user). */
export async function waitSettled(token: string, threadId: string, timeoutMs = 300_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const snap = await api(token, 'GET', `/api/chat/threads/${threadId}`);
    if (snap.status !== 200)
      throw new Error(`snapshot ${snap.status} ${JSON.stringify(snap.body)}`);
    const active = snap.body.activeRun;
    if (!active || active.state === 'waiting_user') return snap.body;
    if (Date.now() > until) throw new Error('timed out waiting for the run to settle');
    await sleep(700);
  }
}

/** Opens the event stream and collects frames until `stop` returns true or the time runs out. */
export async function streamUntil(
  token: string,
  threadId: string,
  after: number,
  stop: (frame: any, frames: any[]) => boolean,
  timeoutMs = 120_000
): Promise<any[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const frames: any[] = [];
  try {
    const response = await fetch(`${BASE}/api/chat/threads/${threadId}/events?after=${after}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal
    });
    if (response.status !== 200) throw new Error(`stream ${response.status}`);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = raw
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('\n');
        if (!data) continue;
        const frame = JSON.parse(data);
        frames.push(frame);
        if (stop(frame, frames)) {
          controller.abort();
          return frames;
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
  }
  return frames;
}

export const textOf = (message: any): string =>
  (message?.blocks ?? [])
    .filter((b: any) => b.kind === 'text')
    .map((b: any) => b.text)
    .join('\n');
export const lastAssistant = (snapshot: any) =>
  [...(snapshot.messages ?? [])].reverse().find((m: any) => m.role === 'assistant');

export interface CheckResult {
  id: string;
  title: string;
  status: 'pass' | 'fail' | 'blocked';
  detail: Record<string, unknown>;
}
export class Recorder {
  readonly results: CheckResult[] = [];
  constructor(readonly name: string) {}
  record(id: string, title: string, ok: boolean, detail: Record<string, unknown> = {}) {
    this.results.push({ id, title, status: ok ? 'pass' : 'fail', detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${title}`);
    if (!ok) console.log(JSON.stringify(detail, null, 2));
  }
  blocked(id: string, title: string, detail: Record<string, unknown>) {
    this.results.push({ id, title, status: 'blocked', detail });
    console.log(`BLOCKED  ${id}  ${title}`);
  }
  save(extra: Record<string, unknown> = {}) {
    const dir = path.join(import.meta.dirname, 'results');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${this.name}-${new Date().toISOString().slice(0, 10)}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          harness: this.name,
          finishedAt: new Date().toISOString(),
          summary: {
            pass: this.results.filter(r => r.status === 'pass').length,
            fail: this.results.filter(r => r.status === 'fail').length,
            blocked: this.results.filter(r => r.status === 'blocked').length
          },
          results: this.results,
          ...extra
        },
        null,
        2
      )
    );
    console.log(`saved ${path.relative(ROOT, file)}`);
  }
}
