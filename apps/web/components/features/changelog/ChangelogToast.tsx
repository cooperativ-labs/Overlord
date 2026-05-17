'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { markChangelogAsReadAction } from '@/lib/actions/changelog';
import { cn } from '@/lib/utils';

type ToastEntry = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  published_at: string | null;
};

type Props = {
  entries: ToastEntry[];
};

export function ChangelogToast({ entries }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [, startTransition] = useTransition();

  const entry = entries[0] ?? null;

  // Fade-in on mount.
  useEffect(() => {
    if (!entry) return;
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, [entry]);

  // Dismiss when user navigates away.
  useEffect(() => {
    if (pathname?.startsWith('/changelog')) {
      setDismissed(true);
    }
  }, [pathname]);

  if (!entry || dismissed) return null;

  function markRead() {
    startTransition(() => {
      markChangelogAsReadAction().catch(() => {
        // best-effort; toast still dismisses locally
      });
    });
  }

  function handleReadMore() {
    markRead();
    setDismissed(true);
    router.push(`/changelog/${entry!.slug}`);
  }

  function handleDismiss() {
    setDismissed(true);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-4 left-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl transition-all duration-300',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-sky-600">
          📰 What&apos;s new
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-950">{entry.title}</div>
      {entry.summary ? (
        <p className="mt-1 line-clamp-3 text-xs text-slate-600">{entry.summary}</p>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleReadMore}
          className="text-xs font-semibold text-sky-700 hover:text-sky-900"
        >
          Read more →
        </button>
        <Link
          href="/changelog"
          onClick={() => {
            markRead();
            setDismissed(true);
          }}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          All updates
        </Link>
      </div>
    </div>
  );
}
