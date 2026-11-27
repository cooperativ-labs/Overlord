import type { ChatKnowledgebaseWriteDto } from '@overlord/contract';
import { ArrowUp, ListPlus, Loader2, Pencil, X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import type { KnowledgebaseWriteTarget } from '@/lib/chat/knowledgebase-writes.ts';
import type { ChatMessageQueue, QueuedChatMessage } from '@/lib/chat/message-queue.ts';

/** The thread's message queue and the actions the composer offers on it. */
export interface ComposerQueue {
  state: ChatMessageQueue;
  onQueue: (text: string, knowledgebaseWrite: ChatKnowledgebaseWriteDto | null) => void;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSave: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onResume: () => void;
}

/**
 * Docked composer modelled on the mobile compose screen. `send` starts a run,
 * `answer` answers the open question (typing and tapping an option are the same
 * action), and `busy` blocks input while a run is queued or running. The parent
 * owns submission so request ids survive retries. When the caller has a writable
 * Knowledgebase workspace, a per-message control lets them allow note edits for
 * that request only (contract v154); it resets to read only after each send. When a
 * connection already allows edits in every authorized workspace (v158), the composer
 * says so instead of asking per message.
 *
 * With a `queue`, a message written while the assistant is busy (or while earlier
 * queued messages are still waiting) is queued instead of blocked; queued messages
 * are listed above the input, where they can be edited or removed before the
 * thread sends them in order.
 */
export function ChatComposer({
  mode,
  disabled,
  error,
  onSubmit,
  autoFocus,
  writeTargets = [],
  editsEverywhere = false,
  queue
}: {
  mode: 'send' | 'answer' | 'busy';
  disabled?: boolean;
  error?: string | null;
  /** Resolves true when the server accepted the message, so the draft can clear. */
  onSubmit: (
    text: string,
    knowledgebaseWrite: ChatKnowledgebaseWriteDto | null
  ) => Promise<boolean>;
  autoFocus?: boolean;
  /** Knowledgebase workspaces the user may allow the assistant to edit for one request. */
  writeTargets?: readonly KnowledgebaseWriteTarget[];
  /** A connection lets the assistant edit every authorized workspace (Connected accounts). */
  editsEverywhere?: boolean;
  queue?: ComposerQueue;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [writeKey, setWriteKey] = useState('');
  const blocked = disabled || pending || mode === 'busy';
  const target = writeTargets.find(t => t.key === writeKey) ?? null;
  const queued = queue?.state.items ?? [];
  // Answers go straight to the open question; everything else waits its turn.
  const queueing =
    Boolean(queue) &&
    !disabled &&
    (mode === 'busy' || pending || (mode === 'send' && queued.length > 0));

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    if (queueing && queue) {
      queue.onQueue(value, target?.grant ?? null);
      setText('');
      setWriteKey('');
      return;
    }
    if (blocked) return;
    setPending(true);
    try {
      if (await onSubmit(value, target?.grant ?? null)) {
        setText('');
        setWriteKey(''); // Edits are allowed per request, never sticky.
      }
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="grid gap-1.5">
      {queue && queued.length > 0 ? <QueuedMessages queue={queue} /> : null}
      <div className="flex items-end gap-2 rounded-2xl border bg-(--color-card) p-2 shadow-sm">
        <Textarea
          value={text}
          onChange={event => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            mode === 'answer'
              ? 'Answer the question…'
              : mode === 'busy'
                ? queue
                  ? 'The assistant is working… queue a follow-up'
                  : 'The assistant is working…'
                : 'Describe what you want to build or ask about…'
          }
          rows={2}
          autoFocus={autoFocus}
          aria-label={mode === 'answer' ? 'Answer' : 'Message'}
          className="min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button
          size="icon"
          className="rounded-full"
          aria-label={queueing ? 'Queue message' : mode === 'answer' ? 'Send answer' : 'Send'}
          title={queueing ? 'Queue message' : undefined}
          disabled={(!queueing && blocked) || !text.trim()}
          onClick={() => void submit()}
        >
          {queueing ? <ListPlus /> : <ArrowUp />}
        </Button>
      </div>
      {writeTargets.length > 0 && (mode !== 'busy' || queueing) ? (
        <label className="flex items-center gap-2 px-2 text-xs text-(--color-ink-dim)">
          <span>Knowledgebase</span>
          <select
            value={writeKey}
            onChange={event => setWriteKey(event.target.value)}
            disabled={blocked && !queueing}
            aria-label="Knowledgebase access for this message"
            className="rounded-md border bg-transparent px-1.5 py-0.5 text-xs"
          >
            <option value="">Read only</option>
            {writeTargets.map(t => (
              <option key={t.key} value={t.key}>
                Allow edits in {t.label}
              </option>
            ))}
          </select>
          {target ? <span>for this request only</span> : null}
        </label>
      ) : null}
      {editsEverywhere && (mode !== 'busy' || queueing) ? (
        <p className="px-2 text-xs text-(--color-ink-dim)">
          Knowledgebase: the assistant may edit notes in all authorized workspaces.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function QueuedMessages({ queue }: { queue: ComposerQueue }) {
  const { items, paused } = queue.state;
  return (
    <section
      aria-label="Queued messages"
      className="grid gap-1 rounded-xl border bg-(--color-bg-muted) p-2"
    >
      <div className="flex items-center gap-2 px-1 text-xs text-(--color-ink-dim)">
        <span className="font-medium">Queued</span>
        <span>
          {paused === 'stopped'
            ? '· paused because the run was stopped'
            : paused === 'failed'
              ? '· paused after a send failed'
              : '· sent in order when the assistant is free'}
        </span>
        {paused ? (
          <Button size="xs" variant="outline" className="ml-auto" onClick={queue.onResume}>
            Resume
          </Button>
        ) : null}
      </div>
      <ol className="grid gap-1">
        {items.map(item => (
          <QueuedRow key={item.id} item={item} queue={queue} />
        ))}
      </ol>
    </section>
  );
}

function QueuedRow({ item, queue }: { item: QueuedChatMessage; queue: ComposerQueue }) {
  const sending = queue.state.sendingId === item.id;
  const editing = queue.state.editingId === item.id;
  const [draft, setDraft] = useState(item.text);

  if (editing) {
    const save = () => queue.onSave(item.id, draft);
    return (
      <li className="grid gap-1 rounded-lg bg-(--color-card) p-1.5">
        <Textarea
          value={draft}
          autoFocus
          rows={2}
          aria-label="Edit queued message"
          className="min-h-9 resize-none text-sm"
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              queue.onCancelEdit();
            } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              save();
            }
          }}
        />
        <div className="flex justify-end gap-1">
          <Button size="xs" variant="ghost" onClick={queue.onCancelEdit}>
            Cancel
          </Button>
          <Button size="xs" onClick={save}>
            Save
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 rounded-lg bg-(--color-card) px-2 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3 whitespace-pre-wrap break-words">{item.text}</p>
        {item.knowledgebaseWrite ? (
          <p className="text-xs text-(--color-ink-dim)">
            May edit notes in {item.knowledgebaseWrite.workspace}
          </p>
        ) : null}
      </div>
      {sending ? (
        <span className="flex items-center gap-1 text-xs text-(--color-ink-dim)">
          <Loader2 className="size-3 animate-spin" /> Sending…
        </span>
      ) : (
        <div className="flex flex-none gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Edit queued message"
            onClick={() => {
              setDraft(item.text);
              queue.onEdit(item.id);
            }}
          >
            <Pencil />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Remove queued message"
            onClick={() => queue.onRemove(item.id)}
          >
            <X />
          </Button>
        </div>
      )}
    </li>
  );
}
