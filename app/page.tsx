import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Bot,
  Camera,
  CheckCircle2,
  FolderRoot,
  PanelsTopLeft,
  ShieldCheck,
  TerminalSquare,
  Workflow
} from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { createClient } from '@/supabase/utils/server';

export const metadata: Metadata = {
  title: 'Overlord | Agent Work, Organized',
  description:
    'Overlord gives AI-assisted engineering work a shared ticket workflow across the web app, desktop app, CLI, and MCP.'
};

const platformPillars = [
  'Keep using Codex, Claude Code, Cursor, Gemini, and your own tools.',
  'Coordinate local terminal runs, cloud agents, and human review in one ticket.',
  'Turn prompts, progress, and delivery into a durable system of record.'
] as const;

const proofPoints = [
  {
    label: 'Ticket-first execution',
    value: 'Prompt, progress, review, and delivery all live in one place.'
  },
  {
    label: 'Local-first boundaries',
    value: 'Repository contents stay on your machine unless you intentionally share them.'
  },
  {
    label: 'Agent flexibility',
    value: 'Launch work in the tools your team already uses instead of forcing a new chat UI.'
  }
] as const;

const workflowSteps: Array<{
  title: string;
  body: string;
  icon: LucideIcon;
}> = [
  {
    title: 'Write the work once',
    body: 'Create a ticket with the objective, context, constraints, and acceptance criteria.',
    icon: PanelsTopLeft
  },
  {
    title: 'Launch in your real environment',
    body: 'Start an agent from the desktop app or CLI directly inside the repository that matters.',
    icon: TerminalSquare
  },
  {
    title: 'Track progress without babysitting',
    body: 'Sessions stream updates, blockers, and structured artifacts back into the ticket.',
    icon: Workflow
  },
  {
    title: 'Review like engineering work',
    body: 'Humans answer questions, inspect file changes, and keep a durable record of the result.',
    icon: CheckCircle2
  }
];

const screenshotSuggestions: Array<{
  title: string;
  placement: string;
  body: string;
}> = [
  {
    title: 'Active ticket with live agent updates',
    placement: 'Hero replacement',
    body: 'Capture the ticket detail view with progress updates, a structured deliverable, and a visible status badge.'
  },
  {
    title: 'Project board with multiple tickets',
    placement: 'Workflow section',
    body: 'Show how work is grouped by project so the page immediately communicates organization and momentum.'
  },
  {
    title: 'Desktop launch or terminal attachment flow',
    placement: 'Local-first section',
    body: 'Use a screenshot that proves Overlord connects the web workflow to a real local repository and terminal.'
  }
];

const agentIcons = [
  { src: '/images/icons/codex.svg', alt: 'Codex' },
  { src: '/images/icons/claude-code.svg', alt: 'Claude Code' },
  { src: '/images/icons/cursor.svg', alt: 'Cursor' },
  { src: '/images/icons/gemini.svg', alt: 'Gemini' }
] as const;

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-slate-300 shadow-sm backdrop-blur">
      {children}
    </div>
  );
}

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/u');
  }

  return (
    <div
      className="relative overflow-y-auto bg-[#020817] text-white"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%),radial-gradient(circle_at_50%_0%,_rgba(15,23,42,0.6),_transparent_52%),linear-gradient(180deg,rgba(15,23,42,0.85),rgba(2,8,23,0))]" />
      <div className="pointer-events-none absolute inset-x-0 top-24 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />

      <div className="relative mx-auto max-w-[1800px] px-6 pb-20 pt-8 sm:px-8 lg:px-12">
        <header className="animate-in fade-in slide-in-from-top-4 flex flex-col gap-6 rounded-[2rem] border border-white/10 bg-white/5 px-5 py-4 shadow-[0_20px_80px_-48px_rgba(15,23,42,0.75)] backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-white shadow-sm">
              OV
            </div>
            <div>
              <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
                Overlord
              </p>
              <p className="text-sm text-slate-400">Agent work with tickets, not chat sprawl.</p>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-slate-400 md:flex">
            <Link href="#product" className="transition-colors hover:text-white">
              Product
            </Link>
            <Link href="#workflow" className="transition-colors hover:text-white">
              Workflow
            </Link>
            <Link href="#screenshots" className="transition-colors hover:text-white">
              Screenshots
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Button
              asChild
              variant="ghost"
              className="text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <Link href="/login">Sign in</Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="rounded-full bg-white px-5 text-slate-950 hover:bg-slate-100"
            >
              <Link href="/signup">
                Create account
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-12 px-1 pb-16 pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)] lg:items-center lg:gap-16 lg:pt-16">
          <div className="animate-in fade-in slide-in-from-bottom-6 space-y-8 duration-700">
            <SectionEyebrow>Web app + desktop + CLI + MCP</SectionEyebrow>

            <div className="space-y-6">
              <h1 className="max-w-3xl font-[family-name:var(--font-display)] text-5xl font-semibold leading-[0.94] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
                Run agent work like real engineering work.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                Overlord gives AI-assisted development a shared operating surface: structured
                tickets, live progress, human review, and final delivery without asking your team to
                abandon the tools they already trust.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-white px-6 text-base text-slate-950 hover:bg-slate-100"
              >
                <Link href="/signup">
                  Create account
                  <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-white/15 bg-white/5 px-6 text-base text-white hover:bg-white/10"
              >
                <Link href="/downloads">Download desktop app</Link>
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {proofPoints.map(point => (
                <div
                  key={point.label}
                  className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4 shadow-[0_24px_60px_-44px_rgba(15,23,42,0.65)] backdrop-blur"
                >
                  <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-slate-400">
                    {point.label}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-200">{point.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-slate-500">
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

          <div className="animate-in fade-in zoom-in-95 duration-700">
            <div className="relative overflow-hidden rounded-[2.2rem] border border-white/10 bg-[#0f172a] p-5 text-white shadow-[0_40px_120px_-52px_rgba(15,23,42,0.88)]">
              <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_240px]">
                <div className="rounded-[1.7rem] border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
                    <div>
                      <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-sky-200/85">
                        Ticket 183
                      </p>
                      <h2 className="mt-2 text-xl font-semibold">Create basic marketing site</h2>
                      <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">
                        Ship a concise homepage that pitches Overlord, clarifies the product model,
                        and drives account creation.
                      </p>
                    </div>
                    <div className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                      executing
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.3rem] border border-white/10 bg-white/5 p-4">
                      <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-slate-400">
                        objective
                      </p>
                      <p className="mt-3 text-sm leading-6 text-slate-200">
                        Coordinate public marketing, product screenshots, and signup flow without
                        inventing a new UI metaphor.
                      </p>
                    </div>
                    <div className="rounded-[1.3rem] border border-white/10 bg-gradient-to-br from-sky-400/15 to-cyan-300/10 p-4">
                      <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-sky-100/75">
                        deliverable
                      </p>
                      <p className="mt-3 text-sm leading-6 text-slate-100">
                        Landing page implemented, screenshot placements defined, CTA wired to
                        account creation.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-slate-400">
                          activity stream
                        </p>
                        <p className="mt-2 text-sm text-slate-300">
                          Agents report progress back into the ticket while humans stay in control.
                        </p>
                      </div>
                      <Bot className="size-5 text-sky-200" />
                    </div>
                    <div className="mt-4 space-y-3">
                      {[
                        'Attached to ticket and loaded project guidance.',
                        'Replaced the homepage redirect with a public landing page.',
                        'Added screenshot callouts for the final product captures.'
                      ].map((line, index) => (
                        <div
                          key={line}
                          className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-3"
                        >
                          <div className="mt-0.5 size-2 rounded-full bg-amber-300" />
                          <div className="space-y-1">
                            <p className="text-sm text-slate-100">{line}</p>
                            <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-slate-500">
                              step 0{index + 1}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[1.7rem] border border-white/10 bg-white/5 p-4">
                    <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-slate-400">
                      stack
                    </p>
                    <div className="mt-4 space-y-3">
                      {[
                        { label: 'Web app', icon: PanelsTopLeft },
                        { label: 'Desktop app', icon: FolderRoot },
                        { label: 'CLI protocol', icon: TerminalSquare },
                        { label: 'MCP server', icon: Bot }
                      ].map(item => (
                        <div
                          key={item.label}
                          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3"
                        >
                          <item.icon className="size-4 text-sky-200" />
                          <span className="text-sm text-slate-100">{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[1.7rem] border border-amber-300/20 bg-gradient-to-br from-amber-300/18 to-transparent p-4">
                    <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-amber-100/80">
                      system record
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-100">
                      The ticket becomes the place where prompts, updates, blockers, and delivery
                      all stay attached.
                    </p>
                  </div>

                  <div className="rounded-[1.7rem] border border-emerald-300/20 bg-gradient-to-br from-emerald-300/12 to-transparent p-4">
                    <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-emerald-100/80">
                      privacy boundary
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-100">
                      Repository contents are not uploaded just because a project is connected to
                      Overlord.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="product"
          className="animate-in fade-in slide-in-from-bottom-6 mt-8 grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]"
        >
          <div className="space-y-4">
            <SectionEyebrow>Why it fits</SectionEyebrow>
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              A coordination layer for agent work, not another agent shell.
            </h2>
            <p className="text-base leading-7 text-slate-300">
              Overlord is strongest when a team already has tools they like and needs structure
              around execution, review, and handoffs.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {platformPillars.map(pillar => (
              <div
                key={pillar}
                className="rounded-[1.7rem] border border-white/10 bg-white/5 p-5 shadow-[0_20px_50px_-40px_rgba(15,23,42,0.62)]"
              >
                <div className="flex size-10 items-center justify-center rounded-2xl bg-white/8 text-white">
                  <CheckCircle2 className="size-4" />
                </div>
                <p className="mt-4 text-base leading-7 text-slate-200">{pillar}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="workflow"
          className="animate-in fade-in slide-in-from-bottom-6 mt-16 rounded-[2.2rem] border border-white/10 bg-[#0f172a] px-6 py-8 shadow-[0_32px_80px_-52px_rgba(15,23,42,0.75)] sm:px-8 lg:px-10"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-4">
              <SectionEyebrow>Workflow</SectionEyebrow>
              <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
                Keep the terminal where it belongs. Keep the coordination where everyone can see it.
              </h2>
            </div>
            <p className="max-w-xl text-base leading-7 text-slate-300">
              The product model is simple: tickets define the work, agents execute in their normal
              environment, and humans review outcomes in a shared system instead of private chat
              tabs.
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-4">
            {workflowSteps.map((step, index) => (
              <div
                key={step.title}
                className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-white/8 text-white">
                    <step.icon className="size-5" />
                  </div>
                  <span className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.22em] text-slate-500">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="screenshots"
          className="animate-in fade-in slide-in-from-bottom-6 mt-16 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]"
        >
          <div className="rounded-[2.1rem] border border-dashed border-white/15 bg-[linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-white/8 text-white">
                <Camera className="size-5" />
              </div>
              <div>
                <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-white">
                  Suggested screenshot placements
                </p>
                <p className="text-sm text-slate-400">
                  These placeholders can be swapped with real UI captures later without changing the
                  page structure.
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {screenshotSuggestions.map(shot => (
                <div
                  key={shot.title}
                  className="rounded-[1.6rem] border border-white/10 bg-white/5 p-5 shadow-[0_18px_45px_-42px_rgba(15,23,42,0.62)]"
                >
                  <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    {shot.placement}
                  </p>
                  <h3 className="mt-3 text-lg font-semibold text-white">{shot.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{shot.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.1rem] border border-white/10 bg-[#0f172a] p-6 text-white shadow-[0_28px_80px_-48px_rgba(15,23,42,0.82)]">
            <SectionEyebrow>Privacy</SectionEyebrow>
            <h2 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.04em]">
              Local repos stay local.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Overlord stores ticket content and ticket activity. It does not upload your repository
              just because you connected a folder or launched an agent from the desktop app.
            </p>
            <div className="mt-6 space-y-3">
              {[
                'Connect a repository folder to the project',
                'Launch an agent in that local working directory',
                'Share only the ticket content and updates you choose to record'
              ].map(item => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <ShieldCheck className="mt-0.5 size-4 text-emerald-200" />
                  <p className="text-sm leading-6 text-slate-100">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="animate-in fade-in slide-in-from-bottom-6 mt-16 rounded-[2.4rem] border border-white/10 bg-[#0f172a] px-6 py-10 text-white shadow-[0_32px_90px_-54px_rgba(15,23,42,0.92)] sm:px-8 lg:px-10">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <SectionEyebrow>Start with one ticket</SectionEyebrow>
              <h2 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl">
                Create an account and give your agent workflow a real home.
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-300">
                If your team is already using AI coding agents, the missing piece is usually not
                another model. It is shared coordination, review, and continuity.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-white px-6 text-base text-slate-950 hover:bg-slate-100"
              >
                <Link href="/signup">
                  Create account
                  <ArrowRight />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-white/20 bg-transparent px-6 text-base text-white hover:bg-white/10"
              >
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
