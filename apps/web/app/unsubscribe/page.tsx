'use client';

import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Mail } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import React, { Suspense, useEffect, useState, useTransition } from 'react';

import { unsubscribeEmailAction } from '@/lib/actions/mailing-list';

function UnsubscribeContent() {
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  // If email is in URL, unsubscribe automatically on mount
  useEffect(() => {
    if (emailParam && emailParam.trim()) {
      setEmail(emailParam.trim());
      handleUnsubscribe(emailParam.trim());
    }
  }, [emailParam]);

  const handleUnsubscribe = async (emailToUnsub: string) => {
    if (!emailToUnsub || !emailToUnsub.trim()) return;
    setStatus('loading');
    setErrorMessage('');

    startTransition(async () => {
      const res = await unsubscribeEmailAction(emailToUnsub);
      if (res.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(res.error || 'Something went wrong. Please try again.');
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleUnsubscribe(email);
  };

  return (
    <div className="w-full max-w-md">
      <div className="relative overflow-hidden rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-lg backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60 dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        {/* Glow decorative element */}
        <div className="pointer-events-none absolute -top-12 -left-12 h-32 w-32 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-12 -bottom-12 h-32 w-32 rounded-full bg-indigo-500/10 blur-3xl" />

        {status === 'loading' && (
          <div className="flex flex-col items-center py-8">
            <Loader2 className="h-12 w-12 animate-spin text-sky-600 dark:text-sky-400" />
            <h2 className="mt-6 font-display text-xl font-semibold text-stone-900 dark:text-white">
              Unsubscribing
            </h2>
            <p className="mt-2 text-sm text-stone-600 dark:text-slate-400">
              Processing your unsubscribe request for
            </p>
            <p className="mt-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 font-mono text-xs font-semibold text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
              {email}
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center py-6">
            <div className="rounded-full border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/25 dark:bg-emerald-500/10">
              <CheckCircle2 className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h2 className="mt-6 font-display text-2xl font-bold text-stone-900 dark:text-white">
              Unsubscribed Successfully
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-stone-600 dark:text-slate-300">
              You have been successfully removed from the **Overlord** update mailing list. You will
              no longer receive emails about new feature releases.
            </p>
            <p className="mt-1 text-xs text-stone-500 dark:text-slate-500">
              Applied to:{' '}
              <span className="rounded bg-stone-100 px-2 py-0.5 font-mono text-stone-600 dark:bg-white/5 dark:text-slate-400">
                {email}
              </span>
            </p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row">
              <Link
                href="/"
                className="flex-1 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-stone-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
              >
                Go to Dashboard
              </Link>
              <Link
                href="/changelog"
                className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-900 transition-colors hover:bg-stone-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                Browse Changelog
              </Link>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center py-6">
            <div className="rounded-full border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/25 dark:bg-rose-500/10">
              <AlertTriangle className="h-12 w-12 text-rose-600 dark:text-rose-400" />
            </div>
            <h2 className="mt-6 font-display text-xl font-semibold text-stone-900 dark:text-white">
              Unsubscribe Failed
            </h2>
            <p className="mt-2 text-sm text-stone-600 dark:text-slate-300">{errorMessage}</p>
            <button
              onClick={() => setStatus('idle')}
              className="mt-6 w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-400"
            >
              Try Again
            </button>
          </div>
        )}

        {status === 'idle' && (
          <div>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-400">
              <Mail className="h-6 w-6" />
            </div>
            <h2 className="mt-6 font-display text-2xl font-bold tracking-tight text-stone-900 dark:text-white">
              Unsubscribe from Updates
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-slate-300">
              Enter your email address below to unsubscribe from **Overlord** feature updates and
              release newsletters.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 text-left">
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold tracking-wider text-stone-500 uppercase dark:text-slate-400"
                >
                  Email Address
                </label>
                <div className="relative mt-1.5">
                  <input
                    type="email"
                    name="email"
                    id="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="block w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 transition-all placeholder:text-stone-400 focus:border-sky-500 focus:bg-white focus:ring-1 focus:ring-sky-500 focus:outline-none dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder-slate-500 dark:focus:border-sky-500 dark:focus:bg-slate-900"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="mt-4 flex w-full cursor-pointer items-center justify-center rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_20px_rgba(14,165,233,0.3)] transition-all hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Unsubscribing...
                  </>
                ) : (
                  'Unsubscribe'
                )}
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="mt-8 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-stone-500 transition-colors hover:text-stone-900 dark:text-slate-400 dark:hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Overlord
        </Link>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <div className="relative min-h-dvh bg-[#f6f4ef] text-stone-900 dark:bg-[#020817] dark:text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[42rem] dark:block dark:bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%),radial-gradient(circle_at_50%_0%,_rgba(15,23,42,0.6),_transparent_52%),linear-gradient(180deg,rgba(15,23,42,0.85),rgba(2,8,23,0))]" />

      <div className="relative flex min-h-[85vh] flex-col items-center justify-center px-4 py-12">
        <div className="pointer-events-none absolute top-1/4 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-sky-500/10 to-indigo-500/10 blur-[100px]" />

        <header className="mb-8 text-center">
          <span className="font-mono text-xs font-semibold tracking-widest text-sky-600 uppercase dark:text-sky-400">
            Overlord
          </span>
        </header>

        <Suspense
          fallback={
            <div className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-8 text-center backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-sky-600 dark:text-sky-400" />
              <p className="mt-4 text-sm text-stone-600 dark:text-slate-400">Loading details...</p>
            </div>
          }
        >
          <UnsubscribeContent />
        </Suspense>
      </div>
    </div>
  );
}
