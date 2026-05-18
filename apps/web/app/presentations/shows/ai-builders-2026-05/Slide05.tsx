import { ImageLightbox } from '../../(components)/ImageLightbox';

export default function Slide05() {
  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[#020817] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%)]" />

      {/* Left: text content */}
      <div className="relative z-10 flex flex-1 flex-col justify-center px-20 lg:px-32 p1080:px-40 p2k:px-56 p4k:px-80">
        <p className="mb-6 font-mono text-lg uppercase tracking-widest text-sky-400 p2k:text-2xl p4k:text-4xl">
          Never reinvent 2
        </p>
        <h2 className="font-display text-7xl font-semibold leading-none tracking-tight lg:text-8xl p1080:text-9xl p2k:text-[11rem] p4k:text-[15rem]">
          Don't build chat
        </h2>

        <div className="mt-14 space-y-6 p4k:space-y-10">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-10 py-8 p2k:px-14 p2k:py-10 p4k:px-20 p4k:py-14">
            <p className="mb-2 font-mono text-base uppercase tracking-widest text-sky-400 p2k:text-xl p4k:text-3xl">
              The reality
            </p>
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              The people sometimes want to use the desktop chat apps.
            </p>
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              Give the people what they want.
            </p>
          </div>

          <div className="rounded-3xl border border-sky-400/20 bg-sky-400/5 px-10 py-8 p2k:px-14 p2k:py-10 p4k:px-20 p4k:py-14">
            <p className="mb-2 font-mono text-base uppercase tracking-widest text-sky-400 p2k:text-xl p4k:text-3xl">
              The opportunity
            </p>
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              Build plugins that give agents that just tell them how to use your CLI.
            </p>
            <ul className="mt-4 list-disc space-y-2 pl-8 text-2xl leading-snug text-slate-300 marker:text-sky-400/80 p2k:mt-5 p2k:pl-10 p2k:text-3xl p4k:mt-6 p4k:space-y-3 p4k:pl-14 p4k:text-5xl">
              <li>Doesn&apos;t bloat each prompt.</li>
              <li>Agents actually do what they are told (usually)</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Right: codex plugin screenshot */}
      <div className="relative z-10 flex w-[38%] flex-col items-center justify-center p-10 p2k:p-16 p4k:p-24 shrink-0">
        <ImageLightbox
          src="/images/screenshots/codex-plugin-screenshot.png"
          alt="Codex plugin screenshot"
          className="w-full"
          thumbnailZoom={1.1}
          mainZoom={1.2}
        />
      </div>
    </div>
  );
}
