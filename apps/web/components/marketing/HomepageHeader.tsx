import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { MarketingThemeToggle } from '@/components/marketing/MarketingThemeToggle';
import { Button } from '@/components/ui/button';

export function HomepageHeader() {
  return (
    <header className="animate-in fade-in slide-in-from-top-4 mt-5 flex items-center justify-between rounded-[2rem] border border-stone-200/90 bg-white/80 px-5 py-4 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-[0_20px_80px_-48px_rgba(15,23,42,0.75)]">
      <Link
        href="/"
        className="flex items-center gap-3 rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 dark:focus-visible:outline-white/50 sm:gap-4"
      >
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg sm:size-11 sm:rounded-full">
          <Image
            src="/images/256.png"
            alt="Overlord logo"
            width={45}
            height={50}
            className="shrink-0 overflow-hidden"
          />
        </div>
        <p className="font-display hidden text-lg font-semibold tracking-tight text-stone-900 sm:block dark:text-white">
          Overlord
        </p>
      </Link>

      <div className="flex items-center gap-1 sm:gap-3">
        <Button
          asChild
          variant="ghost"
          className="hidden text-stone-600 hover:bg-stone-200/80 hover:text-stone-900 sm:inline-flex dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
        >
          <Link href="/docs">Docs</Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          className="hidden text-stone-600 hover:bg-stone-200/80 hover:text-stone-900 sm:inline-flex dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
        >
          <Link href="/compare">Compare</Link>
        </Button>
        <MarketingThemeToggle />
        <Button
          asChild
          variant="ghost"
          className="hidden text-stone-600 hover:bg-stone-200/80 hover:text-stone-900 sm:inline-flex dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
        >
          <Link href="/login">Sign in</Link>
        </Button>
        <Button
          asChild
          size="sm"
          className="rounded-full bg-stone-900 px-4 text-sm whitespace-nowrap text-[#fafaf7] hover:bg-stone-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
        >
          <Link href="/signup">
            Create Account
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </header>
  );
}
