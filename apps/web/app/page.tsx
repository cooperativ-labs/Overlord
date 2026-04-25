import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardList,
  Eye,
  Play,
  Rocket,
  Server,
  Smartphone,
  TerminalSquare
} from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { HomepageFooter } from '@/components/marketing/HomepageFooter';
import { VideoSection } from '@/components/marketing/VideoSection';
import { Button } from '@/components/ui/button';
import { createClientForRequest } from '@/supabase/utils/server';

export const metadata: Metadata = {
  title: 'Overlord | Agent Work, Organized',
  description:
    'Overlord organizes AI-assisted engineering work across the web app, desktop app, CLI, MCP, and new personal-server and mobile workflows.'
};

const agentIcons = [
  { src: '/images/icons/codex.svg', alt: 'Codex' },
  { src: '/images/icons/claude-code.svg', alt: 'Claude Code' },
  { src: '/images/icons/cursor.svg', alt: 'Cursor' },
  { src: '/images/icons/gemini.svg', alt: 'Gemini' },
  { src: '/images/icons/opencode.svg', alt: 'OpenCode' }
] as const;

const workflowSteps = [
  {
    step: '01',
    icon: ClipboardList,
    title: 'Define the work',
    description:
      'Plan and organize future agent jobs while current execution stays in flight, so the next wave of work is ready when you are.',
    benefits: [
      'Queue upcoming work without interrupting executing jobs',
      'Turn waiting time into organized planning instead of idle tabs'
    ]
  },
  {
    step: '02',
    icon: Rocket,
    title: 'Agents execute',
    description: 'Agents attach to tickets, follow the protocol, and stream live progress updates.',
    benefits: [
      'Works with Claude Code, Codex, Cursor, and more',
      'Real-time visibility into what the agent is doing',
      'Agents ask for help instead of guessing'
    ]
  },
  {
    step: '03',
    icon: Eye,
    title: 'Review & refine',
    description:
      'Review diffs, change rationales, and artifacts before anything lands in your codebase.',
    benefits: [
      'Human-in-the-loop at every critical moment',
      'Structured rationales explain the "why" behind changes',
      'Send it back with feedback in one click'
    ]
  },
  {
    step: '04',
    icon: CheckCircle2,
    title: 'Current Changes',
    description:
      'Use the Current Changes page to review agent work across files with the original human objective, rationales, and artifacts in view.',
    benefits: [
      'Review multi-file work in the context of what the human actually asked for',
      'See why each change happened before you approve or send feedback'
    ]
  }
] as const;

const heroBoardColumns = [
  {
    title: 'Next Up',
    count: 2,
    cards: [
      { title: 'Add CSV export to reports', color: '#60a5fa', active: false },
      { title: 'Refactor auth middleware', color: '#38bdf8', active: false }
    ]
  },
  {
    title: 'Execute',
    count: 1,
    cards: [{ title: 'Dark mode toggle', color: '#34d399', active: true }]
  },
  {
    title: 'Review',
    count: 1,
    cards: [{ title: 'Payment flow redesign', color: '#f59e0b', active: false }]
  }
] as const;

const heroTerminalLines = [
  '$ ovld protocol attach --ticket-id ticket-184',
  'Attaching Claude Code to ticket...',
  'Agent posted: Implementing dark mode',
  'Streaming diff to review queue'
] as const;

const featureHighlights = [
  {
    icon: Server,
    eyebrow: 'Own your runtime',
    title: 'Run Overlord on a personal server over SSH.',
    description:
      'Point Overlord at your own machine with the SSH key already on your computer and keep agent work under your control.',
    bullets: [
      'Use the SSH key already on your laptop to connect quickly',
      'Keep work running on a home server instead of a hosted machine',
      'Treat Overlord as your control plane while execution stays near your code'
    ]
  },
  {
    icon: TerminalSquare,
    eyebrow: 'Small-footprint CLI',
    title: 'The CLI fits Raspberry Pis, older Macs, and home servers.',
    description:
      'The command-line workflow is lightweight enough for lower-powered hardware while still giving agents a stable ticket protocol.',
    bullets: [
      'Works well on Raspberry Pis and other low-power Linux boxes',
      'Keeps older Macs and spare home servers in the loop',
      'Uses the same ovld workflow you already rely on elsewhere'
    ]
  },
  {
    icon: Smartphone,
    eyebrow: 'Pocket control',
    title: 'A new iPhone app keeps remote agent work close at hand.',
    description:
      'Start, monitor, and steer agent work from iPhone while the actual execution runs on your own server via SSH.',
    bullets: [
      'Check progress without opening a laptop',
      'Review work running on your own server wherever you are',
      'Stay connected to remote agent jobs while they keep moving'
    ]
  }
] as const;

function HeroDashboardGraphic() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-5xl pt-2">
      <div className="absolute inset-x-10 top-8 h-40 rounded-full bg-sky-400/12 blur-3xl" />
      <div className="relative rounded-[2rem] border border-white/10 bg-white/[0.045] p-3 shadow-[0_30px_120px_-60px_rgba(56,189,248,0.55)] backdrop-blur">
        <div className="grid gap-3 lg:grid-cols-[1.3fr_0.9fr]">
          <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#07101d]/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="size-2.5 rounded-full bg-[#ff5f57]" />
              <span className="size-2.5 rounded-full bg-[#febc2e]" />
              <span className="size-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-2 text-[14px] uppercase tracking-[0.22em] text-slate-500">
                Project Board
              </span>
            </div>

            <div className="grid gap-3 p-3 sm:grid-cols-3">
              {heroBoardColumns.map(column => (
                <div
                  key={column.title}
                  className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] p-2.5 text-left"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[14px] font-medium uppercase tracking-[0.18em] text-slate-400">
                      {column.title}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-500">
                      {column.count}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {column.cards.map(card => (
                      <div
                        key={card.title}
                        className="relative rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 overflow-hidden"
                      >
                        {card.active && (
                          <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_3s_linear_infinite] bg-linear-to-r from-transparent via-emerald-400/15 to-transparent" />
                        )}
                        <div className="relative flex items-start gap-2.5">
                          <span
                            className="mt-1 block size-2.5 shrink-0 rounded-[3px]"
                            style={{ backgroundColor: card.color }}
                          />
                          <div className="min-w-0">
                            <p className="text-sm leading-snug text-slate-100">{card.title}</p>
                            <div className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">
                              {card.active ? (
                                <>
                                  <Bot className="size-3 text-emerald-300" />
                                  <span>Agent running</span>
                                </>
                              ) : (
                                <span>Ready for handoff</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#050b15]/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="flex items-center gap-2">
                <TerminalSquare className="size-4 text-sky-300" />
                <span className="text-[14px] uppercase tracking-[0.22em] text-slate-500">
                  Terminal
                </span>
              </div>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                Live
              </span>
            </div>

            <div className="space-y-3 p-4 text-left font-[family-name:var(--font-mono)] text-[12px] leading-6 text-slate-300">
              {heroTerminalLines.map((line, index) => (
                <div key={line} className="flex items-center gap-3">
                  <span className="w-4 text-right text-slate-600">{index + 1}</span>
                  <span className={index === 0 ? 'text-sky-300' : ''}>{line}</span>
                </div>
              ))}

              <div className="mt-4 rounded-xl border border-sky-400/15 bg-sky-400/10 px-3 py-2 text-[14px] text-sky-100">
                Ticket status updates and terminal execution stay in sync.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function HomePage() {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/u');
  }

  return (
    <div className="relative min-h-dvh overflow-y-auto bg-[#020817] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%),radial-gradient(circle_at_50%_0%,_rgba(15,23,42,0.6),_transparent_52%),linear-gradient(180deg,rgba(15,23,42,0.85),rgba(2,8,23,0))]" />
      <div className="pointer-events-none absolute inset-x-0 top-24 h-px bg-linear-to-r from-transparent via-white/12 to-transparent" />

      <div className="relative flex flex-col mx-auto max-w-[1800px] px-6 pb-12 sm:px-8 lg:px-12 gap-8">
        {/* Header */}
        <header className="animate-in fade-in slide-in-from-top-4 flex items-center justify-between rounded-[2rem] border border-white/10 bg-white/5 px-5 py-4 mt-5 shadow-[0_20px_80px_-48px_rgba(15,23,42,0.75)] backdrop-blur">
          <div className="flex items-center gap-4">
            <div className="flex size-11 items-center justify-center rounded-full overflow-hidden">
              <Image
                src="/images/258.png"
                alt="Overlord logo"
                width={45}
                height={50}
                className="shrink-0 overflow-hidden"
              />
            </div>
            <p className="hidden sm:block font-[family-name:var(--font-display)] text-lg font-semibold">
              Overlord
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* <Button
              asChild
              variant="ghost"
              className="hidden text-slate-300 hover:bg-white/5 hover:text-white sm:inline-flex"
            >
              <Link href="/docs">Docs</Link>
            </Button> */}
            <Button
              asChild
              variant="ghost"
              className="hidden sm:inline-flex text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <Link href="/login">Sign in</Link>
            </Button>
            <Button
              asChild
              size="sm"
              className="rounded-full bg-white px-4 text-slate-950 hover:bg-slate-100 whitespace-nowrap text-sm"
            >
              <Link href="/early-access">
                Get Access
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </header>

        {/* Hero — centered, focused */}
        <section className="flex min-h-[calc(100dvh-8rem)] flex-col items-center justify-center text-center">
          <div className="animate-in fade-in slide-in-from-bottom-6 max-w-5xl space-y-8 duration-700">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[14px] font-medium uppercase tracking-[0.24em] text-slate-300 shadow-sm backdrop-blur">
              Web App · Desktop · CLI · MCP
            </div>

            <h1 className="font-[family-name:var(--font-display)] text-5xl font-semibold leading-[0.94] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
              Stop Juggling Agents.
            </h1>

            <p className="mx-auto max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
              Create tickets, assign agents, and review diffs — all in one place. Overlord keeps the
              full delivery record while agents work in the tools they already know.
            </p>

            <HeroDashboardGraphic />

            {/* Primary CTA: Demo */}
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Button
                asChild
                size="lg"
                className="h-14 rounded-full bg-white px-8 text-base font-semibold text-slate-950 shadow-lg shadow-white/10 hover:bg-slate-100"
              >
                <Link href="/demo">
                  <Play className="size-4" />
                  Try the interactive demo
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-14 rounded-full border-white/15 bg-white/5 px-8 text-base text-white hover:bg-white/10"
              >
                <Link href="#watch-video">
                  <Play className="size-4" />
                  Watch video
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-14 rounded-full border-white/15 bg-white/5 px-8 text-base text-white hover:bg-white/10"
              >
                <Link href="/early-access">
                  Get Early Access
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>

            <p className="text-sm text-slate-400">
              New to Overlord?{' '}
              <Link href="/docs" className="text-white underline underline-offset-4">
                Start with the docs
              </Link>
              .
            </p>

            {/* Agent icons */}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2 text-sm text-slate-300">
              <span className="font-[family-name:var(--font-mono)] text-[14px] uppercase tracking-[0.22em] text-slate-500">
                Works with
              </span>
              {agentIcons.map(agent => (
                <div
                  key={agent.alt}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 shadow-sm"
                >
                  <Image src={agent.src} alt={agent.alt} width={16} height={16} />
                  <span>{agent.alt}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Video section */}
        <section id="watch-video" className="mx-auto w-full max-w-6xl py-6">
          <VideoSection />
        </section>

        {/* Feature highlights */}

        {/* Workflow section */}
        <section id="how-it-works" className="mx-auto max-w-6xl pb-24 pt-12 mt-12">
          <div className="mb-16 text-center">
            <p className="font-[family-name:var(--font-mono)] text-[14px] font-medium uppercase tracking-[0.24em] text-sky-400">
              How it works
            </p>
            <h2 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              From ticket to shipped — with agents in the loop
            </h2>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {workflowSteps.map(step => (
              <div
                key={step.step}
                className="group relative flex flex-col rounded-2xl border border-white/8 bg-white/[0.03] p-6 transition-colors hover:border-white/15 hover:bg-white/[0.06]"
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-400">
                    <step.icon className="size-5" />
                  </div>
                  <span className="font-[family-name:var(--font-mono)] text-xs text-slate-500">
                    {step.step}
                  </span>
                </div>

                <h3 className="mb-2 text-lg font-semibold text-white">{step.title}</h3>
                <p className="mb-5 text-sm leading-relaxed text-slate-400">{step.description}</p>

                <ul className="space-y-2.5">
                  {step.benefits.map(benefit => (
                    <li key={benefit} className="flex items-start gap-2 text-sm text-slate-300">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-sky-400/70" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
        <section id="feature-highlights" className="mx-auto max-w-6xl pb-10 pt-2">
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 shadow-[0_24px_96px_-56px_rgba(14,165,233,0.55)] backdrop-blur sm:p-8">
            <div className="w-full">
              <p className="font-[family-name:var(--font-mono)] text-[14px] font-medium uppercase tracking-[0.24em] text-sky-400">
                New deployment paths
              </p>
              <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Overlord now fits the hardware you already own.
              </h2>
              <p className="mt-4  text-base leading-7 text-slate-300 sm:text-lg">
                The homepage now makes the product story explicit: run Overlord through SSH on a
                personal server, use a CLI that works on smaller machines, and keep remote agent
                work in reach from iPhone.
              </p>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-3">
              {featureHighlights.map(feature => (
                <article
                  key={feature.title}
                  className="group rounded-3xl border border-white/10 bg-[#07101d]/70 p-5 transition-colors hover:border-white/15 hover:bg-[#07101d]/90"
                >
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex size-11 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
                      <feature.icon className="size-5" />
                    </div>
                    <span className="font-[family-name:var(--font-mono)] text-[14px] uppercase tracking-[0.22em] text-slate-500">
                      {feature.eyebrow}
                    </span>
                  </div>

                  <h3 className="text-xl font-semibold tracking-tight text-white">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{feature.description}</p>

                  <ul className="mt-5 space-y-2.5">
                    {feature.bullets.map(bullet => (
                      <li
                        key={bullet}
                        className="flex items-start gap-2 text-sm leading-6 text-slate-300"
                      >
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-sky-400/70" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
      <HomepageFooter />
    </div>
  );
}
