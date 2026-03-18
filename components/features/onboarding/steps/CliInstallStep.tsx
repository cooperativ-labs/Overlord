'use client';

import { CheckCircle2, TerminalSquare } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';

type Props = {
  onContinue: () => void;
};

export function CliInstallStep({ onContinue }: Props) {
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliInstallPath, setCliInstallPath] = useState<string | null>(null);
  const [cliIsStale, setCliIsStale] = useState(false);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliMessage, setCliMessage] = useState<string | null>(null);
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

  useEffect(() => {
    if (!window.electronAPI?.cli) return;

    void window.electronAPI.cli
      .getInstallStatus()
      .then(({ installed, installPath, isStale, version }) => {
        setCliInstalled(installed);
        setCliInstallPath(installPath ?? null);
        setCliIsStale(isStale ?? false);
        setCliVersion(version);
      })
      .catch(() => {
        setCliMessage('Could not read the current CLI install status.');
      });
  }, []);

  async function handleInstallCli() {
    if (!window.electronAPI?.cli) return;

    setButtonState('loading');
    setCliMessage(null);

    try {
      const result = await window.electronAPI.cli.install();
      if (result.ok) {
        setButtonState('success');
        setCliInstalled(true);
        setCliInstallPath(result.installPath);
        setCliMessage(result.pathInstruction);
        setCliIsStale(false);
        return;
      }

      setButtonState('error');
      setCliMessage(result.error);
    } catch (error) {
      setButtonState('error');
      setCliMessage(error instanceof Error ? error.message : 'Install failed');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Install the Overlord CLI</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          The desktop app can install `ovld` for you so terminal agents can attach to tickets, sync
          progress, and deliver work back to Overlord from any repository.
        </p>
      </div>

      <div className="rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
            <TerminalSquare className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">What `ovld` gives you</p>
            <ul className="text-muted-foreground space-y-1 text-sm">
              <li>Attach to tickets directly from your repo.</li>
              <li>Send progress updates and final delivery from the terminal.</li>
              <li>Launch and resume local agent sessions with project context.</li>
            </ul>
          </div>
        </div>
      </div>

      {cliInstalled && !cliIsStale ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            {`ovld${cliVersion ? ` v${cliVersion}` : ''} is installed${cliInstallPath ? ` at ${cliInstallPath}` : ''}.`}
            {cliMessage ? ` ${cliMessage}` : ''}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertDescription>
            {cliIsStale
              ? 'Your installed CLI wrapper points to an older app location. Reinstall it before continuing.'
              : 'Install the bundled CLI now so agent commands work without additional setup later.'}
          </AlertDescription>
        </Alert>
      )}

      {cliMessage && (!cliInstalled || cliIsStale) ? (
        <Alert variant="destructive">
          <AlertDescription>{cliMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {!cliInstalled || cliIsStale ? (
          <LoadingButton
            buttonState={buttonState}
            setButtonState={setButtonState}
            text={cliIsStale ? 'Reinstall CLI' : 'Install CLI'}
            loadingText={cliIsStale ? 'Reinstalling…' : 'Installing…'}
            successText={cliIsStale ? 'Reinstalled' : 'Installed'}
            errorText="Retry"
            reset
            onClick={handleInstallCli}
          />
        ) : null}
        <Button variant={cliInstalled && !cliIsStale ? 'default' : 'outline'} onClick={onContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
