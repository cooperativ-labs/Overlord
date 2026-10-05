import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';

/**
 * Docked composer modelled on the mobile compose screen. `send` starts a run,
 * `answer` answers the open question (typing and tapping an option are the same
 * action), and `busy` blocks input while a run is queued or running. The parent
 * owns submission so request ids survive retries.
 */
export function ChatComposer({
  mode,
  disabled,
  error,
  onSubmit,
  autoFocus
}: {
  mode: 'send' | 'answer' | 'busy';
  disabled?: boolean;
  error?: string | null;
  /** Resolves true when the server accepted the message, so the draft can clear. */
  onSubmit: (text: string) => Promise<boolean>;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const blocked = disabled || pending || mode === 'busy';

  const submit = async () => {
    const value = text.trim();
    if (!value || blocked) return;
    setPending(true);
    try {
      if (await onSubmit(value)) setText('');
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
      {error ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
