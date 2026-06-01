import type { ReactNode } from 'react';

import { DocsHeading } from './docs-heading';

function DiagramBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm">
      {children}
    </div>
  );
}

function DiagramArrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1 text-muted-foreground">
      <span className="text-lg leading-none" aria-hidden="true">
        ↓
      </span>
      {label ? (
        <span className="max-w-xs text-center text-xs text-muted-foreground">{label}</span>
      ) : null}
    </div>
  );
}

function Swimlane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-4">
      <DocsHeading
        as="h3"
        className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {title}
      </DocsHeading>
      <div className="flex flex-col items-stretch gap-2 sm:items-center">{children}</div>
    </section>
  );
}

/** HTML architecture diagram for the execution_requests → runner → launch flow. */
export function RunnerArchitectureDiagram() {
  return (
    <figure className="not-prose my-6 w-full">
      <figcaption className="mb-3 text-sm text-muted-foreground">
        Triggers enqueue work on the backend; a local runner claims the queue row and spawns{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">ovld launch</code>.
      </figcaption>
      <div className="flex flex-col gap-3" role="group" aria-label="Runner architecture flow">
        <Swimlane title="Triggers">
          <div className="flex flex-wrap justify-center gap-2">
            <DiagramBox>Agent delivers objective</DiagramBox>
            <DiagramBox>User clicks Run (web / desktop)</DiagramBox>
          </div>
        </Swimlane>

        <DiagramArrow label="deliver → schedule · Run → request-execution" />

        <Swimlane title="Overlord backend (Next.js / Supabase)">
          <div className="flex w-full max-w-lg flex-col gap-2">
            <DiagramBox>scheduleQueuedObjectiveAfterDeliver</DiagramBox>
            <DiagramBox>POST /api/protocol/request-execution</DiagramBox>
            <DiagramArrow label="auto_advance:<objective_id> · manual_run:<objective_id>:<request_id>" />
            <DiagramBox>
              <strong>execution_requests</strong> table (queued row)
            </DiagramBox>
            <DiagramBox>ticket_events: execution_requested</DiagramBox>
          </div>
        </Swimlane>

        <DiagramArrow label="claim-execution (device fingerprint)" />

        <Swimlane title="Capable machine (local or remote)">
          <div className="flex w-full max-w-lg flex-col gap-2">
            <DiagramBox>
              <code className="text-xs">ovld runner</code> start / once
            </DiagramBox>
            <DiagramArrow />
            <DiagramBox>
              <code className="text-xs">ovld launch</code> {'<agent>'}
            </DiagramBox>
            <DiagramArrow />
            <DiagramBox>Next agent session</DiagramBox>
            <DiagramArrow label="attach + execute" />
            <p className="text-center text-xs text-muted-foreground">↩ back to Overlord backend</p>
          </div>
        </Swimlane>
      </div>
    </figure>
  );
}
