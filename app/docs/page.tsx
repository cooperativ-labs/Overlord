import {
  AppWindowMac,
  ArrowRight,
  Bot,
  ClipboardList,
  Eye,
  FolderKanban,
  MessagesSquare,
  Monitor,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
  Workflow
} from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Overlord Docs | Start Here',
  description:
    'Learn the Overlord workflow, the product surfaces, and the fastest way to get from a ticket to reviewed agent work.'
};

const sectionLinks = [
  { id: 'start-here', label: 'Start here' },
  { id: 'surfaces', label: 'Product surfaces' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'concepts', label: 'Core concepts' },
  { id: 'security', label: 'Security' },
  { id: 'who-its-for', label: 'Who it is for' }
] as const;

const gettingStartedSteps: Array<{
  title: string;
  description: string;
  badge?: string;
}> = [
  {
    title: 'Create a project',
    description:
      'Projects are the home for related tickets. In the desktop app, a project can also be linked to a local repository so agents launch in the right folder.',
    badge: 'Recommended first'
  },
  {
    title: 'Write the ticket',
    description:
      'The ticket is the prompt. Give it a clear objective, optional acceptance criteria, and enough context for an agent to work without guessing.'
  },
  {
    title: 'Launch the agent',
    description:
      'Use the desktop app to launch into your local terminal, or use the CLI and MCP workflow when you want a terminal-first or cloud-agent flow.'
  },
  {
    title: 'Review what comes back',
    description:
      'Watch updates on the ticket, answer blocking questions, and review artifacts, diffs, and change rationales before work lands.'
  }
] as const;

const productSurfaces = [
  {
    title: 'Web app',
    icon: AppWindowMac,
    description: 'Manage tickets, projects, activity, artifacts, and review in one shared place.',
    bullets: ['Create and refine tickets', 'Track work live', 'Review deliverables']
  },
  {
    title: 'Desktop app',
    icon: Monitor,
    description:
      'Adds local machine capabilities so Overlord can work with real repositories and terminal sessions.',
    bullets: ['Link projects to folders', 'Launch local agents', 'Use Current Changes']
  },
  {
    title: 'CLI',
    icon: TerminalSquare,
    description:
      'Gives agents and humans a stable terminal interface for attaching, updating, asking questions, and delivering work.',
    bullets: ['Attach to tickets', 'Post progress updates', 'Resume ticket sessions']
  },
  {
    title: 'MCP server',
    icon: ServerCog,
    description:
      'Lets remote or hosted agents work with the same tickets and protocol without depending on the desktop app.',
    bullets: [
      'Read and create tickets',
      'Post updates from cloud agents',
      'Support orchestration flows'
    ]
  }
] as const;

const workflowSteps = [
  {
    title: 'A ticket defines the job',
    description:
      'The ticket is the durable unit of work, not a disposable chat thread. It keeps the objective, structure, and delivery record in one place.',
    icon: ClipboardList
  },
  {
    title: 'An agent executes in its own environment',
    description:
      'Overlord works with the tools you already use, including terminal agents and hosted agents. It coordinates them instead of replacing them.',
    icon: Bot
  },
  {
    title: 'Progress streams back into the ticket',
    description:
      'Updates, blocking questions, artifacts, and session state flow back into the same ticket so humans can stay involved without hovering in the terminal.',
    icon: Workflow
  },
  {
    title: 'Humans review before work lands',
    description:
      'Review the output, inspect diffs and rationales, answer questions, and decide what should happen next.',
    icon: Eye
  }
] as const;

const coreConcepts = [
  {
    title: 'Tickets',
    icon: ClipboardList,
    description:
      'A ticket holds the objective, criteria, status, and project assignment for one piece of work.'
  },
  {
    title: 'Projects',
    icon: FolderKanban,
    description:
      'Projects group tickets together and can be linked to working directories in the desktop app.'
  },
  {
    title: 'Updates and questions',
    icon: MessagesSquare,
    description:
      'Agents report progress in the open and can ask a blocking question instead of making a risky assumption.'
  },
  {
    title: 'Artifacts and rationales',
    icon: Eye,
    description:
      'Artifacts summarize what was delivered. Change rationales explain why a change happened and what it should do.'
  }
] as const;

const securityPoints = [
  'Linking a repository does not send your local files to Overlord by itself.',
  'Overlord stores ticket content and ticket-related updates, including anything an agent intentionally writes into the ticket.',
  'You should treat ticket content as a persistent shared record for the work.',
  'Sensitive code or internal details only reach Overlord if you or your agent choose to put them into the ticket.'
] as const;

const audience = [
  'Engineering teams coordinating multiple agent runs',
  'Developers who want durable ticket history around terminal-based agents',
  'Product or founder teams turning requests into trackable engineering work',
  'Teams that want agent flexibility without committing to one vendor UI'
] as const;

const upcomingTopics = [
  'Getting started with the desktop app',
  'CLI and protocol reference',
  'MCP and cloud-agent integration',
  'Security, permissions, and auth flows'
] as const;

function SectionIntro({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-3">
      <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-sky-300">
        {eyebrow}
      </p>
      <div className="space-y-2">
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
          {title}
        </h2>
        <p className="max-w-3xl text-base leading-7 text-slate-300">{description}</p>
      </div>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="relative min-h-dvh overflow-y-auto bg-[#04111f] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_28%),radial-gradient(circle_at_80%_0%,_rgba(14,165,233,0.10),_transparent_22%),linear-gradient(180deg,rgba(2,8,23,0.72),rgba(4,17,31,0))]" />
      <div className="pointer-events-none absolute inset-x-0 top-20 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative mx-auto flex w-full max-w-[1400px] flex-col gap-12 px-6 pb-16 pt-5 sm:px-8 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-[1.75rem] border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-4">
            <div className="flex size-11 items-center justify-center overflow-hidden rounded-full">
              <Image
                src="/images/258.png"
                alt="Overlord logo"
                width={45}
                height={50}
                className="shrink-0 overflow-hidden"
              />
            </div>
            <div>
              <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
                Overlord Docs
              </p>
              <p className="text-sm text-slate-400">Start here if you are new to the workflow.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              asChild
              variant="ghost"
              className="text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <Link href="/">Home</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <Link href="/downloads">Downloads</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="text-slate-300 hover:bg-white/5 hover:text-white"
            >
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div className="space-y-6">
            <Badge className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-sky-100">
              Docs / Getting started
            </Badge>
            <div className="space-y-4">
              <h1 className="max-w-4xl font-[family-name:var(--font-display)] text-5xl font-semibold leading-[0.95] tracking-[-0.05em] text-white sm:text-6xl">
                Learn the Overlord workflow without learning a new coding environment.
              </h1>
              <p className="max-w-3xl text-lg leading-8 text-slate-300">
                Overlord is a coordination layer for AI-assisted engineering work. It keeps the
                ticket, progress, review, and delivery record in one place while your agents keep
                working in the tools you already use.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="rounded-full bg-white px-6 text-slate-950 hover:bg-slate-100"
              >
                <Link href="#start-here">
                  Start with the workflow
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full border-white/15 bg-white/5 px-6 text-white hover:bg-white/10"
              >
                <Link href="/downloads">Get the desktop app</Link>
              </Button>
            </div>
          </div>

          <Card className="border-white/10 bg-white/[0.045] text-white shadow-[0_24px_80px_-48px_rgba(56,189,248,0.55)]">
            <CardHeader className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-100">
                  <ShieldCheck className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-white">The simple mental model</CardTitle>
                  <CardDescription className="text-slate-400">
                    Overlord organizes agent work around tickets.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="font-medium text-white">The ticket is the prompt.</p>
                <p className="mt-1 leading-6">
                  It defines the work, captures progress, and holds the delivery record.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="font-medium text-white">The agent stays where it already works.</p>
                <p className="mt-1 leading-6">
                  Overlord coordinates Claude Code, Codex, Cursor, OpenCode, and other setups
                  instead of replacing them.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="font-medium text-white">Humans stay in the loop.</p>
                <p className="mt-1 leading-6">
                  Progress, questions, artifacts, and review decisions come back to the same ticket.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <Card className="border-white/10 bg-white/[0.04] text-white">
              <CardHeader className="pb-4">
                <CardTitle className="text-base text-white">On this page</CardTitle>
                <CardDescription className="text-slate-400">
                  The first public docs page focuses on the product model and the core workflow.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {sectionLinks.map(link => (
                  <a
                    key={link.id}
                    href={`#${link.id}`}
                    className="block rounded-xl border border-transparent px-3 py-2 text-sm text-slate-300 transition-colors hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
                  >
                    {link.label}
                  </a>
                ))}
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-14">
            <section id="start-here" className="scroll-mt-24 space-y-6">
              <SectionIntro
                eyebrow="Start Here"
                title="The fastest path from idea to reviewed agent work"
                description="Use these four steps to understand the product before you dive into deeper reference docs."
              />

              <div className="grid gap-4 md:grid-cols-2">
                {gettingStartedSteps.map((step, index) => (
                  <Card key={step.title} className="border-white/10 bg-white/[0.04] text-white">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-sky-300">
                            Step {index + 1}
                          </p>
                          <CardTitle className="mt-2 text-xl text-white">{step.title}</CardTitle>
                        </div>
                        {step.badge ? (
                          <Badge className="rounded-full bg-white/8 text-slate-200">
                            {step.badge}
                          </Badge>
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-7 text-slate-300">{step.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <section id="surfaces" className="scroll-mt-24 space-y-6">
              <SectionIntro
                eyebrow="Product Surfaces"
                title="Four parts, one workflow"
                description="The web app, desktop app, CLI, and MCP server all serve the same ticket-centered workflow."
              />

              <div className="grid gap-4 md:grid-cols-2">
                {productSurfaces.map(item => (
                  <Card key={item.title} className="border-white/10 bg-white/[0.04] text-white">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="flex size-11 items-center justify-center rounded-2xl border border-sky-300/15 bg-sky-300/10 text-sky-100">
                          <item.icon className="size-5" />
                        </div>
                        <div>
                          <CardTitle className="text-white">{item.title}</CardTitle>
                          <CardDescription className="mt-1 text-slate-400">
                            {item.description}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm text-slate-300">
                        {item.bullets.map(point => (
                          <li key={point} className="flex items-start gap-2">
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-sky-300/70" />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <section id="workflow" className="scroll-mt-24 space-y-6">
              <SectionIntro
                eyebrow="Workflow"
                title="Overlord is built around tickets, not chats"
                description="That structure is what makes the work reviewable, resumable, and easy to hand off."
              />

              <div className="space-y-4">
                {workflowSteps.map((step, index) => (
                  <Card key={step.title} className="border-white/10 bg-white/[0.04] text-white">
                    <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start">
                      <div className="flex items-center gap-4 sm:w-64 sm:shrink-0">
                        <div className="flex size-12 items-center justify-center rounded-2xl border border-sky-300/15 bg-sky-300/10 text-sky-100">
                          <step.icon className="size-5" />
                        </div>
                        <div>
                          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.22em] text-sky-300">
                            Stage {index + 1}
                          </p>
                          <p className="mt-2 text-lg font-semibold text-white">{step.title}</p>
                        </div>
                      </div>
                      <p className="max-w-3xl text-sm leading-7 text-slate-300">
                        {step.description}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>

            <section id="concepts" className="scroll-mt-24 space-y-6">
              <SectionIntro
                eyebrow="Core Concepts"
                title="What to expect inside the product"
                description="These are the nouns that matter most when you are using Overlord day to day."
              />

              <div className="grid gap-4 md:grid-cols-2">
                {coreConcepts.map(item => (
                  <Card key={item.title} className="border-white/10 bg-white/[0.04] text-white">
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <div className="flex size-11 items-center justify-center rounded-2xl border border-sky-300/15 bg-sky-300/10 text-sky-100">
                          <item.icon className="size-5" />
                        </div>
                        <CardTitle className="text-white">{item.title}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm leading-7 text-slate-300">{item.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="border-white/10 bg-white/[0.04] text-white">
                <CardHeader>
                  <CardTitle className="text-white">How this docs area should expand</CardTitle>
                  <CardDescription className="text-slate-400">
                    This first page handles orientation. Deeper docs can branch from here by job to
                    be done.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {upcomingTopics.map(topic => (
                    <div
                      key={topic}
                      className="rounded-2xl border border-dashed border-white/12 bg-white/[0.03] px-4 py-3 text-sm text-slate-300"
                    >
                      {topic}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            <section id="security" className="scroll-mt-24 space-y-6">
              <SectionIntro
                eyebrow="Security"
                title="Know the data boundary"
                description="Overlord is designed to coordinate work, not to mirror your repository into the service."
              />

              <Card className="border-white/10 bg-white/[0.04] text-white">
                <CardContent className="grid gap-3 p-6 text-sm text-slate-300">
                  {securityPoints.map(point => (
                    <div
                      key={point}
                      className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-200" />
                      <p className="leading-7">{point}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            <section id="who-its-for" className="scroll-mt-24 space-y-6">
              <SectionIntro
                eyebrow="Who It Is For"
                title="Built for teams already using agents"
                description="Overlord is most useful when you want more structure around agent execution, review, and continuity."
              />

              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <Card className="border-white/10 bg-white/[0.04] text-white">
                  <CardContent className="grid gap-3 p-6 text-sm text-slate-300">
                    {audience.map(item => (
                      <div
                        key={item}
                        className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                      >
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-sky-300/80" />
                        <p className="leading-7">{item}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-sky-300/10 text-white">
                  <CardHeader>
                    <CardTitle className="text-white">Next step</CardTitle>
                    <CardDescription className="text-sky-100/80">
                      Install the desktop app or head back to the product overview.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button
                      asChild
                      className="w-full rounded-full bg-white text-slate-950 hover:bg-slate-100"
                    >
                      <Link href="/downloads">Download Overlord</Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="w-full rounded-full border-white/20 bg-transparent text-white hover:bg-white/10"
                    >
                      <Link href="/">
                        Back to home
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
