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

        <div className="mt-14 space-y-6 p4k:space-y-10">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-10 py-8 p2k:px-14 p2k:py-10 p4k:px-20 p4k:py-14">
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              No agent work is done inside Overlord. It&apos;s really just a GUI for a CLI that
              drives the agents.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-10 py-8 p2k:px-14 p2k:py-10 p4k:px-20 p4k:py-14">
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              A separate CLI for agents — who are sometimes working with different information and
              who don&apos;t mind a good text dump.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-10 py-8 p2k:px-14 p2k:py-10 p4k:px-20 p4k:py-14">
            <p className="text-2xl leading-snug text-slate-200 p2k:text-3xl p4k:text-5xl">
              Rides on top of your existing Codex or Claude Code subscription — no new subscription,
              no new harness.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
