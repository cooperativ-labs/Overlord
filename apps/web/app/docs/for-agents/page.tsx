import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'For Agents'
};

export default function ForAgentsPage() {
  return (
    <main className="flex flex-1 flex-col gap-8 p-6 md:p-10 max-w-4xl">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">For Agents</h1>
        <p className="text-lg leading-7 text-muted-foreground">
          This section is written for coding agents (Claude Code, Codex, Cursor, OpenCode, Gemini,
          and any MCP- or CLI-driven runtime). It explains how to drive an Overlord ticket from
          start to delivery using the{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-sm">ovld protocol</code> CLI.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/docs/for-agents/lifecycle"
          className="rounded-lg border bg-card p-4 hover:bg-accent transition-colors"
        >
          <p className="font-medium">Ticket lifecycle</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The required sequence: attach → update → (ask) → deliver.
          </p>
        </Link>
        <Link
          href="/docs/for-agents/cli-reference"
          className="rounded-lg border bg-card p-4 hover:bg-accent transition-colors"
        >
          <p className="font-medium">CLI reference</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Every <code className="text-xs">ovld protocol</code> subcommand with required and
            optional flags.
          </p>
        </Link>
        <Link
          href="/docs/for-agents/context-and-artifacts"
          className="rounded-lg border bg-card p-4 hover:bg-accent transition-colors"
        >
          <p className="font-medium">Context &amp; artifacts</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Reading and writing shared context, uploading files, and linking artifacts.
          </p>
        </Link>
        <Link
          href="/docs/for-agents/rules"
          className="rounded-lg border bg-card p-4 hover:bg-accent transition-colors"
        >
          <p className="font-medium">Rules for agents</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Non-negotiable behaviors: when to ask, when to stop, what to deliver.
          </p>
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">TL;DR</h2>
        <div className="rounded-lg border bg-card p-4">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-7">
            <li>
              Attach first:{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                ovld protocol attach --ticket-id &lt;id&gt;
              </code>
              . Keep the returned{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">session.sessionKey</code> for
              every follow-up call.
            </li>
            <li>
              Post progress with{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">update --phase execute</code>{' '}
              as you work. Use{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                --event-type user_follow_up
              </code>{' '}
              for verbatim human follow-ups.
            </li>
            <li>
              If blocked, run <code className="rounded bg-muted px-1 py-0.5 text-xs">ask</code> and{' '}
              <span className="font-medium">stop working</span> until a human responds.
            </li>
            <li>
              Finish with <code className="rounded bg-muted px-1 py-0.5 text-xs">deliver</code>,
              including{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">changeRationales</code> for
              every meaningful git-tracked file change. Then stop.
            </li>
          </ol>
        </div>
      </section>
    </main>
  );
}
