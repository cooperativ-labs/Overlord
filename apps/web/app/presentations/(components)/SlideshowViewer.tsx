'use client';

import { useCallback, useEffect, useState } from 'react';

import { SLIDESHOWS } from './registry';
import { SlideFrame } from './SlideFrame';
import { SlideNavControls } from './SlideNavControls';
import type { SlideshowDefinition } from './types';

interface Props {
  slug: string;
  initialSlide?: number;
}

export function SlideshowViewer({ slug, initialSlide = 1 }: Props) {
  const [definition, setDefinition] = useState<SlideshowDefinition | null>(null);

  useEffect(() => {
    const entry = SLIDESHOWS[slug];
    if (entry) entry.load().then(m => setDefinition(m.default));
  }, [slug]);

  const total = definition?.slides.length ?? 0;
  const [current, setCurrent] = useState(() => Math.max(1, initialSlide));

  const goTo = useCallback(
    (n: number) => {
      if (!total) return;
      const clamped = Math.max(1, Math.min(n, total));
      setCurrent(clamped);
      const url = new URL(window.location.href);
      url.searchParams.set('slide', String(clamped));
      window.history.replaceState(null, '', url.toString());
    },
    [total]
  );

  const prev = useCallback(() => goTo(current - 1), [current, goTo]);
  const next = useCallback(() => goTo(current + 1), [current, goTo]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'ArrowRight':
        case ' ':
        case 'PageDown':
          e.preventDefault();
          next();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          prev();
          break;
        case 'Home':
          e.preventDefault();
          goTo(1);
          break;
        case 'End':
          e.preventDefault();
          goTo(total);
          break;
        case 'f':
          if (document.fullscreenElement) {
            void document.exitFullscreen();
          } else {
            void document.documentElement.requestFullscreen();
          }
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, goTo, total]);

  if (!definition) {
    return <div className="fixed inset-0 z-40 bg-[#020817]" />;
  }

  const Slide = definition.slides[current - 1];

  return (
    <div className="fixed inset-0 z-40 bg-[#020817]">
      <SlideFrame Slide={Slide} slideNumber={current} total={total} />
      <SlideNavControls current={current} total={total} onPrev={prev} onNext={next} />
    </div>
  );
}
