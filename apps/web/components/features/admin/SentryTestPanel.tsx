'use client';

import * as Sentry from '@sentry/nextjs';
import { MonitorSmartphone, TriangleAlert, Wifi } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';

export function SentryTestPanel() {
  const { api, isElectron } = useElectron();
  const [webButtonState, setWebButtonState] = useState<ButtonLoadingState>('default');
  const [electronButtonState, setElectronButtonState] = useState<ButtonLoadingState>(
    isElectron ? 'default' : 'disabled'
  );

  async function handleWebTest() {
    setWebButtonState('loading');

    try {
      const eventId = Sentry.captureException(
        new Error(`Web app Sentry test event at ${new Date().toISOString()}`),
        {
          tags: {
            source: 'admin-sentry-test',
            target: 'web-client'
          }
        }
      );

      await Sentry.flush(2_000);
      setWebButtonState('success');
      toast.success(eventId ? `Sent web app test event: ${eventId}` : 'Sent web app test event.');
    } catch (error) {
      setWebButtonState('error');
      toast.error(error instanceof Error ? error.message : 'Failed to send web app test event.');
    }
  }

  async function handleElectronTest() {
    if (!isElectron || !api?.app?.captureSentryTestEvent) {
      setElectronButtonState('error');
      toast.error('Electron test events are only available inside the desktop app.');
      return;
    }

    setElectronButtonState('loading');

    try {
      const result = await api.app.captureSentryTestEvent();

      if (!result.ok) {
        throw new Error('Electron main process did not confirm the Sentry test event.');
      }

      setElectronButtonState('success');
      toast.success(
        result.eventId ? `Sent Electron test event: ${result.eventId}` : 'Sent Electron test event.'
      );
    } catch (error) {
      setElectronButtonState('error');
      toast.error(error instanceof Error ? error.message : 'Failed to send Electron test event.');
    }
  }

  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Sentry</h2>
          <p className="text-sm text-slate-600">
            Send explicit test events to confirm the web app and Electron app are both reporting.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white p-2 text-sky-600 shadow-sm">
                <Wifi className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Web app</h3>
                <p className="text-xs text-slate-600">Captures a browser-side Sentry exception.</p>
              </div>
            </div>
            <div className="mt-4">
              <LoadingButton
                buttonState={webButtonState}
                setButtonState={setWebButtonState}
                text="Send web test event"
                loadingText="Sending web event..."
                successText="Web event sent"
                errorText="Web event failed"
                reset
                onClick={handleWebTest}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white p-2 text-emerald-600 shadow-sm">
                <MonitorSmartphone className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Electron app</h3>
                <p className="text-xs text-slate-600">
                  Sends a test exception from the Electron main process.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <LoadingButton
                buttonState={electronButtonState}
                setButtonState={setElectronButtonState}
                text="Send Electron test event"
                loadingText="Sending Electron event..."
                successText="Electron event sent"
                errorText="Electron event failed"
                reset
                disabled={!isElectron}
                onClick={handleElectronTest}
              />
            </div>
            {!isElectron ? (
              <p className="mt-3 flex items-start gap-2 text-xs text-amber-700">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Open this page inside the desktop app to test the Electron Sentry pipeline.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
