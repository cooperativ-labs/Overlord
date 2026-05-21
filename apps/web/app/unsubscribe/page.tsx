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
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 p-8 text-center backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        {/* Glow decorative element */}
        <div className="absolute -top-12 -left-12 h-32 w-32 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

        {status === 'loading' && (
          <div className="py-8 flex flex-col items-center">
            <Loader2 className="h-12 w-12 text-sky-400 animate-spin" />
            <h2 className="mt-6 font-display text-xl font-semibold text-white">Unsubscribing</h2>
            <p className="mt-2 text-sm text-slate-400">Processing your unsubscribe request for</p>
            <p className="mt-1 font-mono text-xs text-sky-300 font-semibold bg-sky-500/10 px-3 py-1 rounded-full border border-sky-500/20">
              {email}
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="py-6 flex flex-col items-center">
            <div className="rounded-full bg-emerald-500/10 p-3 border border-emerald-500/25">
              <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            </div>
            <h2 className="mt-6 font-display text-2xl font-bold text-white">
              Unsubscribed Successfully
            </h2>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed">
              You have been successfully removed from the **Overlord** update mailing list. You will
              no longer receive emails about new feature releases.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Applied to:{' '}
              <span className="font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded">
                {email}
              </span>
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full">
              <Link
                href="/"
                className="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-colors shadow-sm"
              >
                Go to Dashboard
              </Link>
              <Link
                href="/changelog"
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
              >
                Browse Changelog
              </Link>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="py-6 flex flex-col items-center">
            <div className="rounded-full bg-rose-500/10 p-3 border border-rose-500/25">
              <AlertTriangle className="h-12 w-12 text-rose-400" />
            </div>
            <h2 className="mt-6 font-display text-xl font-semibold text-white">
              Unsubscribe Failed
            </h2>
            <p className="mt-2 text-sm text-slate-300">{errorMessage}</p>
            <button
              onClick={() => setStatus('idle')}
              className="mt-6 w-full rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {status === 'idle' && (
          <div>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <Mail className="h-6 w-6" />
            </div>
            <h2 className="mt-6 font-display text-2xl font-bold tracking-tight text-white">
              Unsubscribe from Updates
            </h2>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              Enter your email address below to unsubscribe from **Overlord** feature updates and
              release newsletters.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 text-left">
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold text-slate-400 uppercase tracking-wider"
                >
                  Email Address
                </label>
                <div className="mt-1.5 relative">
                  <input
                    type="email"
                    name="email"
                    id="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="block w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="mt-4 flex w-full items-center justify-center rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 transition-all cursor-pointer shadow-[0_4px_20px_rgba(14,165,233,0.3)] disabled:opacity-50"
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
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Overlord
        </Link>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <div className="relative flex min-h-[85vh] flex-col items-center justify-center px-4 py-12">
      {/* Dynamic background decoration */}
      <div className="absolute top-1/4 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-sky-500/10 to-indigo-500/10 blur-[100px] pointer-events-none" />

      <header className="mb-8 text-center">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-sky-400">
          Overlord
        </span>
      </header>

      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/60 p-8 text-center backdrop-blur-xl">
            <Loader2 className="mx-auto h-10 w-10 text-sky-400 animate-spin" />
            <p className="mt-4 text-sm text-slate-400">Loading details...</p>
          </div>
        }
      >
        <UnsubscribeContent />
      </Suspense>
    </div>
  );
}
