import { Skeleton } from '@/components/ui/skeleton';

export function TicketPanelSkeleton() {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-4 w-px" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-10 rounded-md" />
        </div>
      </div>

      <div className="border-b px-4 py-2">
        <Skeleton className="h-8 w-full rounded-md" />
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-muted/50">
        <section className="bg-card pt-5">
          <div className="px-5">
            <div className="mb-4">
              <Skeleton className="h-8 w-3/4" />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-28 rounded-full" />
              <div className="h-4 w-px bg-border" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <div className="h-4 w-px bg-border" />
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>

          <div className="my-5 px-5 py-5 pt-7">
            <div className="mb-3 space-y-2 rounded-md border bg-background p-2">
              <div className="flex items-center justify-between rounded-md px-2 py-1">
                <div className="space-y-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-6 w-6 rounded-md" />
              </div>
              <div className="space-y-2 px-2 pb-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>

            <div className="flex items-start gap-1 rounded-md border bg-background p-3">
              <div className="w-full space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
              <Skeleton className="h-8 w-8 rounded-md" />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3 px-5">
          <div className="rounded-md border bg-background px-4 py-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-4 w-4 rounded-sm" />
            </div>
            <div className="mt-4 space-y-4 pb-2 pl-2">
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
          </div>

          <div className="mb-6 rounded-md border bg-background p-4">
            <Skeleton className="h-4 w-36" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>

          <Skeleton className="mb-2 h-px w-full" />

          <div className="mb-6 rounded-md border bg-background p-4">
            <Skeleton className="h-4 w-24" />
            <div className="mt-3 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
