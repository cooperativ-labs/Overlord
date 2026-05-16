'use client';

import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function Screenshot({
  src,
  alt,
  width,
  height
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  return (
    <figure className="space-y-2">
      <div className="overflow-hidden rounded-xl border bg-card">
        <Image src={src} alt={alt} width={width} height={height} className="h-auto w-full" />
      </div>
      <figcaption className="text-xs leading-6 text-muted-foreground">{alt}</figcaption>
    </figure>
  );
}

export function AgentPluginsTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const allowedTabs = new Set(['claude-desktop', 'codex-desktop']);
  const rawTab = searchParams.get('tab');
  const activeTab =
    rawTab && allowedTabs.has(rawTab)
      ? (rawTab as 'claude-desktop' | 'codex-desktop')
      : 'claude-desktop';

  const handleTabChange = (nextTab: string) => {
    if (!allowedTabs.has(nextTab)) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', nextTab);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-4">
      <TabsList>
        <TabsTrigger value="claude-desktop" className="gap-2">
          <Image
            src="/images/icons/claude-code.svg"
            alt=""
            width={16}
            height={16}
            className="size-4"
            aria-hidden="true"
          />
          <span>Claude Desktop</span>
        </TabsTrigger>
        <TabsTrigger value="codex-desktop" className="gap-2">
          <Image
            src="/images/icons/codex.svg"
            alt=""
            width={16}
            height={16}
            className="size-4 dark:invert"
            aria-hidden="true"
          />
          <span>Codex Desktop</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="claude-desktop" className="space-y-4">
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <div className="space-y-2">
            <h3 className="font-semibold">Confirm the automatic Claude plugin install</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Overlord installs the Claude plugin automatically when you enable Claude from Overlord
              settings. In Claude, this flow is only for confirming the plugin is active and
              reviewing its included skills and commands.
            </p>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-7">
            <li>
              Open Claude Desktop and go to <span className="font-medium">Customize</span>.
            </li>
            <li>
              Select <span className="font-medium">Plugins</span> from the sidebar and open{' '}
              <span className="font-medium">Overlord</span> from your installed plugins list.
            </li>
            <li>
              Verify the plugin is enabled, then review the listed skills and slash commands to
              confirm everything loaded correctly.
            </li>
          </ol>
          <div className="grid gap-4">
            <Screenshot
              src="/images/screenshots/Claude-plugin-screen-1.png"
              alt="Claude home screen showing active sessions before opening customization."
              width={1920}
              height={1200}
            />
            <Screenshot
              src="/images/screenshots/Claude-plugin-screen-2.png"
              alt="Claude Customize view with Plugins selected in the sidebar."
              width={1920}
              height={1200}
            />
            <Screenshot
              src="/images/screenshots/Claude-plugin-screen-3.png"
              alt="Overlord plugin details in Claude showing installed skills and commands."
              width={1920}
              height={1200}
            />
          </div>
          <div className="rounded-lg border border-dashed p-4 text-sm leading-7 text-muted-foreground">
            To remove it later, open Claude&apos;s Plugins screen, find{' '}
            <span className="font-medium">Overlord</span>, and use Claude&apos;s remove action. If
            you also want Overlord to stop reinstalling it, disable Claude in Overlord settings.
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
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

      <TabsContent value="codex-desktop" className="space-y-4">
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <div className="space-y-2">
            <h3 className="font-semibold">Install from Overlord Local Plugins</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              The Codex desktop app can browse the packaged plugin bundle that Overlord installed on
              your machine. You do not need to hand-edit config files.
            </p>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-7">
            <li>Open the Codex desktop app and go to the Plugins tab in the sidebar.</li>
            <li>
              Open the source dropdown next to the search bar and switch from{' '}
              <span className="font-medium">Built by OpenAI</span> to{' '}
              <span className="font-medium">Overlord Local Plugins</span>.
            </li>
            <li>
              Find the Overlord plugin under <span className="font-medium">Productivity</span>.
            </li>
            <li>
              Click <span className="font-medium">Install</span> and wait for Codex to refresh the
              plugin list.
            </li>
          </ol>
          <div className="grid gap-4">
            <Screenshot
              src="/images/screenshots/codex-plugin-step-1.png"
              alt="Codex plugin browser with the source selector open."
              width={2148}
              height={1652}
            />
            <Screenshot
              src="/images/screenshots/codex-plugin-step-2.png"
              alt="Codex plugin browser switched to Overlord Local Plugins."
              width={2148}
              height={1652}
            />
            <Screenshot
              src="/images/screenshots/codex-plugin-step-3.png"
              alt="Codex showing the Overlord plugin ready to install."
              width={2148}
              height={1652}
            />
          </div>
        </div>

        <div className="space-y-4 rounded-xl border bg-card p-5">
          <div className="space-y-2">
            <h3 className="font-semibold">Remove the Codex plugin</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Removing the plugin uses the same Codex plugins screen. Open the installed Overlord
              plugin and use Codex&apos;s remove action.
            </p>
          </div>
          <Screenshot
            src="/images/screenshots/codex-plugin-step-REMOVE.png"
            alt="Codex plugin details view showing the remove action for the Overlord plugin."
            width={2198}
            height={1704}
          />
          <p className="text-sm leading-6 text-muted-foreground">
            If you also want Overlord to stop reinstalling the bundle, deselect Codex in the desktop
            app settings or stop running <code>ovld setup codex</code> on that machine.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
