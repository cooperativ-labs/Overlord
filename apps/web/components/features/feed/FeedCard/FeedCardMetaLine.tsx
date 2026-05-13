import Link from 'next/link';

import type { FeedPost } from '@/lib/actions/feed';

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
    <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      <span>
        {wasUpdated ? 'Updated ' : ''}
        {timeStr}
      </span>
      <span className="text-muted-foreground/40">&middot;</span>
      <span>{dateStr}</span>
      <span className="text-muted-foreground/40">&middot;</span>
      <span className="inline-flex items-center gap-1">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: post.project_color }}
        />
        {post.project_name}
      </span>
      <span className="text-muted-foreground/40">&middot;</span>
      <Link href={ticketPath} className="text-primary underline-offset-2 hover:underline">
        {post.ticket_identifier ? `${post.ticket_identifier} ` : ''}
        {post.ticket_title ?? 'Untitled ticket'}
      </Link>
    </div>
  );
}
