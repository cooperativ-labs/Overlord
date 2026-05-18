export default function Slide07() {
  return (
    <div className="relative flex h-full w-full flex-col justify-center overflow-hidden bg-[#020817] px-20 text-white lg:px-32 p1080:px-40 p2k:px-56 p4k:px-80">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%)]" />

      <div className="relative z-10">
        <p className="mb-6 font-mono text-lg uppercase tracking-widest text-red-400 p2k:text-2xl p4k:text-4xl">
          Challenges
        </p>
        <h2 className="font-display text-7xl font-semibold leading-none tracking-tight lg:text-8xl p1080:text-9xl p2k:text-[11rem] p4k:text-[15rem]">
          The hard parts
        </h2>

        <div className="mt-14 grid grid-cols-3 gap-8 p2k:gap-12 p4k:gap-16">
          <div className="rounded-3xl border border-red-400/20 bg-red-400/5 p-10 p2k:p-14 p4k:p-20">
            <p className="mb-5 font-mono text-base uppercase tracking-widest text-red-400 p2k:text-xl p4k:text-3xl">
              Agent Plugins
            </p>
            <ul className="space-y-4 text-xl leading-snug text-slate-300 p2k:text-2xl p4k:text-4xl p2k:space-y-6 p4k:space-y-8">
              <li>Inconsistency with hooks, permissions, &amp; even effort flags</li>
              <li>Keeping them updated requires user involvement</li>
              <li>Terrible permissions control</li>
            </ul>
          </div>
          <div className="rounded-3xl border border-orange-400/20 bg-orange-400/5 p-10 p2k:p-14 p4k:p-20">
            <p className="mb-5 font-mono text-base uppercase tracking-widest text-orange-400 p2k:text-xl p4k:text-3xl">
              MCP
            </p>
            <ul className="space-y-4 text-xl leading-snug text-slate-300 p2k:text-2xl p4k:text-4xl p2k:space-y-6 p4k:space-y-8">
              <li>Not consistently implemented across services</li>
              <li>Works in ChatGPT, but not Codex cloud (?)</li>
              <li>Works in Claude Chat, but not Claude Code</li>
            </ul>
          </div>
          <div className="rounded-3xl border border-yellow-400/20 bg-yellow-400/5 p-10 p2k:p-14 p4k:p-20">
            <p className="mb-5 font-mono text-base uppercase tracking-widest text-yellow-400 p2k:text-xl p4k:text-3xl">
              CLI
            </p>
            <ul className="space-y-4 text-xl leading-snug text-slate-300 p2k:text-2xl p4k:text-4xl p2k:space-y-6 p4k:space-y-8">
              <li>Creates and obstacle to normie adoption</li>
              <li>Might be a security issue for less technical users</li>
              <li>Some terminal applications are flaky</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
