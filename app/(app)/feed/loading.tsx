import { Skeleton } from '@/components/ui/skeleton';

function FeedCardSkeleton() {
  return (
    <article className="group relative flex gap-3.5">
      <div className="flex flex-col items-center pt-1.5">
        <Skeleton className="h-2.5 w-2.5 rounded-full" />
        <Skeleton className="mt-1 h-full w-px flex-1" />
      </div>

      <div className="flex-1 min-w-0 pb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-1" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-1" />
          <Skeleton className="h-4 w-28 rounded-full" />
          <Skeleton className="h-4 w-1" />
          <Skeleton className="h-4 w-32" />
        </div>

        <div className="rounded-lg border bg-card p-5">
          <div className="mb-2.5 flex items-start gap-2.5">
            <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-11/12" />
              <Skeleton className="h-5 w-3/4" />
            </div>
            <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
          </div>

          <div className="mt-3.5 space-y-3.5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
            </div>

            <div className="rounded-md border border-blue-200 bg-blue-50 p-3.5 dark:border-blue-800/40 dark:bg-blue-950/20">
              <div className="mb-2 flex items-center gap-1.5">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-5/6" />
              </div>
            </div>
          </div>

          <div className="mt-2.5 ml-6 flex flex-wrap items-center gap-1.5">
            <Skeleton className="h-3.5 w-3.5 rounded-sm" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
        </div>
      </div>
    </article>
  );
}

export default function FeedLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <Skeleton className="h-6 w-14" />
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="space-y-1.5 pb-6">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>

          <div className="space-y-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <FeedCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
