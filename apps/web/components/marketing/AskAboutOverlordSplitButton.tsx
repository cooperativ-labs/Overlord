'use client';

import { Check, ChevronDown, Copy } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { getAgentTypeByValue } from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';

const ASK_PROMPT =
  'Tell me what Overlord is, who it is for, and when I should use it. Use this public context page as your source: https://www.ovld.ai/overlord-context';

const ASK_HREF_CHATGPT = `https://chatgpt.com/?q=${encodeURIComponent(ASK_PROMPT)}`;
const ASK_HREF_CLAUDE = `https://claude.ai/new/?q=${encodeURIComponent(ASK_PROMPT)}`;

type AskProvider = 'chatgpt' | 'claude' | 'copy';

const PROVIDER_LABELS: Record<AskProvider, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  copy: 'Copy Prompt'
};

const PROVIDER_OPTIONS: AskProvider[] = ['chatgpt', 'claude', 'copy'];

function getAgentIconForProvider(provider: Exclude<AskProvider, 'copy'>) {
  return getAgentTypeByValue(provider === 'chatgpt' ? 'codex' : 'claude');
}

function ProviderIcon({ provider, className }: { provider: AskProvider; className?: string }) {
  if (provider === 'copy') {
    return <Copy className={cn('size-3.5 shrink-0 text-slate-950', className)} aria-hidden />;
  }

  const agent = getAgentIconForProvider(provider);
  return (
    <Image
      src={agent.icon}
      alt={`${PROVIDER_LABELS[provider]} icon`}
      width={14}
      height={14}
      className={cn('size-3.5 shrink-0', className)}
    />
  );
}

type AskAboutOverlordSplitButtonProps = {
  className?: string;
};

export function AskAboutOverlordSplitButton({ className }: AskAboutOverlordSplitButtonProps) {
  const [selectedProvider, setSelectedProvider] = useState<AskProvider>('chatgpt');
  const [copied, setCopied] = useState(false);

  async function handleAction({ provider = selectedProvider }: { provider?: AskProvider } = {}) {
    if (provider === 'copy') {
      try {
        await navigator.clipboard.writeText(ASK_PROMPT);
        setCopied(true);
        toast.success('Prompt copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error('Failed to copy prompt');
      }
      return;
    }

    const href = provider === 'chatgpt' ? ASK_HREF_CHATGPT : ASK_HREF_CLAUDE;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      className={cn(
        'flex items-stretch overflow-hidden rounded-full border bg-white text-slate-950 shadow-lg shadow-white/10 hover:bg-slate-100',
        className
      )}
    >
      <button
        type="button"
        className="inline-flex h-14 cursor-pointer items-center gap-1.5 rounded-l-full px-4 font-medium transition-colors hover:bg-white/5"
        onClick={() => void handleAction()}
      >

        <span className="whitespace-nowrap">
          {copied ? 'Copied ✓' : 'Ask about Overlord'}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-14 cursor-pointer items-center gap-1.5 rounded-r-full border-l border-black/20 px-2 hover:bg-slate-100 focus:outline-none"
            aria-label="Choose how to ask about Overlord"
          >
            <ProviderIcon provider={selectedProvider} /> <ChevronDown className="size-3.5 text-slate-950" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[170px] bg-white/90 backdrop-blur-xs text-slate-950">
          {PROVIDER_OPTIONS.map(provider => (
            <DropdownMenuItem
              key={provider}
              className="gap-2 text-xs"
              onClick={() => {
                setSelectedProvider(provider);
                void handleAction({ provider });
              }}
            >
              <ProviderIcon provider={provider} />
              <span>{PROVIDER_LABELS[provider]}</span>
              {provider === selectedProvider && (
                <Check className="ml-auto size-3 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
