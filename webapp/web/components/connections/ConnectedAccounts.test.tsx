import type {
  AccountConnectionListResponse,
  SetAccountConnectionApiKeyBody,
  StartAccountConnectionBody
} from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { api } from '@/lib/api.ts';
import { ApiRequestError } from '@/lib/api/request.ts';
import { connectionFixture, statusFixture } from '@/lib/connections-fixtures.ts';

import { ConnectedAccounts } from './ConnectedAccounts.tsx';

const original = {
  list: api.listAllAccountConnections,
  start: api.startAccountConnection,
  setKey: api.setAccountConnectionApiKey,
  disconnect: api.disconnectAccountConnection
};
const originalAssign = window.location.assign;
let client: QueryClient | null = null;

afterEach(() => {
  cleanup();
  client?.clear();
  client = null;
  api.listAllAccountConnections = original.list;
  api.startAccountConnection = original.start;
  api.setAccountConnectionApiKey = original.setKey;
  api.disconnectAccountConnection = original.disconnect;
  window.location.assign = originalAssign;
});

const LIST: AccountConnectionListResponse = {
  items: [
    connectionFixture({
      id: 'kb-1',
      provider: 'knowledgebase',
      scope: 'organization',
      organizationId: 'org-1',
      credentialKind: 'oauth',
      account: null,
      serverUrl: 'https://knowledge.chaselubitz.com/mcp',
      authorizedWorkspaces: ['main']
    }),
    connectionFixture({
      id: 'gh-1',
      provider: 'github',
      credentialKind: 'oauth',
      account: { id: '9', label: 'octo', avatarUrl: null },
      state: 'reauthorization_required',
      lastErrorCode: 'upstream_unauthorized'
    })
  ],
  providers: [
    statusFixture(),
    statusFixture({ provider: 'github', credentialKind: 'oauth' }),
    statusFixture({ provider: 'knowledgebase', scope: 'organization', credentialKind: 'oauth' })
  ]
};

function renderPage(list: AccountConnectionListResponse = LIST, focus?: 'everhour') {
  let current = list;
  api.listAllAccountConnections = async () => current;
  // gcTime: Infinity schedules no garbage-collection timers that would keep the runner alive.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <ConnectedAccounts focusProvider={focus} />
    </QueryClientProvider>
  );
  return { setList: (next: AccountConnectionListResponse) => void (current = next) };
}

async function row(provider: string): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement>(`[data-provider="${provider}"]`);
    assert.ok(element, `row ${provider}`);
    return element;
  });
}

describe('ConnectedAccounts', () => {
  it('shows every provider with the same status and actions', async () => {
    renderPage();
    const kb = within(await row('knowledgebase'));
    assert.ok(kb.getByText('Connected'));
    assert.ok(kb.getByText('Workspaces: main · knowledge.chaselubitz.com'));
    assert.ok(kb.getByRole('button', { name: 'Reconnect' }));
    assert.ok(kb.getByRole('button', { name: 'Disconnect' }));

    const gh = within(await row('github'));
    assert.ok(gh.getByText('Needs reconnecting'));
    assert.ok(gh.getByRole('button', { name: 'Reconnect' }));
    assert.ok(gh.getByRole('button', { name: 'Disconnect' }));

    const eh = within(await row('everhour'));
    assert.ok(eh.getByText('Not connected'));
    assert.ok(eh.getByRole('button', { name: 'Connect' }));
    assert.equal(eh.queryByRole('button', { name: 'Disconnect' }), null);

    const order = [...document.querySelectorAll('[data-provider]')].map(element =>
      element.getAttribute('data-provider')
    );
    assert.deepEqual(order, ['knowledgebase', 'github', 'everhour']);
  });

  it('saves an Everhour key once, shows a rejection inline, and never echoes the key', async () => {
    const calls: SetAccountConnectionApiKeyBody[] = [];
    api.setAccountConnectionApiKey = async body => {
      calls.push(body);
      if (body.apiKey === 'bad-key')
        throw new ApiRequestError('rejected', 422, 'credential_rejected');
      return connectionFixture();
    };
    const page = renderPage();
    const eh = within(await row('everhour'));
    fireEvent.click(eh.getByRole('button', { name: 'Connect' }));
    const input = eh.getByLabelText('Everhour API key') as HTMLInputElement;
    assert.equal(input.type, 'password');

    fireEvent.change(input, { target: { value: 'bad-key' } });
    fireEvent.click(eh.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      assert.ok(eh.getByText('Everhour rejected this API key. Check it and try again.'))
    );

    page.setList({ ...LIST, items: [...LIST.items, connectionFixture()] });
    fireEvent.change(input, { target: { value: '  good-key  ' } });
    fireEvent.click(eh.getByRole('button', { name: 'Save' }));
    await waitFor(() => assert.ok(eh.getByText('Connected as Ada')));
    assert.deepEqual(calls.at(-1), { provider: 'everhour', apiKey: 'good-key' });
    assert.equal(document.body.textContent?.includes('good-key'), false);
  });

  it('opens the Everhour key form from the deep link', async () => {
    renderPage(LIST, 'everhour');
    const eh = within(await row('everhour'));
    assert.ok(eh.getByLabelText('Everhour API key'));
  });

  it('starts GitHub sign-in on the web and returns to Connected accounts', async () => {
    const starts: StartAccountConnectionBody[] = [];
    const assigned: string[] = [];
    api.startAccountConnection = async body => {
      starts.push(body);
      return { connectionId: 'gh-1', authorizeUrl: 'https://github.test/authorize', expiresAt: '' };
    };
    window.location.assign = ((url: string) =>
      void assigned.push(url)) as typeof window.location.assign;
    renderPage();
    fireEvent.click(within(await row('github')).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => assert.deepEqual(assigned, ['https://github.test/authorize']));
    assert.deepEqual(starts, [{ provider: 'github', returnTo: 'web' }]);
  });

  it('shows loading, then a retry that recovers from a failed load', async () => {
    let fail = true;
    renderPage();
    api.listAllAccountConnections = async () => {
      if (fail) throw new ApiRequestError('Connected accounts are unavailable.', 503, 'x');
      return LIST;
    };
    // The first render already started with the default list; force the failing path.
    await client!.resetQueries();
    assert.ok(await screen.findByRole('alert'));
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    assert.ok(await row('knowledgebase'));
    assert.equal(screen.queryByRole('alert'), null);
  });

  it('connects Knowledgebase: Connect opens the sign-in page with a busy button', async () => {
    const starts: StartAccountConnectionBody[] = [];
    const assigned: string[] = [];
    let release: () => void = () => {};
    api.startAccountConnection = async body => {
      starts.push(body);
      await new Promise<void>(resolve => (release = resolve));
      return {
        connectionId: 'kb-2',
        authorizeUrl: 'https://knowledge.chaselubitz.com/v1/auth/oauth2/authorize?state=s',
        expiresAt: ''
      };
    };
    window.location.assign = ((url: string) =>
      void assigned.push(url)) as typeof window.location.assign;
    renderPage({ ...LIST, items: LIST.items.filter(item => item.provider !== 'knowledgebase') });
    const kb = within(await row('knowledgebase'));
    assert.ok(kb.getByText('Not connected'));
    fireEvent.click(kb.getByRole('button', { name: 'Connect' }));
    const busy = await kb.findByRole('button', { name: 'Opening Knowledgebase…' });
    assert.equal((busy as HTMLButtonElement).disabled, true);
    release();
    await waitFor(() => assert.equal(assigned.length, 1));
    assert.deepEqual(starts, [{ provider: 'knowledgebase', returnTo: 'web' }]);
    // Still busy while the browser leaves for the provider.
    assert.equal(
      (kb.getByRole('button', { name: 'Opening Knowledgebase…' }) as HTMLButtonElement).disabled,
      true
    );
  });

  it('turns a server that cannot connect Knowledgebase into an actionable message', async () => {
    api.startAccountConnection = async () => {
      throw new ApiRequestError('not ready', 503, 'provider_not_ready');
    };
    renderPage({ ...LIST, items: LIST.items.filter(item => item.provider !== 'knowledgebase') });
    const kb = within(await row('knowledgebase'));
    fireEvent.click(kb.getByRole('button', { name: 'Connect' }));
    const alert = await kb.findByRole('alert');
    assert.match(alert.textContent ?? '', /Ask an administrator/);
    // The row recovers: Connect is offered again.
    assert.equal(
      (kb.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled,
      false
    );
  });

  it('shows a cancelled sign-in as unfinished and offers Connect again', async () => {
    renderPage({
      ...LIST,
      items: [
        connectionFixture({
          id: 'kb-1',
          provider: 'knowledgebase',
          scope: 'organization',
          organizationId: 'org-1',
          credentialKind: 'oauth',
          account: null,
          state: 'pending',
          lastErrorCode: 'authorization_denied'
        })
      ]
    });
    const kb = within(await row('knowledgebase'));
    assert.ok(kb.getByText('Sign-in not finished'));
    assert.ok(kb.getByText('The last sign-in was cancelled, so nothing was connected.'));
    assert.ok(kb.getByRole('button', { name: 'Connect' }));
    assert.equal(kb.queryByRole('button', { name: 'Disconnect' }), null);
  });

  it('never shows a credential, even when the listing carries unexpected fields', async () => {
    renderPage({
      ...LIST,
      items: LIST.items.map(item => ({ ...item, accessToken: 'kb_at_secret' }) as typeof item)
    });
    await row('knowledgebase');
    assert.equal(document.body.textContent?.includes('kb_at_secret'), false);
  });

  it('asks before disconnecting, then disconnects that connection', async () => {
    const removed: string[] = [];
    api.disconnectAccountConnection = async id => {
      removed.push(id);
      return connectionFixture({ id, state: 'disconnected' });
    };
    renderPage();
    fireEvent.click(within(await row('knowledgebase')).getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog');
    assert.ok(within(dialog).getByText('Disconnect Knowledgebase?'));
    assert.deepEqual(removed, []);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => assert.deepEqual(removed, ['kb-1']));
  });

  it('after disconnecting, the reloaded row offers Connect again', async () => {
    api.disconnectAccountConnection = async id => {
      page.setList({ ...LIST, items: LIST.items.filter(item => item.id !== id) });
      return connectionFixture({ id, state: 'disconnected' });
    };
    const page = renderPage();
    fireEvent.click(within(await row('knowledgebase')).getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disconnect' })
    );
    const kb = within(await row('knowledgebase'));
    await waitFor(() => assert.ok(kb.getByText('Not connected')));
    assert.ok(kb.getByRole('button', { name: 'Connect' }));
  });
});
