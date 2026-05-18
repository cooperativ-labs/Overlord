'use client';

import { X } from 'lucide-react';
import Image, { type StaticImageData } from 'next/image';
import { useEffect, useState } from 'react';

interface Props {
  src: StaticImageData | string;
  alt: string;
  /** Extra classes on the thumbnail wrapper */
  className?: string;
  /** Zoom factor applied to the thumbnail (crops via overflow). Defaults to 1. */
  thumbnailZoom?: number;
  /** Zoom factor applied to the main image (crops via overflow). Defaults to 1. */
  mainZoom?: number;
}

export function ImageLightbox({ src, alt, className, thumbnailZoom = 1, mainZoom = 1 }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const w = typeof src === 'string' ? 1920 : src.width;
  const h = typeof src === 'string' ? 1080 : src.height;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`group relative block overflow-hidden rounded-2xl border border-white/10 transition focus:outline-none hover:border-white/25 ${className ?? ''}`}
        aria-label={`Expand image: ${alt}`}
      >
        <span
          className="block transition duration-300 group-hover:brightness-110"
          style={
            thumbnailZoom !== 1
              ? { transform: `scale(${thumbnailZoom})`, transformOrigin: 'center' }
              : undefined
          }
        >
          <Image
            src={src}
            alt={alt}
            width={w}
            height={h}
            className="w-full h-auto transition duration-300 group-hover:scale-[1.02]"
            sizes="40vw"
          />
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <button
            onClick={() => setOpen(false)}
            className="absolute right-6 top-6 flex size-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20 p2k:size-14 p4k:size-20"
            aria-label="Close"
          >
            <X className="size-5 p2k:size-7 p4k:size-10" />
          </button>
          <div
            style={
              mainZoom !== 1
                ? { transform: `scale(${mainZoom})`, transformOrigin: 'center' }
                : undefined
            }
            className="relative"
            onClick={e => e.stopPropagation()}
          >
            <Image
              src={src}
              alt={alt}
              width={w}
              height={h}
              style={{ maxHeight: '90vh', maxWidth: '90vw', width: 'auto', height: 'auto' }}
              className="rounded-2xl"
            />
          </div>
        </div>
      )}
    </>
  );
}
