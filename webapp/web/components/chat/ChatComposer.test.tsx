import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { useState } from 'react';

import {
  cancelEditing,
  type ChatMessageQueue,
  EMPTY_QUEUE,
  enqueue,
  removeQueued,
  saveEdit,
  startEditing
} from '@/lib/chat/message-queue.ts';

import { ChatComposer, type ComposerQueue } from './ChatComposer.tsx';

afterEach(cleanup);

function Harness({
  mode,
  initial = EMPTY_QUEUE,
  sent
}: {
  mode: 'send' | 'answer' | 'busy';
  initial?: ChatMessageQueue;
  sent: string[];
}) {
  const [state, setState] = useState(initial);
  const queue: ComposerQueue = {
    state,
    onQueue: (text, knowledgebaseWrite) =>
      setState(q => enqueue(q, { id: globalThis.crypto.randomUUID(), text, knowledgebaseWrite })),
    onEdit: id => setState(q => startEditing(q, id)),
    onCancelEdit: () => setState(cancelEditing),
    onSave: (id, text) => setState(q => saveEdit(q, id, text)),
    onRemove: id => setState(q => removeQueued(q, id)),
    onResume: () => undefined
  };
  return (
    <ChatComposer
      mode={mode}
      queue={queue}
      onSubmit={async text => {
        sent.push(text);
        return true;
      }}
    />
  );
}

function type(text: string) {
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input as HTMLTextAreaElement;
}

describe('ChatComposer queue', () => {
  it('queues instead of blocking while the assistant is busy', () => {
    const sent: string[] = [];
    render(<Harness mode="busy" sent={sent} />);
    const input = type('first follow-up');
    type('second follow-up');
    assert.equal(input.value, '');
    assert.deepEqual(sent, []);
    const list = screen.getByRole('region', { name: 'Queued messages' });
    assert.ok(list.textContent?.includes('first follow-up'));
    assert.ok(
      list.textContent!.indexOf('first follow-up') < list.textContent!.indexOf('second follow-up')
    );
    assert.ok(screen.getByRole('button', { name: 'Queue message' }));
  });

  it('sends directly when idle with nothing queued', async () => {
    const sent: string[] = [];
    render(<Harness mode="send" sent={sent} />);
    type('hello');
    await Promise.resolve();
    assert.deepEqual(sent, ['hello']);
    assert.equal(screen.queryByRole('region', { name: 'Queued messages' }), null);
  });

  it('answers an open question directly even with messages queued', async () => {
    const sent: string[] = [];
    const initial = enqueue(EMPTY_QUEUE, { id: 'q1', text: 'later', knowledgebaseWrite: null });
    render(<Harness mode="answer" initial={initial} sent={sent} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), {
      target: { value: 'yes' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await Promise.resolve();
    assert.deepEqual(sent, ['yes']);
  });

  it('edits and removes queued messages', () => {
    const sent: string[] = [];
    render(<Harness mode="busy" sent={sent} />);
    type('draft one');
    type('draft two');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit queued message' })[0]!);
    const editor = screen.getByRole('textbox', { name: 'Edit queued message' });
    fireEvent.change(editor, { target: { value: 'draft one, revised' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const list = screen.getByRole('region', { name: 'Queued messages' });
    assert.ok(list.textContent?.includes('draft one, revised'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove queued message' })[1]!);
    assert.ok(!list.textContent?.includes('draft two'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued message' }));
    assert.equal(screen.queryByRole('region', { name: 'Queued messages' }), null);
    assert.deepEqual(sent, []);
  });
});
