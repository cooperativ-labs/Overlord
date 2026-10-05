import type { ChatProposalDto } from '@overlord/contract';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { api } from '@/lib/api.ts';
import { ApiRequestError } from '@/lib/api/request.ts';
import { proposal } from '@/lib/chat/chat-fixtures.ts';

import { ChatProposalCard, proposalCardMode } from './ChatProposalCard.tsx';

const originalCreate = api.createFromChatProposal;
afterEach(() => {
  cleanup();
  api.createFromChatProposal = originalCreate;
});

function renderCard(value: ChatProposalDto, blockRevision: number, scope = 'scope-a') {
  const merged: unknown[] = [];
  let resyncs = 0;
  render(
    <ChatProposalCard
      proposal={value}
      blockRevision={blockRevision}
      scope={scope}
      merge={update => void merged.push(update)}
      onResync={() => void (resyncs += 1)}
    />
  );
  return { merged, resyncs: () => resyncs };
}

describe('proposal card mode', () => {
  it('offers Create only for the current, valid, open revision', () => {
    assert.equal(proposalCardMode(proposal(), 1), 'creatable');
    assert.equal(proposalCardMode(proposal({}, 2), 1), 'superseded');
    const invalid = proposal();
    invalid.current.invalidated = true;
    assert.equal(proposalCardMode(invalid, 1), 'invalidated');
    assert.equal(proposalCardMode(proposal({ state: 'cancelled' }), 1), 'cancelled');
    const receipt = { id: 'r', proposalId: 'p-1', revision: 2, missions: [], createdAt: '' };
    assert.equal(proposalCardMode(proposal({ state: 'created', receipt }, 2), 2), 'created');
    assert.equal(proposalCardMode(proposal({ state: 'created', receipt }, 2), 1), 'superseded');
  });
});

describe('ChatProposalCard', () => {
  it('shows the frozen assignment and its source', () => {
    renderCard(proposal(), 1);
    assert.ok(screen.getByText('claude-code · opus · high'));
    assert.ok(screen.getByText(/project default/));
  });

  it('renders an older block as superseded without a Create button', () => {
    renderCard(proposal({}, 3), 2);
    assert.ok(screen.getByText(/revision 2 was replaced by revision 3/));
    assert.equal(screen.queryByRole('button', { name: /Create/ }), null);
  });

  it('disables Create for an invalidated revision', () => {
    const invalid = proposal();
    invalid.current.invalidated = true;
    renderCard(invalid, 1);
    const button = screen.getByRole('button', { name: /Create drafts/ }) as HTMLButtonElement;
    assert.equal(button.disabled, true);
  });

  it('retries a lost Create with the same request id and merges the receipt', async () => {
    const ids: string[] = [];
    let attempt = 0;
    api.createFromChatProposal = async (_id, body) => {
      ids.push(body.clientRequestId);
      assert.equal(body.expectedRevision, 1);
      attempt += 1;
      if (attempt === 1) throw new TypeError('Failed to fetch');
      const receipt = { id: 'r-1', proposalId: 'p-1', revision: 1, missions: [], createdAt: '' };
      return { proposal: proposal({ state: 'created', receipt }), receipt, replayed: true };
    };
    const { merged } = renderCard(proposal(), 1, 'scope-retry');
    fireEvent.click(screen.getByRole('button', { name: /Create drafts/ }));
    await waitFor(() => assert.ok(screen.getByRole('button', { name: /Retry Create/ })));
    fireEvent.click(screen.getByRole('button', { name: /Retry Create/ }));
    await waitFor(() => assert.equal(merged.length, 1));
    assert.equal(ids.length, 2);
    assert.equal(ids[0], ids[1]);
    const update = merged[0] as { proposal: ChatProposalDto };
    assert.equal(update.proposal.receipt?.id, 'r-1');
  });

  it('resynchronizes on a stale revision', async () => {
    api.createFromChatProposal = async () => {
      throw new ApiRequestError('stale', 409, 'stale_revision');
    };
    const { resyncs } = renderCard(proposal(), 1, 'scope-stale');
    fireEvent.click(screen.getByRole('button', { name: /Create drafts/ }));
    await waitFor(() => assert.equal(resyncs(), 1));
    assert.ok(screen.getByRole('alert'));
  });
});
