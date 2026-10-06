import type { ChatKnowledgebaseWriteDto } from '@overlord/contract';
import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import type { KnowledgebaseWriteTarget } from '@/lib/chat/knowledgebase-writes.ts';

/**
 * Docked composer modelled on the mobile compose screen. `send` starts a run,
 * `answer` answers the open question (typing and tapping an option are the same
 * action), and `busy` blocks input while a run is queued or running. The parent
 * owns submission so request ids survive retries. When the caller has a writable
 * Knowledgebase workspace, a per-message control lets them allow note edits for
 * that request only (contract v154); it resets to read only after each send. When a
 * connection already allows edits in every authorized workspace (v158), the composer
 * says so instead of asking per message.
 */
export function ChatComposer({
  mode,
  disabled,
  error,
  onSubmit,
  autoFocus,
  writeTargets = [],
  editsEverywhere = false
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
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [writeKey, setWriteKey] = useState('');
  const blocked = disabled || pending || mode === 'busy';
  const target = writeTargets.find(t => t.key === writeKey) ?? null;

  const submit = async () => {
    const value = text.trim();
    if (!value || blocked) return;
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
      <div className="flex items-end gap-2 rounded-2xl border bg-(--color-card) p-2 shadow-sm">
        <Textarea
          value={text}
          onChange={event => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            mode === 'answer'
              ? 'Answer the question…'
              : mode === 'busy'
                ? 'The assistant is working…'
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
          aria-label={mode === 'answer' ? 'Send answer' : 'Send'}
          disabled={blocked || !text.trim()}
          onClick={() => void submit()}
        >
          <ArrowUp />
        </Button>
      </div>
      {writeTargets.length > 0 && mode !== 'busy' ? (
        <label className="flex items-center gap-2 px-2 text-xs text-(--color-ink-dim)">
          <span>Knowledgebase</span>
          <select
            value={writeKey}
            onChange={event => setWriteKey(event.target.value)}
            disabled={blocked}
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
      {editsEverywhere && mode !== 'busy' ? (
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
