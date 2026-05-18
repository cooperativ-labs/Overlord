import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

const askAboutOverlordHref = `https://chatgpt.com/?q=${encodeURIComponent(
  'Tell me what Overlord is, who it is for, and when I should use it. Use this public context page as your source: https://www.ovld.ai/overlord-context'
)}`;

export function HomepageHeader() {
  return (
    <header className="animate-in fade-in slide-in-from-top-4 mt-5 flex items-center justify-between rounded-[2rem] border border-white/10 bg-white/5 px-5 py-4 shadow-[0_20px_80px_-48px_rgba(15,23,42,0.75)] backdrop-blur">
      <Link
        href="/"
        className="flex items-center gap-4 rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50"
      >
        <div className="flex size-11 items-center justify-center overflow-hidden rounded-full">
          <Image
            src="/images/256.png"
            alt="Overlord logo"
            width={45}
            height={50}
            className="shrink-0 overflow-hidden"
          />
        </div>
        <p className="font-display hidden text-lg font-semibold sm:block">Overlord</p>
      </Link>

      <div className="flex items-center gap-3">
        <Button
          asChild
          variant="ghost"
          className="hidden text-slate-300 hover:bg-white/5 hover:text-white md:inline-flex"
        >
          <a href={askAboutOverlordHref} target="_blank" rel="noopener noreferrer">
            Ask about Overlord
          </a>
        </Button>
        <Button
          asChild
          variant="ghost"
          className="hidden text-slate-300 hover:bg-white/5 hover:text-white sm:inline-flex"
        >
          <Link href="/login">Sign in</Link>
        </Button>
        <Button
          asChild
          size="sm"
          className="rounded-full bg-white px-4 text-sm whitespace-nowrap text-slate-950 hover:bg-slate-100"
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
