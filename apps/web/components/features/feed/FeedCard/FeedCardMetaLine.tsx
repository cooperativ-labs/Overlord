import { ProjectColorDot } from '@/components/features/projects/ProjectColorDot';
import type { FeedPost } from '@/lib/actions/feed';

import { FeedTicketLink } from '../FeedTicketLink';

type FeedCardMetaLineProps = {
  post: FeedPost;
  ticketPath: string;
  wasUpdated: boolean;
  timeStr: string;
  dateStr: string;
};

export function FeedCardMetaLine({
  post,
  ticketPath,
  wasUpdated,
  timeStr,
  dateStr
}: FeedCardMetaLineProps) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-fg3">
      <span>
        {wasUpdated ? 'Updated ' : ''}
        {timeStr}
      </span>
      <span className="text-fg3/40">&middot;</span>
      <span>{dateStr}</span>
      <span className="text-fg3/40">&middot;</span>
      <span className="inline-flex items-center gap-1">
        <ProjectColorDot color={post.project_color} />
        {post.project_name}
      </span>
      <span className="text-fg3/40">&middot;</span>
      <FeedTicketLink
        href={ticketPath}
        className="text-fg1 font-medium underline-offset-2 hover:underline"
      >
        {post.ticket_identifier ? `${post.ticket_identifier} ` : ''}
        {post.ticket_title ?? 'Untitled ticket'}
      </FeedTicketLink>
    </div>
  );
}
