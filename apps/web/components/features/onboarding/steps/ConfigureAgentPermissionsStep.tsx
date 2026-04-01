'use client';

import { CheckCircle2, CircleAlert, Shield } from 'lucide-react';
import { useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Props = {
  onContinue: () => void;
  projectDirectory?: string;
};

type PermissionResult = {
  agent: 'claude' | 'cursor' | 'gemini' | 'opencode';
  ok: boolean;
  filePath: string;
  details: string;
  backups: string[];
  error?: string;
};

const AGENT_LABELS: Record<PermissionResult['agent'], string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode'
};

export function ConfigureAgentPermissionsStep({ onContinue, projectDirectory }: Props) {
  const { isElectron } = useElectron();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<PermissionResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function configurePermissions() {
    if (!isElectron || !window.electronAPI?.agentPermissions) return;

    setRunning(true);
    setError(null);

    try {
      const response = await window.electronAPI.agentPermissions.configure({ projectDirectory });
      setResults(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to configure agent permissions.');
    } finally {
      setRunning(false);
    }
  }

  const hasSuccess = results?.some(result => result.ok) ?? false;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Configure agent permissions</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Overlord can pre-approve `ovld protocol` and `curl -sS -X POST` protocol calls so agents
          can sync ticket state without repeated prompts.
        </p>
      </div>

      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          This grants broad command permissions in your local agent configs. Review the generated
          rules if you want tighter constraints.
        </AlertDescription>
      </Alert>

      {results ? (
        <div className="space-y-2">
          {results.map(result => (
            <div
              key={result.agent}
              className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-3"
            >
              <div className="grid gap-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium">{AGENT_LABELS[result.agent]}</p>
                  {result.ok ? (
                    <Badge className="bg-green-600 text-xs text-white">Configured</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-xs">
                      Failed
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{result.details}</p>
                <p className="text-xs text-muted-foreground">{result.filePath}</p>
                {result.error ? <p className="text-xs text-destructive">{result.error}</p> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={running}
          onClick={() => void configurePermissions()}
        >
          {running
            ? 'Configuring…'
            : hasSuccess
              ? 'Reconfigure permissions'
              : 'Configure permissions'}
        </Button>
        <Button type="button" onClick={onContinue}>
          <CheckCircle2 className="h-4 w-4" />
          Continue
        </Button>
      </div>
    </div>
  );
}
