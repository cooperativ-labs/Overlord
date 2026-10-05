import type { ChatQuestionDto } from '@overlord/contract';
import { HelpCircle } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { api } from '@/lib/api.ts';
import { chatErrorCode, chatErrorMessage, isRetryableChatError } from '@/lib/chat/errors.ts';
import { clearRequestId, stableRequestId } from '@/lib/chat/request-ids.ts';
import type { ChatThreadStream } from '@/lib/chat/thread-stream.ts';

/**
 * Card form of answering the run's open question (revision-checked). Choosing an
 * option and typing text are the same action; the composer below is the other
 * way to answer.
 */
export function ChatQuestionCard({
  question,
  scope,
  merge,
  onResync
}: {
  question: ChatQuestionDto;
  scope: string;
  merge: ChatThreadStream['merge'];
  onResync: () => void;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = `answer:${question.id}:${question.revision}`;

  const answer = async (body: { optionId?: string; text?: string }) => {
    setPending(true);
    setError(null);
    try {
      const result = await api.answerChatQuestion(question.id, {
        clientRequestId: stableRequestId(scope, action),
        expectedRevision: question.revision,
        ...body
      });
      clearRequestId(scope, action);
      merge({
        message: result.message,
        run: result.run,
        question: { ...question, state: 'answered' }
      });
      setText('');
    } catch (cause) {
      if (!isRetryableChatError(cause)) clearRequestId(scope, action);
      if (chatErrorCode(cause) === 'stale_revision') onResync();
      setError(chatErrorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-2 rounded-xl border border-amber-400/50 bg-amber-500/8 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
        <HelpCircle className="size-4" />
        Question
      </div>
      <p className="text-sm whitespace-pre-wrap">{question.prompt}</p>
      {question.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {question.options.map(option => (
            <Button
              key={option.id}
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void answer({ optionId: option.id, text: option.label })}
            >
              {option.label}
            </Button>
          ))}
        </div>
      ) : null}
      {question.allowFreeText ? (
        <form
          className="grid gap-2"
          onSubmit={event => {
            event.preventDefault();
            if (text.trim()) void answer({ text: text.trim() });
          }}
        >
          <Textarea
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder="Type an answer…"
            rows={2}
            disabled={pending}
            aria-label="Answer"
          />
          <div>
            <Button type="submit" size="sm" disabled={pending || !text.trim()}>
              Reply
            </Button>
          </div>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
