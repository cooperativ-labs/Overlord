'use client';

import { HelpCircle } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="text-xs text-muted-foreground space-y-1">{children}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border bg-muted px-1 py-0.5 text-[10px] font-mono">
      {children}
    </kbd>
  );
}

export function GraphHelpDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Graph help">
          <HelpCircle className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Graph Visualization Help</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            <Section title="Modes">
              <p>
                <strong>Compare</strong> — visualize file-change relationships between selected
                tickets. Ticket nodes show status color, file nodes group by directory.
              </p>
              <p>
                <strong>Hotspots</strong> — show files sized and colored by how many tickets touched
                them over a configurable time window. Useful for identifying churn.
              </p>
              <p>
                <strong>Replay</strong> — scrub through file changes by timestamp. Play/pause
                animates the timeline over ~6 seconds.
              </p>
              <p>
                <strong>Diff Lanes</strong> — pin exactly two tickets to see shared files in the
                middle lane, with unique files on each side.
              </p>
            </Section>

            <Section title="Interactions">
              <p>Click a ticket or file node to see its details in the right panel.</p>
              <p>
                Click a file node to highlight connected tickets. <Kbd>Esc</Kbd> clears the
                selection.
              </p>
              <p>
                Use the &quot;Add related tickets&quot; button on multi-ticket files for one-hop
                expansion.
              </p>
              <p>
                Dashed amber edges between tickets indicate they touched the same file (co-change).
              </p>
            </Section>

            <Section title="Filters">
              <p>
                Filter by change kind, impact, directory, or status. Filtered-out nodes are dimmed
                rather than removed to preserve spatial context.
              </p>
            </Section>

            <Section title="Exports">
              <p>Export the current view as Mermaid Markdown (for PRs) or SVG snapshot.</p>
            </Section>

            <Section title="Keyboard Shortcuts">
              <p>
                <Kbd>Esc</Kbd> — clear selection and close details panel
              </p>
              <p>Pan — click and drag on the canvas background</p>
              <p>Zoom — scroll wheel or pinch</p>
            </Section>

            <Section title="Performance">
              <p>
                Graphs with more than ~500 nodes are automatically aggregated by directory to keep
                the canvas responsive. A warning banner appears when this happens.
              </p>
              <p>On small screens, a list view replaces the canvas for readability.</p>
            </Section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
