export default function Slide04() {
  return (
    <div className="relative flex h-full w-full flex-col justify-center overflow-hidden bg-[#020817] px-20 text-white lg:px-32 p1080:px-40 p2k:px-56 p4k:px-80">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%)]" />

      <div className="relative z-10">
        <p className="mb-6 font-mono text-lg uppercase tracking-widest text-sky-400 p2k:text-2xl p4k:text-4xl">
          Never reinvent 1
        </p>
        <h2 className="font-display text-7xl font-semibold leading-none tracking-tight lg:text-8xl p1080:text-9xl p2k:text-[11rem] p4k:text-[15rem]">
          Don't build a harness
        </h2>

        <div className="mt-14 grid grid-cols-3 gap-6 p4k:gap-10">
          {/* Principle */}
          <div className="flex flex-col  gap-4 rounded-3xl border border-sky-400/30 bg-sky-500/[0.08] p-8 p2k:p-10 p4k:p-14">
            <p className="mb-4 font-mono text-xs uppercase tracking-widest text-sky-400 p2k:text-base p4k:text-2xl">
              Principle
            </p>
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              No agent work is done inside Overlord.
            </p>
            <div className="h-px bg-white/10" />

            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              It&apos;s really just a GUI for a CLI that tickles the agents.
            </p>
          </div>

          {/* Product decisions */}
          <div className="flex flex-col gap-4 rounded-3xl border border-violet-400/30 bg-violet-500/[0.08] p-8 p2k:p-10 p4k:p-14">
            <p className="font-mono text-xs uppercase tracking-widest text-violet-300 p2k:text-base p4k:text-2xl">
              Product decisions
            </p>
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              A separate CLI subcommand for agents.{' '}
              <code className="px-4 py-1 rounded-md text-orange-400 text-xl bg-zinc-700">
                ovld protocol
              </code>
            </p>
            <div className="h-px bg-white/10" />
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              Rides on top of your existing Codex or Claude Code plan
            </p>
          </div>

          {/* Benefits */}
          <div className="flex flex-col gap-4 rounded-3xl border border-emerald-400/30 bg-emerald-500/[0.08] p-8 p2k:p-10 p4k:p-14">
            <p className="font-mono text-xs uppercase tracking-widest text-emerald-300 p2k:text-base p4k:text-2xl">
              Benefits
            </p>
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              VC-subsidized tokens{' '}
            </p>
            <div className="h-px bg-white/10" />

            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              Keeps users' existing config, permissions, and tools.
            </p>

            <div className="h-px bg-white/10" />
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              Immediately benefit from new features from the frontier labs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
