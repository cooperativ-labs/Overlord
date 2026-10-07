import type { ChatKnowledgebaseWriteDto, ChatThreadDto } from '@overlord/contract';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { MessageSquarePlus, MessagesSquare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ChatComposer } from '@/components/chat/ChatComposer.tsx';
import { ChatConnectionsPanel } from '@/components/chat/ChatConnectionsPanel.tsx';
import { ChatThreadView } from '@/components/chat/ChatThreadView.tsx';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { api } from '@/lib/api.ts';
import { chatErrorMessage, isRetryableChatError } from '@/lib/chat/errors.ts';
import {
  grantKey,
  knowledgebaseEditsEverywhere,
  knowledgebaseWriteTargets
} from '@/lib/chat/knowledgebase-writes.ts';
import { beginChatPaint, bindChatPaint } from '@/lib/chat/performance.ts';
import { useChatAvailability, useChatProviders, useChatThreads } from '@/lib/chat/use-chat.ts';
import { cn } from '@/lib/utils.ts';

const CONNECTION_STATUS_TEXT: Record<string, string> = {
  connected: 'Knowledgebase connected.',
  denied: 'Knowledgebase sign-in was declined.',
  expired: 'The Knowledgebase sign-in expired. Try again.',
  failed: 'Knowledgebase sign-in failed. Try again.'
};

/** `/chat` and `/chat/$threadId`: private assistant conversations (Cloud only). */
export function ChatPage() {
  const availability = useChatAvailability();
  const params = useParams({ strict: false }) as { threadId?: string };
  const search = useSearch({ strict: false }) as { connection?: string };
  const navigate = useNavigate();
  const threadId = params.threadId ?? null;
  const scope = availability.kind === 'ready' ? availability.scope : null;

  // A different account, organization, or backend never keeps showing the old thread.
  const previousScope = useRef(scope);
  useEffect(() => {
    if (previousScope.current && scope !== previousScope.current && threadId)
      void navigate({ to: '/chat' });
    previousScope.current = scope;
  }, [scope, threadId, navigate]);

  if (availability.kind === 'loading') return null;
  if (availability.kind !== 'ready') {
    return (
      <div className="m-auto grid max-w-md gap-2 p-6 text-center">
        <MessagesSquare className="mx-auto size-6 text-(--color-ink-dim)" />
        <h1 className="font-semibold">Chat is unavailable</h1>
        <p className="text-sm text-(--color-ink-dim)">
          {availability.kind === 'local'
            ? 'The assistant runs on Overlord Cloud. Switch to a hosted backend to use Chat.'
            : 'Join an organization to start a conversation.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <ThreadSidebar scope={availability.scope} activeThreadId={threadId} />
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {search.connection && CONNECTION_STATUS_TEXT[search.connection] ? (
          <div className="flex flex-none items-center justify-between border-b bg-(--color-bg-subtle) px-4 py-2 text-xs">
            <span>{CONNECTION_STATUS_TEXT[search.connection]}</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void navigate({ to: '.', search: {} })}
            >
              Dismiss
            </Button>
          </div>
        ) : null}
        {threadId ? (
          <ChatThreadView
            key={`${availability.scope}|${threadId}`}
            threadId={threadId}
            scope={availability.scope}
          />
        ) : (
          <NewConversation scope={availability.scope} />
        )}
      </section>
    </div>
  );
}

function ThreadSidebar({
  scope,
  activeThreadId
}: {
  scope: string;
  activeThreadId: string | null;
}) {
  const [archived, setArchived] = useState(false);
  const threads = useChatThreads(scope, archived);
  // `archived=1` includes every thread; the archived view shows only archived ones.
  const items = threads.data?.items.filter(thread => !archived || thread.archivedAt) ?? [];
  return (
    <aside className="flex w-72 flex-none flex-col border-r">
      <div className="flex items-center justify-between px-3 pb-2 pt-4">
        <h2 className="text-sm font-semibold">{archived ? 'Archived' : 'Conversations'}</h2>
        <Link
          to="/chat"
          aria-label="New conversation"
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <MessageSquarePlus />
        </Link>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2">
        {threads.isError ? (
          <p className="px-2 text-xs text-destructive">{chatErrorMessage(threads.error)}</p>
        ) : null}
        {threads.data && items.length === 0 ? (
          <p className="px-2 py-3 text-xs text-(--color-ink-dim)">
            {archived ? 'No archived conversations.' : 'No conversations yet.'}
          </p>
        ) : null}
        <ul className="grid gap-0.5">
          {items.map(thread => (
            <ThreadListItem key={thread.id} thread={thread} active={thread.id === activeThreadId} />
          ))}
        </ul>
      </nav>
      <div className="grid gap-3 border-t px-3 py-3">
        <Button
          variant="ghost"
          size="xs"
          className="justify-self-start"
          onClick={() => setArchived(value => !value)}
        >
          {archived ? 'Show conversations' : 'Show archived'}
        </Button>
        <ChatConnectionsPanel scope={scope} />
      </div>
    </aside>
  );
}

function ThreadListItem({ thread, active }: { thread: ChatThreadDto; active: boolean }) {
  return (
    <li>
      <Link
        to="/chat/$threadId"
        params={{ threadId: thread.id }}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-(--color-bg-muted)',
          active && 'bg-(--color-bg-muted) font-medium'
        )}
      >
        <span className="min-w-0 flex-1 truncate">{thread.title || 'New conversation'}</span>
        {thread.activeRunState === 'waiting_user' ? (
          <span className="size-2 rounded-full bg-amber-500" title="Waiting for your answer" />
        ) : thread.activeRunState ? (
          <span className="size-2 animate-pulse rounded-full bg-sky-500" title="Working" />
        ) : null}
      </Link>
    </li>
  );
}

/**
 * Starting a conversation creates an empty thread, then submits the first
 * message with its own request id. Retrying after a failure reuses both the
 * created thread and the request id, so nothing is duplicated.
 */
function NewConversation({ scope }: { scope: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const created = useRef<{
    threadId: string;
    text: string | null;
    grant: string | null;
    requestId: string | null;
  } | null>(null);
  const providers = useChatProviders(scope);
  const writeTargets = useMemo(
    () => knowledgebaseWriteTargets(providers.data?.connections),
    [providers.data?.connections]
  );
  const editsEverywhere = knowledgebaseEditsEverywhere(providers.data?.connections);

  const submit = async (
    text: string,
    knowledgebaseWrite: ChatKnowledgebaseWriteDto | null
  ): Promise<boolean> => {
    setError(null);
    try {
      created.current ??= {
        threadId: (await api.createChatThread()).thread.id,
        text: null,
        grant: null,
        requestId: null
      };
      const pending = created.current;
      const grant = grantKey(knowledgebaseWrite);
      if (pending.text !== text || pending.grant !== grant) {
        pending.text = text;
        pending.grant = grant;
        pending.requestId = globalThis.crypto.randomUUID();
      }
      beginChatPaint(pending.threadId);
      const submission = await api.submitChatMessage(pending.threadId, {
        clientRequestId: pending.requestId!,
        text,
        ...(knowledgebaseWrite ? { knowledgebaseWrite } : {})
      });
      bindChatPaint(pending.threadId, submission.run.id);
      created.current = null;
      void queryClient.invalidateQueries({ queryKey: ['chat', scope, 'threads'] });
      void navigate({ to: '/chat/$threadId', params: { threadId: pending.threadId } });
      return true;
    } catch (cause) {
      if (!isRetryableChatError(cause) && created.current) created.current.text = null;
      setError(chatErrorMessage(cause));
      return false;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="m-auto grid w-full max-w-2xl gap-4 px-4">
        <div className="grid gap-1 text-center">
          <MessagesSquare className="mx-auto size-6 text-(--color-ink-dim)" />
          <h1 className="text-lg font-semibold">What do you want to work on?</h1>
          <p className="text-sm text-(--color-ink-dim)">
            Describe a feature. The assistant researches your projects, notes, and repositories,
            asks when it is unsure where the work belongs, and proposes draft missions you can
            create.
          </p>
        </div>
        <ChatComposer
          mode="send"
          error={error}
          onSubmit={submit}
          writeTargets={writeTargets}
          editsEverywhere={editsEverywhere}
          autoFocus
        />
      </div>
    </div>
  );
}
