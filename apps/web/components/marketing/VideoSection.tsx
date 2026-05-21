'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

const videos = [
  {
    src: 'https://www.youtube.com/embed/aaKTqO1sRxY?si=b5sbaeu1f1vI-s90',
    title: 'Overlord Overview',
    thumbnail: 'https://img.youtube.com/vi/aaKTqO1sRxY/maxresdefault.jpg'
  },
  {
    src: 'https://www.youtube.com/embed/BFc41HEkmZY?si=XvZ-GeisnQaGN9ZV',
    title: 'The Feed',
    thumbnail: 'https://img.youtube.com/vi/BFc41HEkmZY/maxresdefault.jpg'
  },
  {
    src: 'https://www.youtube.com/embed/aaKTqO1sRxY?si=b5sbaeu1f1vI-s90',
    title: 'Creating tickets',
    thumbnail: 'https://img.youtube.com/vi/aaKTqO1sRxY/maxresdefault.jpg'
  },
  {
    src: 'https://www.youtube.com/embed/yh_gEs5RYCE?si=46w4pMVDCAJwoSUc',
    title: 'Configuring Overlord',
    thumbnail: 'https://img.youtube.com/vi/yh_gEs5RYCE/maxresdefault.jpg'
  }
];

interface VideoThumbnailProps {
  video: (typeof videos)[number];
  onClick: () => void;
  large?: boolean;
}

function VideoThumbnail({ video, onClick, large }: VideoThumbnailProps) {
  return (
    <button
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-[1.5rem] border border-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-white/10"
      aria-label={`Play ${video.title}`}
    >
      <div className={`aspect-video w-full ${large ? '' : 'rounded-[1.25rem]'}`}>
        <img
          src={video.thumbnail}
          alt={video.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/20">
          <div className="flex size-14 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20 backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
            <svg className="ml-1 size-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        {large && (
          <div className="absolute bottom-4 left-4">
            <span className="rounded-full bg-black/50 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm">
              {video.title}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

export function VideoSection() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setActiveIndex(null);
    }
    if (activeIndex !== null) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [activeIndex]);

  const activeVideo = activeIndex !== null ? videos[activeIndex] : null;

  return (
    <>
      <div className="rounded-[2rem] border border-stone-200 bg-white p-3 shadow-md backdrop-blur dark:border-white/10 dark:bg-white/[0.03] dark:shadow-[0_24px_96px_-56px_rgba(14,165,233,0.4)]">
        <div className="mb-4 px-3 pt-3 text-center">
          <p className="font-mono text-[14px] font-medium uppercase tracking-widest text-sky-400">
            See it in action
          </p>
        </div>

        <VideoThumbnail video={videos[0]} onClick={() => setActiveIndex(0)} large />

        <div className="mt-3 grid grid-cols-3 gap-3">
          {videos.slice(1).map((video, i) => (
            <button
              key={video.title}
              onClick={() => setActiveIndex(i + 1)}
              className="group relative overflow-hidden rounded-[1.25rem] border border-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-white/10"
              aria-label={`Play ${video.title}`}
            >
              <div className="aspect-video w-full">
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 transition-colors group-hover:bg-black/20">
                  <div className="flex size-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20 backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
                    <svg
                      className="ml-0.5 size-4 text-white"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  <span className="mt-6 px-2 text-center text-base font-medium text-white/80">
                    {video.title}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {activeVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setActiveIndex(null)}
        >
          <div className="relative w-full max-w-8xl px-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setActiveIndex(null)}
              className="absolute -top-10 right-4 flex size-8 items-center justify-center rounded-full bg-white/10 text-white/70 ring-1 ring-white/20 transition-colors hover:bg-white/20 hover:text-white"
              aria-label="Close video"
            >
              <X className="size-4" />
            </button>
            <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl">
              <div className="aspect-video w-full">
                <iframe
                  src={`${activeVideo.src}&autoplay=1`}
                  title={activeVideo.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
