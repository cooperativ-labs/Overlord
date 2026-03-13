'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export default function ProjectsError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[projects] Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[300px] w-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-destructive">Something went wrong</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          An error occurred while loading the project. Please try again.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
