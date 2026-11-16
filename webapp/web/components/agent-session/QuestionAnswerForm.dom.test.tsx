import type { HumanAgentRequestDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { resetAnsweredAgentRequestsForTests } from '../../lib/answered-agent-requests.ts';

import { AnswerDeliveryStatus, QuestionAnswerForm } from './QuestionAnswerForm.tsx';

const originalFetch = globalThis.fetch;
type Call = { path: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[] = [];
let respond: (call: Call) =>
  | { status: number; payload: unknown }
  | Promise<{
      status: number;
      payload: unknown;
    }>;

function openRequest(overrides: Partial<HumanAgentRequestDto> = {}): HumanAgentRequestDto {
  return {
    id: 'request-1',
    channelId: 'channel-1',
    missionId: 'mission-1',
    objectiveId: 'objective-1',
    kind: 'question',
    summary: 'Which database?',
    options: [],
    allowsFreeText: true,
    status: 'open',
    resolution: null,
    revision: 1,
    windowExpiresAt: null,
    releasedReason: null,
    applicationState: 'emitted',
    delivery: { mode: 'latch', reason: null, state: null, observedAt: null, stage: null },
    resolvedAt: null,
    createdAt: '2026-11-16T12:00:00.000Z',
    ...overrides
  };
}

function resolvedRequest(
  delivery: Partial<HumanAgentRequestDto['delivery']>,
  overrides: Partial<HumanAgentRequestDto> = {}
): HumanAgentRequestDto {
  return openRequest({
    status: 'resolved',
    revision: 2,
    resolution: { text: 'Postgres' },
    resolvedAt: '2026-11-16T12:01:00.000Z',
    delivery: {
      mode: 'read_only',
      reason: 'request_closed',
      state: 'emitted',
      observedAt: null,
      stage: 'queued',
      attempt: 1,
      failureCode: null,
      failureMessage: null,
      canRedeliver: false,
      confirmationRequired: false,
      sessionState: 'running',
      ...delivery
    },
    ...overrides
  });
}

function json(status: number, payload: unknown) {
  return { status, payload };
}

beforeEach(() => {
  calls = [];
  resetAnsweredAgentRequestsForTests();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      path: new URL(String(input), 'http://localhost').pathname,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    };
    calls.push(call);
    const { status, payload } = await respond(call);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const writes = () => calls.filter(call => call.method === 'POST');

describe('QuestionAnswerForm', () => {
  it('reports the delivery stage instead of success, and sends the answer once', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => (release = resolve));
    respond = async call => {
      if (call.path.endsWith('/resolve')) {
        await gate;
        return json(200, {
          resolved: true,
          request: resolvedRequest({ stage: 'dispatched' })
        });
      }
      return json(200, { requests: [] });
    };
    renderWithClient(<QuestionAnswerForm request={openRequest()} />);
    fireEvent.change(screen.getByLabelText('Answer the agent'), {
      target: { value: '  Postgres  ' }
    });
    const reply = screen.getByRole('button', { name: 'Reply' });
    fireEvent.click(reply);
    fireEvent.click(reply);
    fireEvent.submit(reply.closest('form') as HTMLFormElement);
    await screen.findByText(/Saving your answer/);
    release();
    await screen.findByText(/Waiting for the agent to confirm/);
    assert.equal(screen.queryByText(/Delivered/), null);
    assert.equal(writes().length, 1, 'one resolve however many clicks');
    assert.deepEqual(writes()[0]?.body, {
      resolution: { text: 'Postgres' },
      expectedRevision: 1
    });
  });

  it('keeps the draft and names the cause when the session cannot receive an answer', async () => {
    respond = call =>
      call.path.endsWith('/resolve')
        ? json(409, {
            error:
              'The execution machine is offline. Bring its runner back online, then send the answer again.',
            code: 'request_not_deliverable'
          })
        : json(200, { requests: [] });
    renderWithClient(<QuestionAnswerForm request={openRequest()} />);
    const input = screen.getByLabelText('Answer the agent') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Postgres' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    const alert = await screen.findByRole('alert');
    assert.match(alert.textContent ?? '', /offline/);
    assert.match(alert.textContent ?? '', /not recorded/);
    assert.doesNotMatch(alert.textContent ?? '', /Someone answered/);
    assert.equal(input.value, 'Postgres', 'the draft survives a refusal');
  });

  it('keeps a draft when the machine goes offline while the person is typing', () => {
    respond = () => json(200, { requests: [] });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity }
      }
    });
    const view = render(
      <QueryClientProvider client={client}>
        <QuestionAnswerForm request={openRequest()} />
      </QueryClientProvider>
    );
    fireEvent.change(screen.getByLabelText('Answer the agent'), {
      target: { value: 'Use port 5432' }
    });
    const offline = openRequest({
      delivery: { mode: 'read_only', reason: 'target_offline', state: null, observedAt: null }
    });
    view.rerender(
      <QueryClientProvider client={client}>
        <QuestionAnswerForm request={offline} />
      </QueryClientProvider>
    );
    assert.ok(screen.getByText(/offline\. Bring its runner back online/));
    assert.ok(screen.getByText(/Your draft is kept/));
    view.rerender(
      <QueryClientProvider client={client}>
        <QuestionAnswerForm request={openRequest()} />
      </QueryClientProvider>
    );
    assert.equal(
      (screen.getByLabelText('Answer the agent') as HTMLInputElement).value,
      'Use port 5432'
    );
    assert.equal(writes().length, 0);
  });

  it('clears an offline refusal once the question is answerable again, keeping the draft', async () => {
    respond = call =>
      call.path.endsWith('/resolve')
        ? json(409, {
            error: 'This request cannot be delivered to its agent session',
            code: 'request_not_deliverable'
          })
        : json(200, { requests: [] });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity }
      }
    });
    const wrap = (request: HumanAgentRequestDto) => (
      <QueryClientProvider client={client}>
        <QuestionAnswerForm request={request} />
      </QueryClientProvider>
    );
    const view = render(wrap(openRequest()));
    fireEvent.change(screen.getByLabelText('Answer the agent'), {
      target: { value: 'Use port 5432' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await screen.findByText(/not recorded/);
    view.rerender(
      wrap(
        openRequest({
          delivery: { mode: 'read_only', reason: 'target_offline', state: null, observedAt: null }
        })
      )
    );
    view.rerender(wrap(openRequest()));
    await waitFor(() => assert.equal(screen.queryByText(/not recorded/), null));
    assert.equal(
      (screen.getByLabelText('Answer the agent') as HTMLInputElement).value,
      'Use port 5432'
    );
  });

  it('shows a lost race when another person answered first', async () => {
    respond = call =>
      call.path.endsWith('/resolve')
        ? json(200, { resolved: false, request: resolvedRequest({ stage: 'confirmed' }) })
        : json(200, { requests: [] });
    renderWithClient(<QuestionAnswerForm request={openRequest()} />);
    fireEvent.change(screen.getByLabelText('Answer the agent'), {
      target: { value: 'MySQL' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await screen.findByText(/Someone answered this first/);
    assert.equal((screen.getByLabelText('Answer the agent') as HTMLInputElement).value, 'MySQL');
  });

  it('answers a structured choice with its option id', async () => {
    respond = call =>
      call.path.endsWith('/resolve')
        ? json(200, {
            resolved: true,
            request: resolvedRequest(
              { stage: 'confirmed', state: 'applied' },
              {
                kind: 'choice',
                resolution: { optionId: 'b' },
                options: [
                  { optionId: 'a', label: 'Alpha', kind: 'choice' },
                  { optionId: 'b', label: 'Beta', kind: 'choice' }
                ]
              }
            )
          })
        : json(200, { requests: [] });
    renderWithClient(
      <QuestionAnswerForm
        allowText={false}
        request={openRequest({
          kind: 'choice',
          allowsFreeText: false,
          options: [
            { optionId: 'a', label: 'Alpha', kind: 'choice' },
            { optionId: 'b', label: 'Beta', kind: 'choice' }
          ]
        })}
      />
    );
    assert.equal(screen.queryByLabelText('Answer the agent'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    await screen.findByText('Delivered to the agent.');
    assert.deepEqual(writes()[0]?.body, { resolution: { optionId: 'b' }, expectedRevision: 1 });
    assert.match(document.body.textContent ?? '', /Your answer: Beta/);
  });
});

describe('AnswerDeliveryStatus', () => {
  it('offers Send again after a definitive failure, guarded by the attempt', async () => {
    respond = call =>
      call.path.endsWith('/redeliver')
        ? json(200, {
            redelivered: true,
            request: resolvedRequest(
              { stage: 'confirmed', state: 'applied', attempt: 2 },
              { revision: 3 }
            )
          })
        : json(200, { requests: [] });
    renderWithClient(
      <AnswerDeliveryStatus
        request={resolvedRequest({
          stage: 'failed',
          state: 'not_applied',
          failureCode: 'gateway_unavailable',
          failureMessage: 'The Latch gateway is not answering.',
          canRedeliver: true
        })}
      />
    );
    assert.ok(screen.getByText(/did not reach the agent/));
    assert.ok(screen.getByText('The Latch gateway is not answering.'));
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await screen.findByText('Delivered to the agent.');
    assert.deepEqual(writes()[0]?.body, { expectedAttempt: 1 });
  });

  it('never resends an unconfirmed answer without an explicit confirmation', async () => {
    respond = call =>
      call.path.endsWith('/redeliver')
        ? json(200, {
            redelivered: true,
            request: resolvedRequest(
              { stage: 'confirmed', state: 'applied', attempt: 2 },
              { revision: 3 }
            )
          })
        : json(200, { requests: [] });
    renderWithClient(
      <AnswerDeliveryStatus
        request={resolvedRequest({
          stage: 'unconfirmed',
          state: 'unknown',
          canRedeliver: true,
          confirmationRequired: true
        })}
      />
    );
    assert.ok(screen.getByText(/may have arrived/));
    assert.equal(screen.queryByRole('button', { name: 'Send again' }), null);
    fireEvent.click(screen.getByRole('button', { name: /Check and send again/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    assert.equal(writes().length, 0);
    fireEvent.click(screen.getByRole('button', { name: /Check and send again/ }));
    fireEvent.click(screen.getByRole('button', { name: /did not arrive/ }));
    await screen.findByText('Delivered to the agent.');
    assert.deepEqual(writes()[0]?.body, { expectedAttempt: 1, confirmUnconfirmed: true });
  });

  it('reports a concurrent redelivery instead of sending twice', async () => {
    respond = call =>
      call.path.endsWith('/redeliver')
        ? json(409, {
            error: 'Delivery changed since it was read',
            code: 'agent_request_delivery_conflict'
          })
        : json(200, { requests: [] });
    renderWithClient(
      <AnswerDeliveryStatus request={resolvedRequest({ stage: 'failed', canRedeliver: true })} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    const alert = await screen.findByRole('alert');
    assert.match(alert.textContent ?? '', /already being sent/);
    await waitFor(() => assert.equal(writes().length, 1));
  });

  it('explains an ended session and offers no resend', () => {
    respond = () => json(200, { requests: [] });
    renderWithClient(
      <AnswerDeliveryStatus
        request={resolvedRequest({
          stage: 'failed',
          failureCode: 'session_ended',
          canRedeliver: false,
          sessionState: 'exited'
        })}
      />
    );
    assert.ok(screen.getByText(/terminal session has ended/));
    assert.equal(screen.queryByRole('button'), null);
  });

  it('states an ended session once when the server already explained it', () => {
    respond = () => json(200, { requests: [] });
    renderWithClient(
      <AnswerDeliveryStatus
        request={resolvedRequest({
          stage: 'failed',
          failureCode: 'session_ended',
          failureMessage:
            'The terminal session has ended, so it cannot receive an answer. Restart the objective to continue.',
          canRedeliver: false,
          sessionState: 'exited'
        })}
      />
    );
    assert.equal(screen.getAllByText(/terminal session has ended/).length, 1);
    assert.equal(screen.queryByRole('button'), null);
  });
});
