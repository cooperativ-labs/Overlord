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

/** How execution targets, associations, and resource directories relate. */
export function ExecutionTargetsArchitectureDiagram() {
  return (
    <figure className="not-prose my-6 w-full">
      <figcaption className="mb-3 text-sm text-muted-foreground">
        Canonical execution targets are shared; organization labels, user access, project
        membership, and checkout paths hang off separate tables.
      </figcaption>
      <div
        className="flex flex-col gap-3"
        role="group"
        aria-label="Execution targets and resource directories"
      >
        <Swimlane title="Canonical identity">
          <DiagramBox>
            <strong>execution_targets</strong>
            <p className="mt-1 text-xs text-muted-foreground">
              fingerprint or placeholder · host · transport
            </p>
          </DiagramBox>
        </Swimlane>

        <DiagramArrow label="one target, many views" />

        <div className="grid gap-3 sm:grid-cols-2">
          <Swimlane title="Who can see and name it">
            <DiagramBox>
              <strong>organization_execution_targets</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                org-scoped label · owner_user_id (personal vs. org-owned)
              </p>
            </DiagramBox>
            <DiagramBox>
              <strong>user_execution_targets</strong>
              <p className="mt-1 text-xs text-muted-foreground">access + default label</p>
            </DiagramBox>
          </Swimlane>

          <Swimlane title="Where the project runs">
            <DiagramBox>
              <strong>project_execution_targets</strong>
              <p className="mt-1 text-xs text-muted-foreground">target enabled for this project</p>
            </DiagramBox>
            <DiagramArrow label="one primary path per (project, target)" />
            <DiagramBox>
              <strong>project_resource_directories</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                directory_path · label · is_primary
              </p>
            </DiagramBox>
          </Swimlane>
        </div>

        <DiagramArrow label="request-execution picks target + resource" />

        <Swimlane title="Agent dispatch">
          <div className="flex w-full max-w-lg flex-col gap-2">
            <DiagramBox>
              <strong>execution_requests</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                target_execution_target_id · target_resource_id
              </p>
            </DiagramBox>
            <DiagramArrow label="claim-execution matches fingerprint" />
            <DiagramBox>
              <code className="text-xs">ovld runner</code> → working directory from primary resource
            </DiagramBox>
          </div>
        </Swimlane>
      </div>
    </figure>
  );
}
