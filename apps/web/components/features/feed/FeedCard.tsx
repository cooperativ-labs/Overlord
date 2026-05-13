'use client';

import { useMemo, useState } from 'react';

import type { FeedProjectWorkspace } from '@/components/features/feed/FeedPostDiscussPanel';
import type { FeedPost } from '@/lib/actions/feed';
import {
  normalizeFeedRollupObjectiveSections,
  normalizeFeedRollupOrphanFiles
} from '@/lib/helpers/feed-post-rollup';
import { buildTicketPath } from '@/lib/helpers/ticket-path';

import { FeedCardLegacyBody } from './FeedCard/FeedCardLegacyBody';
import { FeedCardMetaLine } from './FeedCard/FeedCardMetaLine';
import { FeedCardRollupBody } from './FeedCard/FeedCardRollupBody';

const impactConfig: Record<string, { label: string; className: string }> = {
  minor: { label: 'Minor', className: 'bg-muted text-muted-foreground' },
  notable: {
    label: 'Notable',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
  },
  significant: {
    label: 'Significant',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
  }
};

type FeedCardProps = {
  post: FeedPost;
  editorScheme: string;
  workspaceRoot: string;
  project?: FeedProjectWorkspace;
};

export function FeedCard({ post, editorScheme, workspaceRoot, project }: FeedCardProps) {
  const [openObjectiveId, setOpenObjectiveId] = useState<string | null>(null);
  const [discussOpen, setDiscussOpen] = useState(false);
  const rollupSections = useMemo(
    () => normalizeFeedRollupObjectiveSections(post.objective_sections),
    [post.objective_sections]
  );
  const orphanFiles = useMemo(
    () => normalizeFeedRollupOrphanFiles(post.orphan_file_changes),
    [post.orphan_file_changes]
  );
  const actionsRequiredFromObjectives = useMemo(
    () => rollupSections.flatMap(section => section.action_required),
    [rollupSections]
  );
  const tradeoffsFromObjectives = useMemo(
    () => rollupSections.flatMap(section => section.tradeoffs),
    [rollupSections]
  );
  const useRollupUi = rollupSections.length > 0;
  const impact = impactConfig[post.impact_level] ?? impactConfig.notable;
  const ticketPath = buildTicketPath({ projectId: post.project_id, ticketId: post.ticket_id });
  const tradeoffs = useMemo(
    () => (Array.isArray(post.tradeoffs) ? post.tradeoffs : []),
    [post.tradeoffs]
  );
  const humanActions = useMemo(
    () => (Array.isArray(post.human_actions) ? post.human_actions : []),
    [post.human_actions]
  );
  const filesTouched = Array.isArray(post.files_touched) ? post.files_touched : [];
  const ticketsCreated = Array.isArray(post.tickets_created) ? post.tickets_created : [];

  const timestamp = new Date(post.updated_at);
  const wasUpdated = post.updated_at !== post.created_at;
  const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <article className="group relative flex gap-3.5">
      <div className="flex flex-col items-center pt-1.5">
        <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-primary/60" />
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>

      <div className="flex-1 min-w-0 pb-6">
        <FeedCardMetaLine
          post={post}
          ticketPath={ticketPath}
          wasUpdated={wasUpdated}
          timeStr={timeStr}
          dateStr={dateStr}
        />

        <div className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_0_rgba(0,0,0,0.02)]">
          {useRollupUi ? (
            <FeedCardRollupBody
              post={post}
              editorScheme={editorScheme}
              workspaceRoot={workspaceRoot}
              project={project}
              impact={impact}
              rollupSections={rollupSections}
              orphanFiles={orphanFiles}
              actionsRequiredFromObjectives={actionsRequiredFromObjectives}
              tradeoffsFromObjectives={tradeoffsFromObjectives}
              ticketsCreated={ticketsCreated}
              openObjectiveId={openObjectiveId}
              setOpenObjectiveId={setOpenObjectiveId}
              discussOpen={discussOpen}
              setDiscussOpen={setDiscussOpen}
            />
          ) : (
            <FeedCardLegacyBody
              post={post}
              editorScheme={editorScheme}
              workspaceRoot={workspaceRoot}
              project={project}
              impact={impact}
              humanActions={humanActions}
              tradeoffs={tradeoffs}
              ticketsCreated={ticketsCreated}
              filesTouched={filesTouched}
            />
          )}
        </div>
      </div>
    </article>
  );
}
