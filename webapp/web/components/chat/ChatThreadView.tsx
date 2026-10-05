import type {
  ChatKnowledgebaseWriteDto,
  ChatMessageDto,
  ChatRunDto,
  ChatRunFailureCode
} from '@overlord/contract';
import { Archive, ArchiveRestore, Loader2, Pencil, Square, Wifi } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { api } from '@/lib/api.ts';
import { chatErrorCode, chatErrorMessage, isRetryableChatError } from '@/lib/chat/errors.ts';
import { grantKey, knowledgebaseWriteTargets } from '@/lib/chat/knowledgebase-writes.ts';
import { clearRequestId, stableRequestId } from '@/lib/chat/request-ids.ts';
import { type ChatThreadState, composerMode } from '@/lib/chat/thread-state.ts';
import type { ChatStreamStatus, ChatThreadStream } from '@/lib/chat/thread-stream.ts';
import { useChatPresence, useChatProviders, useChatThreadStream } from '@/lib/chat/use-chat.ts';
import { cn } from '@/lib/utils.ts';

import { type ChatBlockContext, ChatMessageBlocks } from './ChatBlocks.tsx';
import { ChatComposer } from './ChatComposer.tsx';
import { ChatQuestionCard } from './ChatQuestionCard.tsx';

const FAILURE_TEXT: Record<ChatRunFailureCode, string> = {
  provider_unavailable: 'The assistant is unavailable right now.',
  rate_limited: 'The assistant is rate limited. Try again shortly.',
  context_limit: 'The conversation is too long for the assistant to continue.',
  unsupported_capability: 'The assistant could not do that.',
  interrupted: 'The request was interrupted.',
  provider_error: 'The assistant hit an error.',
  source_access_lost: 'Access to a source this relied on was lost.'
};

const TERMINAL_TEXT: Partial<Record<ChatStreamStatus, string>> = {
  not_found: 'This conversation is not available to you in this organization.',
  unavailable: 'Chat is not available on this backend.',
  unauthorized: 'Your session expired. Sign in again to continue.'
};

/**
 * One private thread: authorized snapshot plus ordered live events, questions,
 * proposals, cancel/Continue, rename and archive. Presence is held while this
 * tab is foreground, and events are acknowledged only after they are committed
 * to the rendered transcript.
 */
export function ChatThreadView({ threadId, scope }: { threadId: string; scope: string }) {
  const { stream, view } = useChatThreadStream(threadId, scope);
  const state = view.state;
  useChatPresence(threadId, state?.cursor ?? null);

  const terminal = TERMINAL_TEXT[view.status];
  if (terminal) {
    return (
      <p className="m-auto max-w-sm p-6 text-center text-sm text-(--color-ink-dim)">{terminal}</p>
    );
  }
  if (!state || !stream) {
    return (
      <div className="m-auto flex items-center gap-2 text-sm text-(--color-ink-dim)">
        <Loader2 className="size-4 animate-spin" /> Loading conversation…
      </div>
    );
  }
  return <ThreadBody state={state} stream={stream} status={view.status} scope={scope} />;
}

function ThreadBody({
  state,
  stream,
  status,
  scope
}: {
  state: ChatThreadState;
  stream: ChatThreadStream;
  status: ChatStreamStatus;
  scope: string;
}) {
  const [composerError, setComposerError] = useState<string | null>(null);
  const pendingSubmission = useRef<{ text: string; grant: string; id: string } | null>(null);
  const providers = useChatProviders(scope);
  const writeTargets = useMemo(
    () => knowledgebaseWriteTargets(providers.data?.connections),
    [providers.data?.connections]
  );
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const mode = composerMode(state);
  const threadId = state.thread.id;

  const context = useMemo<ChatBlockContext>(
    () => ({
      scope,
      openQuestion: state.openQuestion,
      proposals: state.proposals,
      merge: update => stream.merge(update),
      onResync: () => stream.resync()
    }),
    [scope, state.openQuestion, state.proposals, stream]
  );

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [state.messages, state.activeRun, state.tools]);

  const submit = async (
    text: string,
    knowledgebaseWrite: ChatKnowledgebaseWriteDto | null
  ): Promise<boolean> => {
    // Reuse the id while retrying the same text and grant; a changed draft is a new request.
    const grant = grantKey(knowledgebaseWrite);
    const pending =
      pendingSubmission.current?.text === text && pendingSubmission.current.grant === grant
        ? pendingSubmission.current
        : { text, grant, id: globalThis.crypto.randomUUID() };
    pendingSubmission.current = pending;
    setComposerError(null);
    stickToBottom.current = true;
    try {
      const result = await api.submitChatMessage(threadId, {
        clientRequestId: pending.id,
        text,
        ...(knowledgebaseWrite ? { knowledgebaseWrite } : {})
      });
      pendingSubmission.current = null;
      stream.merge({ message: result.message, run: result.run });
      return true;
    } catch (cause) {
      if (!isRetryableChatError(cause)) pendingSubmission.current = null;
      if (chatErrorCode(cause) === 'run_in_progress') stream.resync();
      setComposerError(chatErrorMessage(cause));
      return false;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader state={state} stream={stream} status={status} />
      <div
        ref={scroller}
        onScroll={event => {
          const element = event.currentTarget;
          stickToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="mx-auto grid w-full max-w-3xl gap-5">
          {state.hasEarlierMessages ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-center"
              onClick={() => {
                stickToBottom.current = false;
                void stream.loadEarlier();
              }}
            >
              Load earlier messages
            </Button>
          ) : null}
          {state.messages.length === 0 && !state.activeRun ? (
            <p className="py-10 text-center text-sm text-(--color-ink-dim)">
              Describe a feature or ask a question. The assistant reads your projects, Knowledgebase
              notes, and current repository state. It drafts work only when you press Create, and
              edits notes only in a workspace you allow for that message.
            </p>
          ) : null}
          {state.messages.map(message => (
            <MessageRow key={message.id} message={message} context={context} />
          ))}
          {state.openQuestion && !questionHasBlock(state) ? (
            <ChatQuestionCard
              question={state.openQuestion}
              scope={scope}
              merge={context.merge}
              onResync={context.onResync}
            />
          ) : null}
          <RunStatus state={state} stream={stream} scope={scope} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <ChatComposer
          mode={mode}
          error={composerError}
          onSubmit={submit}
          writeTargets={writeTargets}
          autoFocus
        />
      </div>
    </div>
  );
}

/** Questions are opened by events; a transcript block for one is optional. */
function questionHasBlock(state: ChatThreadState): boolean {
  const id = state.openQuestion?.id;
  return state.messages.some(message =>
    message.blocks.some(block => block.kind === 'question' && block.questionId === id)
  );
}

function MessageRow({ message, context }: { message: ChatMessageDto; context: ChatBlockContext }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl border bg-(--color-bg-muted) px-3.5 py-2.5 text-sm whitespace-pre-wrap">
          {message.blocks
            .map(block => ('text' in block ? block.text : block.fallbackText))
            .join('\n')}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('min-w-0', message.state === 'streaming' && 'opacity-95')}>
      <ChatMessageBlocks message={message} context={context} />
      {message.state === 'streaming' ? (
        <span className="mt-1 inline-block h-3 w-1.5 animate-pulse bg-(--color-ink-dim)" />
      ) : null}
    </div>
  );
}

function RunStatus({
  state,
  stream,
  scope
}: {
  state: ChatThreadState;
  stream: ChatThreadStream;
  scope: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = state.activeRun;
  const latest = state.latestRun;

  const act = async (action: string, call: (id: string) => Promise<ChatRunDto>) => {
    setPending(true);
    setError(null);
    try {
      const result = await call(stableRequestId(scope, action));
      clearRequestId(scope, action);
      stream.merge({ run: result });
    } catch (cause) {
      if (!isRetryableChatError(cause)) clearRequestId(scope, action);
      if (chatErrorCode(cause) === 'continue_not_available') stream.resync();
      setError(chatErrorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  let body: ReactNode = null;
  if (run) {
    const working = run.state !== 'waiting_user';
    const tools = state.tools.slice(-3);
    body = (
      <div className="grid gap-1.5 text-sm text-(--color-ink-dim)">
        <div className="flex items-center gap-2">
          {working ? <Loader2 className="size-4 animate-spin" /> : null}
          <span>
            {run.state === 'queued'
              ? 'Waiting to start…'
              : run.state === 'running'
                ? 'Working…'
                : 'Waiting for your answer'}
          </span>
          {run.knowledgebaseWrite ? (
            <span className="text-xs">· may edit notes in {run.knowledgebaseWrite.workspace}</span>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            disabled={pending || Boolean(run.cancelRequestedAt)}
            onClick={() => void act(`cancel:${run.id}`, id => api.cancelChatRun(run.id, id))}
          >
            <Square className="size-3" /> Stop
          </Button>
        </div>
        {tools.length > 0 ? (
          <ul className="grid gap-0.5 pl-6 text-xs">
            {tools.map(tool => (
              <li
                key={tool.toolCallId}
                className={cn(tool.state === 'failed' && 'text-destructive')}
              >
                {tool.label}
                {tool.state === 'executing' || tool.state === 'requested' ? '…' : ''}
                {tool.state === 'failed' ? ' (failed)' : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  } else if (latest) {
    if (latest.state === 'failed') {
      body = (
        <p className="text-sm text-destructive">
          {latest.failureCode ? FAILURE_TEXT[latest.failureCode] : 'The request failed.'} Send a
          message to try again.
        </p>
      );
    } else if (latest.state === 'cancelled') {
      body = <p className="text-sm text-(--color-ink-dim)">Stopped.</p>;
    } else if (latest.outcome === 'allowance_exhausted' && latest.continueAvailable) {
      body = (
        <div className="flex items-center gap-2 text-sm text-(--color-ink-dim)">
          <span>The research allowance for this request ran out.</span>
          <Button
            size="xs"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void act(`continue:${latest.id}`, id =>
                api.continueChatRun(latest.id, id).then(result => result.run)
              )
            }
          >
            Continue
          </Button>
        </div>
      );
    }
  }
  if (!body && !error) return null;
  return (
    <div className="grid gap-1">
      {body}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ThreadHeader({
  state,
  stream,
  status
}: {
  state: ChatThreadState;
  stream: ChatThreadStream;
  status: ChatStreamStatus;
}) {
  const thread = state.thread;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) setTitle(thread.title);
  }, [thread.title, editing]);

  const update = async (body: { title?: string; archived?: boolean }) => {
    setError(null);
    try {
      const next = await api.updateChatThread(thread.id, {
        expectedRevision: thread.revision,
        ...body
      });
      stream.merge({ thread: next });
      setEditing(false);
    } catch (cause) {
      if (chatErrorCode(cause) === 'stale_revision') stream.resync();
      setError(chatErrorMessage(cause));
    }
  };
  return (
    <div className="flex flex-none items-center gap-2 border-b px-4 py-2.5">
      {editing ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={event => {
            event.preventDefault();
            const value = title.trim();
            if (value && value !== thread.title) void update({ title: value });
            else setEditing(false);
          }}
        >
          <Input
            value={title}
            maxLength={80}
            autoFocus
            aria-label="Conversation title"
            onChange={event => setTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') setEditing(false);
            }}
          />
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
      ) : (
        <>
          <h1 className="min-w-0 flex-1 truncate font-semibold">
            {thread.title || 'New conversation'}
          </h1>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Rename"
            onClick={() => setEditing(true)}
          >
            <Pencil />
          </Button>
        </>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={thread.archivedAt ? 'Unarchive' : 'Archive'}
        onClick={() => void update({ archived: !thread.archivedAt })}
      >
        {thread.archivedAt ? <ArchiveRestore /> : <Archive />}
      </Button>
      {status === 'reconnecting' || status === 'polling' ? (
        <span
          className="flex items-center gap-1 text-xs text-(--color-ink-dim)"
          title={
            status === 'polling'
              ? 'Live updates unavailable; checking periodically'
              : 'Reconnecting'
          }
        >
          <Wifi className="size-3.5" /> {status === 'polling' ? 'Polling' : 'Reconnecting'}
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
