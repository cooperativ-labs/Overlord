'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function AgentPluginsTabs() {
  return (
    <Tabs defaultValue="claude-code" className="gap-4">
      <TabsList>
        <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
        <TabsTrigger value="codex">Codex Desktop</TabsTrigger>
      </TabsList>

      <TabsContent value="claude-code" className="space-y-4">
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <h3 className="font-semibold">Add the plugin from a local path</h3>
          <p className="text-sm text-muted-foreground leading-6">
            Claude Code supports loading plugins from a local directory. Point it at the bundle
            Overlord just installed.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-7">
            <li>
              Open Claude Code and run <code className="rounded bg-muted px-1 py-0.5 text-xs">/plugins</code>.
            </li>
            <li>
              Choose <span className="font-medium">Add plugin</span> and select{' '}
              <span className="font-medium">From local path</span>.
            </li>
            <li>
              Pick the <code className="rounded bg-muted px-1 py-0.5 text-xs">overlord</code> folder
              that the desktop app wrote to your local plugins directory.
            </li>
            <li>
              Confirm the install. Claude Code lists the plugin and its commands right away — no
              restart needed.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground leading-6">
            Full reference:{' '}
            <a
              href="https://code.claude.com/docs/en/discover-plugins#add-from-local-paths"
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Add from local paths
            </a>{' '}
            ·{' '}
            <a
              href="https://code.claude.com/docs/en/discover-plugins#apply-plugin-changes-without-restarting"
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Apply plugin changes without restarting
            </a>
          </p>
        </div>
      </TabsContent>

      <TabsContent value="codex" className="space-y-4">
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <h3 className="font-semibold">Install from Overlord Local Plugins</h3>
          <p className="text-sm text-muted-foreground leading-6">
            The Codex desktop app can browse the plugin bundle Overlord installed on your machine.
            You don&apos;t have to hand-edit any config.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-7">
            <li>Open the Codex desktop app and go to the Plugins tab in the sidebar.</li>
            <li>
              Click the dropdown to the right of the search bar and change it from{' '}
              <span className="font-medium">Built by OpenAI</span> to{' '}
              <span className="font-medium">Overlord Local Plugins</span>.
            </li>
            <li>
              Under <span className="font-medium">Productivity</span>, click the{' '}
              <span className="font-medium">+</span> next to the Overlord plugin.
            </li>
            <li>
              Click <span className="font-medium">Install</span>. Codex reloads the plugin list
              once it finishes.
            </li>
          </ol>
        </div>
      </TabsContent>
    </Tabs>
  );
}
