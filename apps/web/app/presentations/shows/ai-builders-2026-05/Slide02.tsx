import { ImageLightbox } from '../../(components)/ImageLightbox';
import packedTerminal from '../../assets/images/packed-terminal.png';

export default function Slide02() {
  return (
    <div className="relative flex h-full w-full overflow-hidden bg-[#020817] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%)]" />

      {/* Left: text content */}
      <div className="relative z-10 flex flex-1 flex-col justify-center px-20 lg:px-32 p1080:px-40 p2k:px-56 p4k:px-80">
        <p className="mb-6 font-mono text-lg uppercase tracking-widest text-sky-400 p2k:text-2xl p4k:text-4xl">
          The two big problems
        </p>
        <h2 className="font-display text-7xl font-semibold leading-none tracking-tight lg:text-8xl p1080:text-9xl p2k:text-[11rem] p4k:text-[15rem]">
          Organization &amp;
          <br />
          Awareness
        </h2>

        <div className="mt-10 space-y-5 p2k:mt-14 p2k:space-y-7 p4k:mt-20 p4k:space-y-10">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 p2k:p-12 p4k:p-16">
            <p className="mb-2 font-mono text-base uppercase tracking-widest text-red-400 p2k:text-xl p4k:text-3xl">
              Problem 1 — Organization
            </p>
            <p className="text-2xl leading-snug text-slate-300 p2k:text-3xl p4k:text-5xl">
              Prompts scattered across chats, terminals, and other tools. No durable record of what
              was asked.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 p2k:p-12 p4k:p-16">
            <p className="mb-2 font-mono text-base uppercase tracking-widest text-orange-400 p2k:text-xl p4k:text-3xl">
              Problem 2 — Awareness
            </p>
            <p className="text-2xl leading-snug text-slate-300 p2k:text-3xl p4k:text-5xl">
              No efficient way to know what agents changed, why they changed it, or how to resume
              work later.
            </p>
          </div>
        </div>
      </div>

      {/* Right: terminal screenshot */}
      <div className="relative z-10 flex w-[38%] flex-col items-center justify-center p-10 p2k:p-16 p4k:p-24 shrink-0">
        <ImageLightbox
          src={packedTerminal}
          alt="Packed terminal showing agent output"
          className="w-full"
        />
      </div>
    </div>
  );
}
