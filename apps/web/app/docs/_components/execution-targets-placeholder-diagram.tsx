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

/** Placeholder SSH target reconciliation before remote ovld registers. */
export function ExecutionTargetsPlaceholderDiagram() {
  return (
    <figure className="not-prose my-6 w-full">
      <figcaption className="mb-3 text-sm text-muted-foreground">
        Configure SSH in the web app before the remote machine has run{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">ovld</code>; registration upgrades
        the same row instead of creating a duplicate.
      </figcaption>
      <ol className="space-y-4" aria-label="Placeholder reconciliation steps">
        <Step n={1}>
          <p>
            User saves SSH host, port, username, and key path for a project. Overlord upserts an{' '}
            <strong>execution_targets</strong> row with{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">is_placeholder=true</code> and{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              placeholder_key=ssh:{'{host}'}:{'{port}'}
            </code>
            .
          </p>
        </Step>
        <Step n={2}>
          <p>
            Association rows (<code className="text-xs">organization_execution_targets</code>,{' '}
            <code className="text-xs">user_execution_targets</code>,{' '}
            <code className="text-xs">execution_target_ssh_credentials</code>,{' '}
            <code className="text-xs">project_execution_targets</code>) and a{' '}
            <code className="text-xs">project_resource_directories</code> row for the remote
            checkout path are created in the same transaction.
          </p>
        </Step>
        <Step n={3}>
          <p>
            Agent work is queued against that target and resource. The runner on another machine may
            claim only if its fingerprint does not match; SSH launch uses the stored credential
            metadata locally.
          </p>
        </Step>
        <Step n={4}>
          <p>
            When <code className="text-xs">ovld protocol get-device</code> runs on the remote host
            with a real <code className="text-xs">device_fingerprint</code>, the server reconciles
            the placeholder by host/port, sets <code className="text-xs">is_placeholder=false</code>
            , and keeps the same <code className="text-xs">execution_target_id</code> — resources
            and project links stay attached.
          </p>
        </Step>
      </ol>
    </figure>
  );
}
