'use client';

export const feedQueryKeys = {
  all: ['feed'] as const,
  posts: () => ['feed', 'posts'] as const,
  executingTickets: () => ['feed', 'executing-tickets'] as const
} as const;

export type FeedPostsQueryKey = ReturnType<typeof feedQueryKeys.posts>;
export type ExecutingTicketsQueryKey = ReturnType<typeof feedQueryKeys.executingTickets>;
