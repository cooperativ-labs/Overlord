'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function SlideNavControls({ current, total, onPrev, onNext }: Props) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full border border-white/10 bg-black/40 px-5 py-2.5 text-white backdrop-blur-md p2k:bottom-10 p2k:gap-6 p2k:px-8 p2k:py-4 p4k:bottom-16 p4k:gap-10 p4k:px-12 p4k:py-6">
      <button
        onClick={onPrev}
        disabled={current <= 1}
        className="flex size-7 items-center justify-center rounded-full transition hover:bg-white/10 disabled:opacity-30 p2k:size-10 p4k:size-14"
        aria-label="Previous slide"
      >
        <ChevronLeft className="size-4 p2k:size-6 p4k:size-9" />
      </button>
      <span className="font-mono text-sm tabular-nums text-slate-300 p2k:text-xl p4k:text-3xl">
        {current} / {total}
      </span>
      <button
        onClick={onNext}
        disabled={current >= total}
        className="flex size-7 items-center justify-center rounded-full transition hover:bg-white/10 disabled:opacity-30 p2k:size-10 p4k:size-14"
        aria-label="Next slide"
      >
        <ChevronRight className="size-4 p2k:size-6 p4k:size-9" />
      </button>
    </div>
  );
}
