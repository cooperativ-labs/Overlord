export default function Slide06() {
  return (
    <div className="relative flex h-full w-full flex-col justify-center overflow-hidden bg-[#020817] px-20 text-white lg:px-32 p1080:px-40 p2k:px-56 p4k:px-80">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%)]" />

      <div className="relative z-10">
        <p className="mb-6 font-mono text-lg uppercase tracking-widest text-sky-400 p2k:text-2xl p4k:text-4xl">
          Never reinvent 3
        </p>
        <h2 className="font-display text-7xl font-semibold leading-none tracking-tight lg:text-8xl p1080:text-9xl p2k:text-[11rem] p4k:text-[15rem]">
          Don't build the next big thing
        </h2>

        {/* Subtitle / lede */}
        <p className="mt-8 max-w-5xl text-3xl leading-snug text-slate-300 p2k:mt-10 p2k:text-4xl p4k:mt-14 p4k:text-6xl">
          The tools are evolving really fast — build something that works alongside what&apos;s
          next.
        </p>

        <div className="mt-10 p2k:mt-14 p4k:mt-20">
          {/* Musing */}
          <div className="relative rounded-3xl border-l-4 border-sky-400/60 bg-white/[0.03] px-10 py-8 p2k:px-14 p2k:py-10 p4k:px-20 p4k:py-14">
            <p className="mb-3 font-mono text-sm uppercase tracking-widest text-sky-400/80 p2k:text-lg p4k:text-2xl">
              A musing!
            </p>
            <p className="text-2xl italic leading-snug text-slate-300 p2k:text-3xl p4k:text-5xl">
              I&apos;ve been thinking a lot about how this works with independent agents (OpenClaw
              &amp; Co.). Overlord works CLI-only, so there are a bunch of ways users and agents can
              use it to coordinate work and share context.
              <ul className="mt-6 list-disc space-y-5 pl-8 text-2xl leading-relaxed text-slate-300 marker:text-sky-400/80 p2k:mt-8 p2k:space-y-6 p2k:pl-10 p2k:text-3xl p4k:mt-10 p4k:space-y-8 p4k:pl-14 p4k:text-5xl">
                <li>
                  Users and agents can share context about a specific task that needs to get done.
                </li>
                <li>
                  An agent can see that a folder it needs exists, but that it doesn&apos;t have
                  access, and that it needs to create a ticket for the user.
                </li>
              </ul>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
