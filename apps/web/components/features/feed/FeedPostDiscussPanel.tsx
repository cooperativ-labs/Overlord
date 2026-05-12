'use client';

import { ChevronDown, Copy, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AgentModelChooserButton } from '@/components/features/AgentModelChooserButton';
import { useAgentModelPreference } from '@/components/features/AgentModelSelector';
import { useWorkspacePreference } from '@/components/features/projects/useWorkspacePreference';
import { useTerminal } from '@/components/features/terminal/TerminalProvider';
import { useLocalDirectoryAccess } from '@/components/features/terminal/useLocalDirectoryAccess';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import type { FeedPost } from '@/lib/actions/feed';
import { getFeedDiscussPromptForCopy } from '@/lib/actions/tickets';
import { cn } from '@/lib/utils';

export type FeedProjectWorkspace = {
  id: string;
  organizationId: number;
  localWorkingDirectory: string | null;
  sshCommand: string | null;
  remoteWorkingDirectory: string | null;
};

type FeedPostDiscussPanelProps = {
  post: FeedPost;
  project: FeedProjectWorkspace | undefined;
};

async function copyDiscussPrompt(input: {
  ticketId: string;
  feedPostId: string;
  question: string;
  context: 'electron' | 'web';
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error, prompt } = await getFeedDiscussPromptForCopy({
    ticketId: input.ticketId,
    feedPostId: input.feedPostId,
    initialQuestion: input.question,
    context: input.context
  });
  if (error || !prompt) {
    return { ok: false, message: error ?? 'Could not build prompt.' };
  }
  await navigator.clipboard.writeText(prompt);
  return { ok: true };
}

export function FeedPostDiscussPanel({ post, project }: FeedPostDiscussPanelProps) {
  const [question, setQuestion] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const { selection: agentModelSelection, loaded: preferenceLoaded } = useAgentModelPreference();
  const hasResolvedModel = preferenceLoaded;

  const { isElectron, launchAgent } = useTerminal();

  const workspace = useWorkspacePreference({
    projectId: post.project_id,
    workingDirectory: project?.localWorkingDirectory ?? null,
    sshCommand: project?.sshCommand ?? null,
    remoteWorkingDirectory: project?.remoteWorkingDirectory ?? null
  });
  const effectiveWorkingDirectory = workspace.effectiveWorkingDirectory;
  const effectiveSshCommand = workspace.effectiveSshCommand;
  const effectiveRemoteWorkingDirectory = workspace.effectiveRemoteWorkingDirectory;
  const hasSshConfig = Boolean(effectiveSshCommand?.trim());
  const localDirAccess = useLocalDirectoryAccess({
    workingDirectory: effectiveWorkingDirectory,
    hasProjectWorkingDirectory: Boolean(project?.localWorkingDirectory?.trim())
  });
  const canRunAgent = hasSshConfig || localDirAccess;

  async function handleCopyPrompt() {
    const trimmed = question.trim();
    if (!trimmed) {
      toast.error('Add a question to start the discussion.');
      return;
    }

    setIsBusy(true);
    try {
      const result = await copyDiscussPrompt({
        ticketId: post.ticket_id,
        feedPostId: post.id,
        question: trimmed,
        context: isElectron ? 'electron' : 'web'
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Full discussion prompt copied to clipboard.', {
        description: isElectron
          ? 'Or use Discuss in terminal to open your agent in the project folder.'
          : undefined
      });
    } catch (error) {
      console.error('[FeedPostDiscussPanel]', error);
      toast.error('Failed to copy prompt.', {
        description:
          error instanceof Error && error.message.trim().length > 0 ? error.message : undefined
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDiscussTerminal() {
    const trimmed = question.trim();
    if (!trimmed) {
      toast.error('Add a question to start the discussion.');
      return;
    }

    if (!canRunAgent || !hasResolvedModel) {
      toast.error('Configure a working directory or SSH workspace for this project first.');
      return;
    }

    setIsBusy(true);
    try {
      await launchAgent({
        ticketId: post.ticket_id,
        agent: agentModelSelection.agent,
        organizationId: post.organization_id,
        cwd: effectiveWorkingDirectory ?? undefined,
        launchMode: 'ask',
        model: agentModelSelection.model ?? undefined,
        thinking: agentModelSelection.thinking ?? undefined,
        sshCommand: effectiveSshCommand ?? undefined,
        remoteWorkingDirectory: effectiveRemoteWorkingDirectory ?? undefined,
        projectId: post.project_id,
        feedPostId: post.id,
        initialQuestion: trimmed
      });
      toast.success('Opening terminal with feed context in the project working directory.');
    } catch (error) {
      console.error('[FeedPostDiscussPanel]', error);
      toast.error('Failed to open terminal.', {
        description:
          error instanceof Error && error.message.trim().length > 0 ? error.message : undefined
      });
    } finally {
      setIsBusy(false);
    }
  }

  const discussDisabled = isBusy || !canRunAgent || !hasResolvedModel;
  const copyDisabled = isBusy;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <MessageSquareText className="h-4 w-4 text-muted-foreground" />
        <span>Discuss this update</span>
      </div>
      <Textarea
        value={question}
        onChange={e => setQuestion(e.target.value)}
        placeholder="What would you like to explore about this work?"
        className={cn(
          'text-base leading-relaxed max-h-[280px] min-h-[96px] overflow-y-auto resize-y',
          'border-border/60 bg-background'
        )}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
        <AgentModelChooserButton
          ticketId={post.ticket_id}
          objectiveId={null}
          initialSelection={null}
          persistSelection={false}
        />
        <div className="ml-auto flex items-stretch gap-0">
          {isElectron ? (
            <div className="inline-flex items-stretch rounded-md border border-input bg-background text-sm shadow-sm">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-r-none border-0 shadow-none hover:bg-accent"
                disabled={discussDisabled}
                onClick={() => void handleDiscussTerminal()}
              >
                {isBusy ? 'Working…' : 'Discuss in terminal'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="rounded-l-none border-l border-input px-2 shadow-none hover:bg-accent"
                    disabled={isBusy}
                    aria-label="More discuss actions"
                  >
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[200px]">
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    disabled={copyDisabled}
                    onClick={() => void handleCopyPrompt()}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy full prompt</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={copyDisabled}
              onClick={() => void handleCopyPrompt()}
            >
              {isBusy ? 'Working…' : 'Copy full prompt'}
            </Button>
          )}
        </div>
      </div>
      {!isElectron ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Paste the prompt into your chosen chat client.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          The conversation will open in your terminal
        </p>
      )}
    </div>
  );
}
