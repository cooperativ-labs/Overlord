'use client';

import { type InfiniteData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import {
  type ExecutingFeedTicket,
  type FeedPost,
  getExecutingFeedTicketsAction,
  getFeedPostsAction
} from '@/lib/actions/feed';

import { feedQueryKeys } from './query-keys';

export const FEED_PAGE_SIZE = 20;

export type FeedPostsInfiniteData = InfiniteData<FeedPost[], number>;

export function useFeedPosts() {
  return useInfiniteQuery<
    FeedPost[],
    Error,
    FeedPostsInfiniteData,
    ReturnType<typeof feedQueryKeys.posts>,
    number
  >({
    queryKey: feedQueryKeys.posts(),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getFeedPostsAction({ limit: FEED_PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < FEED_PAGE_SIZE) return undefined;
      return allPages.reduce((offset, page) => offset + page.length, 0);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false
  });
}

export function useExecutingFeedTickets(initialTickets: ExecutingFeedTicket[]) {
  return useQuery<ExecutingFeedTicket[], Error>({
    queryKey: feedQueryKeys.executingTickets(),
    queryFn: getExecutingFeedTicketsAction,
    initialData: initialTickets,
    staleTime: 15_000,
    refetchInterval: 20_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false
  });
}
