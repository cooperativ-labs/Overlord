import type { Metadata } from 'next';

import { AgentPluginsTabs } from './agent-plugins-tabs';

export const metadata: Metadata = {
  title: 'Agent Plugins'
};

export default function AgentPluginsPage() {
  return (
    <main className="flex flex-1 flex-col gap-8 p-6 md:p-10 max-w-4xl">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Agent Plugins</h1>
        <p className="text-lg leading-7 text-muted-foreground">
          Plugins are the bridge between your coding agent and Overlord. Install them once and
          Overlord can launch tickets through that agent, stream updates back, and record the
          delivery.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Step 1 — Install the plugins from Overlord</h2>
        <p className="text-muted-foreground leading-7">
          Before you register anything with your agent, generate the local plugin bundles from the
          Overlord desktop app. This writes the plugin files into a known folder on your machine so
          Claude Code and Codex can pick them up.
        </p>
        <ol className="list-decimal space-y-2 pl-6 text-sm leading-7">
          <li>
            Open the <span className="font-medium">Overlord desktop app</span> and go to{' '}
            <span className="font-medium">Settings → Agents &amp; Plugins</span>.
          </li>
          <li>Select the agents you want to connect (for example Claude Code, Codex).</li>
          <li>
            Click <span className="font-medium">Install / Update plugins</span>. Overlord writes the
            plugin bundles to your local plugin directory and shows a green checkmark when each
            agent is ready.
          </li>
          <li>
            Leave that settings tab open — you&apos;ll want to re-run this step whenever you update
            the desktop app.
          </li>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Step 2 — Register the plugin in your agent</h2>
        <p className="text-muted-foreground leading-7">
          Once the plugin files exist on disk, tell your agent where to find them. Pick the tab
          that matches your setup.
        </p>
        <AgentPluginsTabs />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">Keeping plugins up to date</h2>
        <p className="text-muted-foreground leading-7">
          When the Overlord desktop app updates, rerun the install step in{' '}
          <span className="font-medium">Settings → Agents &amp; Plugins</span>. Claude Code and
          Codex both detect the new files without a restart.
        </p>
      </section>
    </main>
  );
}
