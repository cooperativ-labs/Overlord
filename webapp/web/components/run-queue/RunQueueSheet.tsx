import { Link } from '@tanstack/react-router';
import { ListOrdered } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../ui.tsx';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet.tsx';

import { RunQueuePanel } from './RunQueuePanel.tsx';

/** Board-header access to every project queue without leaving the board. */
export function RunQueueSheet({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        className="h-8 gap-1.5 px-2.5 text-xs"
        onClick={() => setOpen(true)}
      >
        <ListOrdered className="h-3.5 w-3.5" />
        Queue
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        {/*
         * The base Sheet applies its width cap through the right-side data
         * variant. Match that variant here so this 72rem cap actually
         * overrides the shared 24rem cap.
         */}
        <SheetContent
          side="right"
          className="w-full overflow-y-auto data-[side=right]:sm:max-w-[72rem]"
        >
          <SheetHeader>
            <SheetTitle>Run Queue</SheetTitle>
            <SheetDescription>
              Reorder waiting entries within a queue. Running entries stay fixed.
            </SheetDescription>
          </SheetHeader>
          <RunQueuePanel projectId={projectId} compact />
          <div className="mt-3 border-t pt-3">
            <Link
              to="/projects/$projectId/queue"
              params={{ projectId }}
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open full queue view
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
