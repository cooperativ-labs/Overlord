'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { findOpenBlockingQuestions } from '@/lib/overlord/conversation';
import type { Database } from '@/types/database.types';

import { useTerminal } from './terminal/TerminalProvider';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];

type Props = {
  ticketId: string;
  projectId: string;
  events: TicketEvent[];
};

type FileTreeResponse = {
  error?: string;
  files?: string[];
  linkedDirectory?: string | null;
  truncated?: boolean;
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

export function TicketConversationComposer({ ticketId, projectId, events }: Props) {
  const { isElectron } = useTerminal();
  const [followUpDraft, setFollowUpDraft] = useState('');
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [linkedFiles, setLinkedFiles] = useState<string[]>([]);
  const [fileTreeLoading, setFileTreeLoading] = useState(false);
  const [fileTreeError, setFileTreeError] = useState<string | null>(null);
  const [fileTreeTruncated, setFileTreeTruncated] = useState(false);
  const [followUpFile, setFollowUpFile] = useState('');
  const [answerFiles, setAnswerFiles] = useState<Record<string, string>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openQuestions = useMemo(() => findOpenBlockingQuestions(events), [events]);
  const hasLinkedFiles = linkedFiles.length > 0;
  const fileOptionsListId = `ticket-file-options-${ticketId}`;

  useEffect(() => {
    let cancelled = false;

    async function fetchFileTree() {
      setFileTreeLoading(true);
      setFileTreeError(null);

      try {
        const response = await fetch(`/api/projects/${projectId}/file-tree`, { cache: 'no-store' });
        const payload = (await response.json()) as FileTreeResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? 'Failed to load project files.');
        }

        if (cancelled) return;
        setLinkedFiles(payload.files ?? []);
        setFileTreeTruncated(Boolean(payload.truncated));
      } catch (error) {
        if (cancelled) return;
        setLinkedFiles([]);
        setFileTreeTruncated(false);
        setFileTreeError(error instanceof Error ? error.message : 'Failed to load project files.');
      } finally {
        if (!cancelled) {
          setFileTreeLoading(false);
        }
      }
    }

    fetchFileTree();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function appendLinkedFile(message: string, filePath: string): string {
    const trimmedPath = filePath.trim();
    if (!trimmedPath) return message;

    const fileLine = `- \`${trimmedPath}\``;
    const trimmedMessage = message.trimEnd();
    if (trimmedMessage.includes(fileLine)) return trimmedMessage;

    const marker = 'Linked files:';
    if (!trimmedMessage) {
      return `${marker}\n${fileLine}\n`;
    }
    if (trimmedMessage.includes(marker)) {
      return `${trimmedMessage}\n${fileLine}\n`;
    }
    return `${trimmedMessage}\n\n${marker}\n${fileLine}\n`;
  }

  function ensureLinkedFileExists(filePath: string): string | null {
    const value = filePath.trim();
    if (!value) return null;
    return linkedFiles.includes(value) ? value : null;
  }

  function insertFollowUpFile() {
    const filePath = ensureLinkedFileExists(followUpFile);
    if (!filePath) return;

    setFollowUpDraft(current => appendLinkedFile(current, filePath));
    setFollowUpFile('');
  }

  function insertAnswerFile(questionId: string) {
    const filePath = ensureLinkedFileExists(answerFiles[questionId] ?? '');
    if (!filePath) return;

    setAnswerDrafts(prev => ({
      ...prev,
      [questionId]: appendLinkedFile(prev[questionId] ?? '', filePath)
    }));
    setAnswerFiles(prev => ({ ...prev, [questionId]: '' }));
  }

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
      setFollowUpDraft('');
      setFollowUpFile('');
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
      setAnswerDrafts(prev => ({ ...prev, [questionId]: '' }));
      setAnswerFiles(prev => ({ ...prev, [questionId]: '' }));
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
        {!isElectron ? null : (
          <span className="text-xs text-muted-foreground">
            Terminal mirroring temporarily disabled
          </span>
        )}
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
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 min-w-48 flex-1"
                  disabled={!hasLinkedFiles}
                  list={fileOptionsListId}
                  placeholder="Insert linked project file..."
                  value={answerFiles[question.id] ?? ''}
                  onChange={event =>
                    setAnswerFiles(prev => ({ ...prev, [question.id]: event.target.value }))
                  }
                />
                <Button
                  disabled={!hasLinkedFiles}
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => insertAnswerFile(question.id)}
                >
                  Insert file
                </Button>
              </div>
              <Button
                disabled={activeKey !== null}
                size="sm"
                type="button"
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Input
            className="h-8 min-w-48 flex-1"
            disabled={!hasLinkedFiles}
            list={fileOptionsListId}
            placeholder="Insert linked project file..."
            value={followUpFile}
            onChange={event => setFollowUpFile(event.target.value)}
          />
          <Button
            disabled={!hasLinkedFiles}
            size="sm"
            type="button"
            variant="ghost"
            onClick={insertFollowUpFile}
          >
            Insert file
          </Button>
        </div>
        <Button
          disabled={activeKey !== null}
          size="sm"
          type="button"
          variant="outline"
          onClick={submitFollowUp}
        >
          {activeKey === 'follow_up' ? 'Sending...' : 'Send follow-up'}
        </Button>
      </div>

      {errorMessage ? <p className="mt-3 text-xs text-destructive">{errorMessage}</p> : null}
      {fileTreeLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading linked project files...</p>
      ) : null}
      {fileTreeError ? <p className="mt-3 text-xs text-destructive">{fileTreeError}</p> : null}
      {!fileTreeLoading && !fileTreeError && !hasLinkedFiles ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No files found. Set a project linked directory to enable file linking.
        </p>
      ) : null}
      {hasLinkedFiles ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Select a file and click <span className="font-medium">Insert file</span> to attach it to
          the ticket conversation.
          {fileTreeTruncated ? ' Showing a truncated list.' : ''}
        </p>
      ) : null}
      <datalist id={fileOptionsListId}>
        {linkedFiles.map(file => (
          <option key={file} value={file} />
        ))}
      </datalist>
    </section>
  );
}
