import { Skeleton } from '@/components/ui/skeleton';

export function TicketPanelSkeleton() {
  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {/* Title */}
        <div className="mb-4">
          <Skeleton className="h-7 w-3/4" />
        </div>

        {/* Badges row */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-full" />
          <div className="h-4 w-px bg-border" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <div className="h-4 w-px bg-border" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>

        {/* Project selector */}
        <Skeleton className="mb-6 h-8 w-40 rounded-md" />

        {/* Objective section */}
        <div className="mb-8 rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
          <Skeleton className="mb-3 h-3 w-20" />
          <div className="rounded-md border bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-6 w-6 rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
          </div>
        </div>

        {/* Available Tools */}
        <div className="mb-6">
          <Skeleton className="mb-2 h-3 w-28" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>

        {/* Acceptance Criteria */}
        <div className="mb-6">
          <Skeleton className="mb-2 h-3 w-36" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    </div>
  );
}
