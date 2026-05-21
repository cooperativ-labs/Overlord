'use client';

import { useEffect, useState } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  type ChangelogEntry,
  getPublishedChangelogEntryByVersionAction,
  markChangelogAsReadAction
} from '@/lib/actions/changelog';

const SETTINGS_KEY = 'lastSeenAppVersion';

/**
 * Shows the published changelog for the installed desktop app version after an update.
 *
 * Detection model: compare `app.getVersion()` to stored `lastSeenAppVersion`. When they
 * differ, load the published entry whose `version` matches the installed app version and
 * show it. Persist the version only after the user dismisses the modal so a matching
 * entry published later can still surface.
 *
 * Web is a no-op: `window.electronAPI` is undefined off-desktop.
 */
export function ChangelogUpdateModal() {
  const [entry, setEntry] = useState<ChangelogEntry | null>(null);
  const [open, setOpen] = useState(false);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);

  useEffect(() => {
    const electronAPI = (
      window as typeof window & { electronAPI?: { app?: { getVersion?: () => Promise<string> } } }
    ).electronAPI;
    if (!electronAPI?.app?.getVersion) return;

    let cancelled = false;

    (async () => {
      try {
        const settings = (
          window as typeof window & {
            electronAPI?: {
              settings?: {
                get: (key: string) => Promise<unknown>;
                set: (key: string, value: unknown) => Promise<unknown>;
              };
            };
          }
        ).electronAPI?.settings;

        const currentVersion = await electronAPI.app!.getVersion!();
        const stored = (await settings?.get(SETTINGS_KEY)) as string | undefined;

        if (stored === currentVersion) return;

        const matching = await getPublishedChangelogEntryByVersionAction(currentVersion);
        if (cancelled) return;

        if (matching) {
          setInstalledVersion(currentVersion);
          setEntry(matching);
          setOpen(true);
        }
      } catch {
        // best-effort; modal stays closed
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleClose() {
    setOpen(false);
    try {
      await markChangelogAsReadAction();
    } catch {
      // best-effort
    }

    if (!installedVersion) return;

    try {
      const settings = (
        window as typeof window & {
          electronAPI?: {
            settings?: { set: (key: string, value: unknown) => Promise<unknown> };
          };
        }
      ).electronAPI?.settings;
      await settings?.set(SETTINGS_KEY, installedVersion);
    } catch {
      // best-effort
    }
  }

  if (!entry) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) void handleClose();
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="text-xs font-semibold uppercase tracking-wider text-sky-600">
            What&apos;s new
          </div>
          <DialogTitle>{entry.title}</DialogTitle>
          {entry.summary ? <DialogDescription>{entry.summary}</DialogDescription> : null}
        </DialogHeader>
        <div className="mt-4">
          <MarkdownContent>{entry.body_markdown}</MarkdownContent>
        </div>
        <DialogFooter>
          <Button onClick={handleClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
