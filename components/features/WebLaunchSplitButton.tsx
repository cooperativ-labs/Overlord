'use client';

import { Check, ChevronDown, Copy, Loader2, Server } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { getTicketPromptForCopy } from '@/lib/actions/tickets';
import type { SshServerProfileSummary } from '@/lib/actions/ssh-servers';

type Props = {
  ticketId: string;
  agentToken: string | null;
  sshProfiles: SshServerProfileSummary[];
};

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.top = '-9999px';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

/**
 * Split button for the web (non-Electron) interface.
 *
 * Main action: Copy prompt — mirrors the existing CopyTicketPromptButton.
 * Dropdown: configured SSH servers — clicking one SSHes into the server and
 *   starts the agent in a tmux session, then copies the attach command.
 */
export function WebLaunchSplitButton({ ticketId, agentToken, sshProfiles }: Props) {
  const [copied, setCopied] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  async function handleCopyPrompt() {
    const { error, prompt } = await getTicketPromptForCopy(ticketId, 'run', 'web');
    if (error || !prompt) {
      toast.error('Failed to copy prompt');
      return;
    }
    await writeTextToClipboard(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSshLaunch(profile: SshServerProfileSummary) {
    if (!agentToken) {
      toast.error('No agent token found. Generate one in Settings → Agents & MCP.');
      return;
    }
    setLaunchingId(profile.id);
    try {
      const res = await fetch('/api/ssh/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: profile.id,
          ticketId,
          agentToken,
          agent: 'claude'
        })
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Launch failed');
      }

      const { attachCommand, host } = (await res.json()) as {
        sessionName: string;
        host: string;
        attachCommand: string;
      };

      await writeTextToClipboard(attachCommand);

      toast.success(`Agent started on ${profile.name}`, {
        description: (
          <span>
            Attach command copied.{' '}
            <span className="font-mono text-xs">{attachCommand}</span>
          </span>
        ),
        duration: 8000
      });
    } catch (error) {
      toast.error(`Failed to launch on ${profile.name}`, {
        description: error instanceof Error ? error.message : undefined
      });
    } finally {
      setLaunchingId(null);
    }
  }

  const isLaunching = launchingId !== null;

  return (
    <div className="inline-flex items-stretch rounded-md border bg-background text-sm shadow-sm border-input hover:bg-accent hover:text-accent-foreground transition-colors">
      {/* Main: Copy prompt */}
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-l-md px-3 h-8 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={() => void handleCopyPrompt()}
        disabled={isLaunching}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        <span>{copied ? 'Copied!' : 'Copy prompt'}</span>
      </button>

      {/* Caret dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center rounded-r-md border-l px-2 h-8 transition-colors hover:bg-accent hover:text-accent-foreground"
            disabled={isLaunching}
          >
            {isLaunching ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem
            className="gap-2 text-xs"
            onClick={() => void handleCopyPrompt()}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy prompt
          </DropdownMenuItem>

          {sshProfiles.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground px-2 py-1">
                SSH servers
              </DropdownMenuLabel>
              {sshProfiles.map(profile => (
                <DropdownMenuItem
                  key={profile.id}
                  className="gap-2 text-xs"
                  onClick={() => void handleSshLaunch(profile)}
                  disabled={launchingId === profile.id}
                >
                  {launchingId === profile.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Server className="h-3.5 w-3.5" />
                  )}
                  {profile.name}
                  <span className="ml-auto text-muted-foreground truncate max-w-[80px]">
                    {profile.host}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
