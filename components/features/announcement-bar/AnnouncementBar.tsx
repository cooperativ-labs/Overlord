'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';

const DISMISSAL_KEY = 'overlord-download-announcement-dismissed';

export function AnnouncementBar() {
  const [isVisible, setIsVisible] = useState(false);
  const { isElectron } = useElectron();

  useEffect(() => {
    // 1) Don't show in Electron
    if (isElectron) {
      return;
    }

    // 2) Check if dismissed
    const dismissed = localStorage.getItem(DISMISSAL_KEY);
    if (!dismissed) {
      setIsVisible(true);
    }
  }, [isElectron]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISSAL_KEY, 'true');
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="relative isolate flex items-center gap-x-6 overflow-hidden bg-muted px-6 py-2 sm:px-3.5 sm:before:flex-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm">
          <strong className="font-semibold">Overlord Desktop</strong>
          <svg
            viewBox="0 0 2 2"
            className="mx-2 inline h-0.5 w-0.5 fill-current"
            aria-hidden="true"
          >
            <circle cx={1} cy={1} r={1} />
          </svg>
          Experience local-first AI orchestration with our native desktop app.
        </p>
        <Link
          href="/downloads"
          className="flex-none rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Download now <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
      <div className="flex flex-1 justify-end">
        <button
          type="button"
          onClick={handleDismiss}
          className="-m-3 p-3 focus-visible:outline-offset-[-4px]"
        >
          <span className="sr-only">Dismiss</span>
          <X className="h-4 w-4 text-muted-foreground hover:text-foreground" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
