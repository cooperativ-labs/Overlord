import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { getDesktopBridge } from '@/lib/desktop-chrome';

export function DiagnosticsPage() {
  const diagnostics = getDesktopBridge()?.diagnostics;
  const [status, setStatus] = useState<DesktopPerformanceCaptureStatus>({
    state: 'idle',
    endsAt: null,
    message: null
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!diagnostics) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const next = await diagnostics.getStatus();
        if (!active) return;
        setStatus(next);
        if (next.state === 'recording') timer = setTimeout(refresh, 1000);
      } catch {
        if (active) setError('Could not read recording status.');
      }
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [diagnostics, status.state]);

  async function record() {
    if (!diagnostics) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await diagnostics.record());
    } catch {
      setError('Could not start recording.');
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    try {
      if (!(await diagnostics?.reveal())) setError('No completed capture is available.');
    } catch {
      setError('Could not reveal the capture.');
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="text-base font-medium">Diagnostics</h2>
        <p className="text-sm text-muted-foreground">
          Record a performance capture while Overlord is using too much CPU.
        </p>
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Recording lasts 15 seconds. Return to the affected screen and use the app normally;
          recording continues when you close Settings. It saves JavaScript and rendering activity,
          process CPU, and memory on this computer. Nothing is uploaded.
        </p>
        <p className="text-sm text-muted-foreground">
          Captures may contain URLs and function names. Inspect the files before sharing them. Each
          recording replaces the previous capture. Close DevTools before recording.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void record()}
            disabled={!diagnostics || busy || status.state === 'recording'}
          >
            {status.state === 'recording' ? 'Recording…' : 'Record 15 seconds'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void reveal()}
            disabled={status.state !== 'ready'}
          >
            Show capture files
          </Button>
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {error ??
            status.message ??
            (diagnostics ? 'Ready to record.' : 'Update the desktop app to enable recording.')}
        </p>
      </div>
    </div>
  );
}
