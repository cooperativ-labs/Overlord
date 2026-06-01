'use client';

import { Check, Copy, TerminalSquare } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { CLI_INSTALL_COMMAND } from '@/lib/downloads/cli';

type Props = {
  onContinue: () => void;
  /** Name of the project that was just created from the connected folder. */
  projectName?: string;
};

const AUTH_COMMAND = 'ovld auth login';
const REGISTER_COMMAND = 'ovld add-cwd';

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <code className="bg-muted flex-1 rounded-md px-3 py-2 font-mono text-sm">{command}</code>
      <Button variant="outline" size="sm" onClick={handleCopy} aria-label="Copy command">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

/**
 * Web-only step shown when a user declines the desktop app but has connected a
 * folder (creating a project). It walks them through installing the CLI,
 * authenticating, and running `ovld add-cwd` from inside that folder, which
 * registers their machine as an execution target and links it to the project.
 */
export function CliSetupStep({ onContinue, projectName }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Finish setup with the CLI</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          You created your project, but agents need a machine to run on. Install the{' '}
          <code className="text-foreground">ovld</code> CLI and register this computer as an
          execution target. Run these from a terminal:
        </p>
      </div>

      <div className="flex flex-col gap-5 rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
            <TerminalSquare className="h-5 w-5" />
          </div>
          <div className="flex-1 space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">1. Install the CLI</p>
              <CommandRow command={CLI_INSTALL_COMMAND} />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-semibold">2. Sign in</p>
              <p className="text-muted-foreground text-sm">
                Authenticate the CLI with the same account.
              </p>
              <CommandRow command={AUTH_COMMAND} />
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-semibold">
                3. Register this machine from your project folder
              </p>
              <p className="text-muted-foreground text-sm">
                <code className="text-foreground">cd</code> into your project's folder on your
                machine and run this there.
                {projectName ? (
                  <>
                    {' '}
                    When prompted, pick{' '}
                    <span className="text-foreground font-medium">{projectName}</span>.
                  </>
                ) : (
                  <> When prompted, pick the project you just created.</>
                )}{' '}
                This registers your machine as an execution target and links it to the project.
              </p>
              <CommandRow command={REGISTER_COMMAND} />
            </div>
          </div>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        See the{' '}
        <a
          href="/docs"
          className="underline underline-offset-2"
          target="_blank"
          rel="noopener noreferrer"
        >
          documentation
        </a>{' '}
        for more on execution targets and resources.
      </p>

      <Button onClick={onContinue} className="self-start">
        <Check className="h-4 w-4" />
        Done
      </Button>
    </div>
  );
}
