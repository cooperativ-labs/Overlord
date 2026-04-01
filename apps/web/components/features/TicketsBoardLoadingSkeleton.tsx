import { Skeleton } from '@/components/ui/skeleton';

type TicketsBoardLoadingSkeletonProps = {
  variant: 'project' | 'user';
};

function UserHeaderSkeleton() {
  return (
    <div className="flex items-center justify-between border-b px-6 py-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-32 rounded-md" />
        <Skeleton className="h-9 w-9 rounded-md" />
      </div>
    </div>
  );
}

function ProjectHeaderSkeleton() {
  return (
    <div className="border-b px-5 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-5 rounded border" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-5 w-64 rounded-full" />
        </div>
        <Skeleton className="h-7 w-7 rounded-md" />
      </div>
    </div>
  );
}

export function TicketsBoardLoadingSkeleton({ variant }: TicketsBoardLoadingSkeletonProps) {
  return (
    <div className="flex h-full flex-col bg-background">
      {variant === 'project' ? <ProjectHeaderSkeleton /> : <UserHeaderSkeleton />}

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-16 rounded-full" />
        </div>

        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between rounded-md border bg-card px-4 py-3"
            >
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
