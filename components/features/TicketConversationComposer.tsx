'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { findOpenBlockingQuestions } from '@/lib/overlord/conversation';
import type { Database } from '@/types/database.types';

import { useTerminal } from './terminal/TerminalProvider';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

type Props = {
  ticketId: string;
  events: TicketEvent[];
  workingDirectory?: string | null;
};

async function postConversationEntry(
  ticketId: string,
  input: {
    entryType: 'answer' | 'follow_up';
    message: string;
    parentEventId?: string;
  }
) {
  const response = await fetch(`/api/tickets/${ticketId}/conversation`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  });

  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? 'Failed to save message.');
  }
}

export function TicketConversationComposer({ ticketId, events, workingDirectory }: Props) {
  const { isElectron, sendCommand } = useTerminal();
  const [mirrorToTerminal, setMirrorToTerminal] = useState(true);
  const [followUpDraft, setFollowUpDraft] = useState('');
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openQuestions = useMemo(() => findOpenBlockingQuestions(events), [events]);

  async function submitFollowUp() {
    const message = followUpDraft.trim();
    if (!message) return;

    setErrorMessage(null);
    setActiveKey('follow_up');
    try {
      await postConversationEntry(ticketId, {
        entryType: 'follow_up',
        message
      });
      if (mirrorToTerminal && isElectron) {
        await sendCommand(message, { cwd: workingDirectory ?? undefined });
      }
      setFollowUpDraft('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send follow-up.');
    } finally {
      setActiveKey(null);
    }
  }

  async function submitAnswer(questionId: string) {
    const message = (answerDrafts[questionId] ?? '').trim();
    if (!message) return;

    setErrorMessage(null);
    setActiveKey(questionId);
    try {
      await postConversationEntry(ticketId, {
        entryType: 'answer',
        message,
        parentEventId: questionId
      });
      if (mirrorToTerminal && isElectron) {
        await sendCommand(message, { cwd: workingDirectory ?? undefined });
      }
      setAnswerDrafts(prev => ({ ...prev, [questionId]: '' }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to send answer.');
    } finally {
      setActiveKey(null);
    }
  }

  return (
    <section className="mb-6 rounded-lg border bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Agent Conversation
        </h3>
        <label className="text-xs text-muted-foreground">
          <input
            checked={mirrorToTerminal}
            className="mr-1 align-middle"
            disabled={!isElectron}
            type="checkbox"
            onChange={event => setMirrorToTerminal(event.target.checked)}
          />
          Mirror to terminal
        </label>
      </div>

      {openQuestions.length > 0 ? (
        <div className="mb-4 grid gap-3">
          {openQuestions.map(question => (
            <article className="rounded-md border bg-background p-3" key={question.id}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Blocking question</p>
              <p className="mb-2 text-sm">{question.summary ?? 'No question text.'}</p>
              <Textarea
                className="mb-2 min-h-20"
                placeholder="Type your answer..."
                value={answerDrafts[question.id] ?? ''}
                onChange={event =>
                  setAnswerDrafts(prev => ({ ...prev, [question.id]: event.target.value }))
                }
              />
              <Button
                disabled={activeKey !== null}
                size="sm"
                variant="default"
                onClick={() => submitAnswer(question.id)}
              >
                {activeKey === question.id ? 'Sending...' : 'Send answer'}
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <p className="mb-4 text-xs text-muted-foreground">No open blocking questions.</p>
      )}

      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Follow-up prompt</p>
        <Textarea
          className="mb-2 min-h-20"
          placeholder="Add a follow-up instruction for the running agent..."
          value={followUpDraft}
          onChange={event => setFollowUpDraft(event.target.value)}
        />
        <Button disabled={activeKey !== null} size="sm" variant="outline" onClick={submitFollowUp}>
          {activeKey === 'follow_up' ? 'Sending...' : 'Send follow-up'}
        </Button>
      </div>

      {errorMessage ? <p className="mt-3 text-xs text-destructive">{errorMessage}</p> : null}
    </section>
  );
}
