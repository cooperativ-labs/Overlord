import type { Metadata } from 'next';
import Image from 'next/image';
import { Suspense } from 'react';

import { AgentPluginsTabs } from './agent-plugins-tabs';

export const metadata: Metadata = {
  title: 'Agent Plugins'
};

export default function AgentPluginsPage() {
  return (
    <main className="flex max-w-5xl flex-1 flex-col gap-8 p-6 md:p-10">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Agent Plugins</h1>
        <p className="text-lg leading-7 text-muted-foreground">
          Plugins are the bridge between your coding agent and Overlord. Install them once and
          Overlord can launch tickets through that agent, stream updates back, and record the
          delivery.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Step 1 — Install the packaged plugins from Overlord
        </h2>
        <p className="leading-7 text-muted-foreground">
          The desktop app and the CLI both ship the Overlord-managed connector bundles. In the
          desktop app, open <span className="font-medium">Settings → CLI &amp; Local Agents</span>,
          then use the Agent plugins section to prepare the plugins you want. If you prefer the CLI,
          use <code>ovld setup claude</code> or <code>ovld setup codex</code>.
        </p>
        <div className="space-y-2">
          <div className="overflow-hidden rounded-xl border bg-card">
            <Image
              src="/images/screenshots/agent-plugin-settings.png"
              alt="Overlord desktop app settings page showing CLI and Local Agents with the Agent plugins installer."
              width={2278}
              height={1550}
              className="h-auto w-full"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Select the agents you want, then click{' '}
            <span className="font-medium">Prepare all agent plugins</span>. Overlord writes the
            local connector files for each selected agent and keeps them in sync when you rerun this
            step after an update.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Step 2 — Register the plugin in your agent
        </h2>
        <p className="leading-7 text-muted-foreground">
          Once the plugin files exist on disk, tell your agent where to find them. Pick the tab that
          matches your setup.
        </p>
        <Suspense fallback={null}>
          <AgentPluginsTabs />
        </Suspense>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Slash commands</h2>
        <p className="leading-7 text-muted-foreground">
          Installing an Overlord plugin or running <code>ovld setup &lt;agent&gt;</code> registers a
          set of slash commands you can use mid-session in Claude Code, Cursor, Antigravity CLI, and
          OpenCode. Each one is a thin wrapper around an <code>ovld protocol</code> call.
        </p>
        <ul className="list-disc space-y-2 pl-5 leading-7 text-muted-foreground">
          <li>
            <code>/attach &lt;ticket_id&gt;</code> — establish a persistent session with an existing
            ticket (Claude and OpenCode).
          </li>
          <li>
            <code>/connect &lt;ticket_id&gt;</code> — route the current session onto another ticket
            without loading its full context.
          </li>
          <li>
            <code>/load &lt;ticket_id&gt;</code> — read a ticket&apos;s details, history, and
            artifacts without creating a session.
          </li>
          <li>
            <code>/discuss-objective &lt;ticket_id&gt;</code> — mark a draft objective as submitted
            (in active discussion) without starting execution (Claude and OpenCode).
          </li>
          <li>
            <code>/create &lt;objective&gt;</code> — create a draft Overlord ticket from the current
            conversation.
          </li>
          <li>
            <code>/prompt &lt;objective&gt;</code> — create a ticket in <code>execute</code> and
            attach the current session immediately.
          </li>
          <li>
            <code>/record-work [context]</code> — record work the agent already completed in chat as
            a ticket in <code>review</code> with a generated feed post. The agent synthesizes
            objective, summary, and per-file change rationales from the conversation and the local
            git diff before invoking <code>ovld protocol record-work</code>. No session is opened.
          </li>
        </ul>
        <p className="text-sm leading-6 text-muted-foreground">
          Antigravity installs as a plugin via <code>agy plugin install</code>; Claude, Cursor, and
          OpenCode use Markdown files in their respective <code>commands/</code> directories. Run{' '}
          <code>ovld setup antigravity</code> to install the Antigravity plugin, then launch tickets
          with <code>ovld launch antigravity --ticket-id &lt;ticket_id&gt;</code>. Gemini CLI is
          deprecated — Antigravity manages model selection in its own UI.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight">Keeping plugins up to date</h2>
        <p className="leading-7 text-muted-foreground">
          When the Overlord desktop app updates, rerun the prepare step in{' '}
          <span className="font-medium">Settings → CLI &amp; Local Agents</span>. If you manage your
          setup from the terminal, rerun <code>ovld setup claude</code> or{' '}
          <code>ovld setup codex</code> instead.
        </p>
      </section>
    </main>
  );
}
