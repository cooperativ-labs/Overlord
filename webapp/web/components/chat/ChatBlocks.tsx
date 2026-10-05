import type {
  ChatBlockDto,
  ChatEvidenceDto,
  ChatMessageDto,
  ChatProposalDto,
  ChatQuestionDto
} from '@overlord/contract';
import { Link } from '@tanstack/react-router';
import { BookOpen, Database, FileCode2, ShieldOff } from 'lucide-react';

import { Markdown } from '@/components/Markdown.tsx';
import type { ChatThreadStream } from '@/lib/chat/thread-stream.ts';

import { ChatProposalCard } from './ChatProposalCard.tsx';
import { ChatQuestionCard } from './ChatQuestionCard.tsx';

export interface ChatBlockContext {
  scope: string;
  openQuestion: ChatQuestionDto | null;
  proposals: Record<string, ChatProposalDto>;
  /** Merge a REST result into the thread before its event arrives. */
  merge: ChatThreadStream['merge'];
  onResync: () => void;
}

/** Renders one message's blocks. Unknown kinds fall back to their `fallbackText`. */
export function ChatMessageBlocks({
  message,
  context
}: {
  message: ChatMessageDto;
  context: ChatBlockContext;
}) {
  return (
    <div className="grid min-w-0 gap-3">
      {message.blocks.map(block => (
        <ChatBlock key={block.id} block={block} context={context} />
      ))}
      {message.state === 'interrupted' ? (
        <p className="text-xs text-(--color-ink-dim)">This reply was interrupted.</p>
      ) : null}
    </div>
  );
}

export function ChatBlock({ block, context }: { block: ChatBlockDto; context: ChatBlockContext }) {
  switch (block.kind) {
    case 'text':
      return block.text.length > 0 ? <Markdown text={block.text} /> : null;
    case 'evidence':
      return <EvidenceList evidence={block.evidence} />;
    case 'question': {
      const question = context.openQuestion?.id === block.questionId ? context.openQuestion : null;
      return question ? (
        <ChatQuestionCard
          question={question}
          scope={context.scope}
          merge={context.merge}
          onResync={context.onResync}
        />
      ) : (
        <p className="text-sm text-(--color-ink-dim)">{block.fallbackText}</p>
      );
    }
    case 'proposal': {
      const proposal = context.proposals[block.proposalId];
      if (!proposal) return <p className="text-sm text-(--color-ink-dim)">{block.fallbackText}</p>;
      return (
        <ChatProposalCard
          proposal={proposal}
          blockRevision={block.revision}
          scope={context.scope}
          merge={context.merge}
          onResync={context.onResync}
        />
      );
    }
    case 'mission':
      return (
        <Link
          to="/feed/missions/$missionId"
          params={{ missionId: block.missionId }}
          search={block.objectiveId ? { objective: block.objectiveId } : {}}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {block.fallbackText || 'Open mission'}
        </Link>
      );
    case 'unavailable':
      return (
        <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-(--color-ink-dim)">
          <ShieldOff className="size-4" />
          <span>
            Content withheld: access to one of its sources was lost.
            {block.regenerable ? ' Ask again to regenerate from the sources you still have.' : ''}
          </span>
        </div>
      );
    default: {
      const unknown = block as { fallbackText?: unknown };
      return typeof unknown.fallbackText === 'string' && unknown.fallbackText ? (
        <p className="whitespace-pre-wrap text-sm">{unknown.fallbackText}</p>
      ) : null;
    }
  }
}

function sourceIcon(evidence: ChatEvidenceDto) {
  if (evidence.source.kind === 'knowledgebase') return <BookOpen className="size-3.5" />;
  if (evidence.source.kind === 'repository') return <FileCode2 className="size-3.5" />;
  return <Database className="size-3.5" />;
}

function sourceDetail(evidence: ChatEvidenceDto): string {
  const source = evidence.source;
  if (source.kind === 'knowledgebase')
    return `Knowledgebase · ${source.workspace}${source.path ? ` · ${source.path}` : ''}`;
  if (source.kind === 'repository')
    return `Repository · ${source.resourceKey}${source.relativePath ? ` · ${source.relativePath}` : ''}${source.head ? ` @ ${source.head.slice(0, 8)}` : ''}`;
  return `Overlord · ${source.entityType}`;
}

export function EvidenceList({ evidence }: { evidence: ChatEvidenceDto[] }) {
  if (evidence.length === 0) return null;
  return (
    <details className="rounded-lg border bg-(--color-bg-subtle) px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-(--color-ink-dim)">
        Sources · {evidence.length}
      </summary>
      <ol className="mt-2 grid gap-2">
        {evidence.map(item => (
          <li key={item.id} className="grid gap-0.5">
            <div className="flex items-center gap-1.5 font-medium">
              {sourceIcon(item)}
              <span className="wrap-anywhere">{item.label}</span>
              {item.stale ? (
                <span className="rounded bg-amber-500/15 px-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                  may be outdated
                </span>
              ) : null}
            </div>
            <div className="text-xs text-(--color-ink-dim)">
              {sourceDetail(item)} · observed {new Date(item.observedAt).toLocaleString()}
            </div>
            {item.excerpt ? (
              <blockquote className="border-l-2 pl-2 text-xs whitespace-pre-wrap text-(--color-ink-dim)">
                {item.excerpt}
                {item.truncated ? '…' : ''}
              </blockquote>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
