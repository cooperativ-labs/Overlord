import type { Metadata } from 'next';
import Image from 'next/image';

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
        <AgentPluginsTabs />
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
