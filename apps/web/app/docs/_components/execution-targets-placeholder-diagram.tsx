import type { ReactNode } from 'react';

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold"
        aria-hidden="true"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5 text-sm">{children}</div>
    </li>
  );
}

/** How a remote target is registered before the runner starts claiming work. */
export function ExecutionTargetsRegistrationDiagram() {
  return (
    <figure className="not-prose my-6 w-full">
      <figcaption className="mb-3 text-sm text-muted-foreground">
        Create the target in the web app or via protocol first, then register it from the machine
        that will run agents. Registration upgrades the same row instead of creating a duplicate.
      </figcaption>
      <ol className="space-y-4" aria-label="Remote target registration steps">
        <Step n={1}>
          <p>
            User creates an <strong>execution_targets</strong> row for the machine or environment
            that will run the agent, along with a project checkout path.
          </p>
        </Step>
        <Step n={2}>
          <p>
            Association rows (<code className="text-xs">organization_execution_targets</code>,{' '}
            <code className="text-xs">user_execution_targets</code>, and{' '}
            <code className="text-xs">project_execution_targets</code>) plus a{' '}
            <code className="text-xs">project_resource_directories</code> row are created in the
            same transaction.
          </p>
        </Step>
        <Step n={3}>
          <p>
            Agent work is queued against that target and resource. The runner on that machine can
            claim the request once its fingerprint matches the registered target.
          </p>
        </Step>
        <Step n={4}>
          <p>
            When <code className="text-xs">ovld protocol get-device</code> runs on the target
            machine with a real <code className="text-xs">device_fingerprint</code>, the server
            reconciles the pending row, marks it registered, and keeps the same{' '}
            <code className="text-xs">execution_target_id</code> so resources and project links stay
            attached.
          </p>
        </Step>
      </ol>
    </figure>
  );
}
