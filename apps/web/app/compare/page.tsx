import { Bot, ClipboardList, GitBranch, Rows3, Workflow } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { HomepageFooter } from '@/components/marketing/HomepageFooter';
import { HomepageHeader } from '@/components/marketing/HomepageHeader';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Compare Overlord | Agent Coordination and Review',
  description:
    'Compare Overlord with project management tools, multi-agent execution workbenches, and agent automation platforms.',
  alternates: {
    canonical: 'https://www.ovld.ai/compare'
  }
};

const categories = [
  {
    icon: ClipboardList,
    title: 'Jira and Linear',
    label: 'Project management tools',
    summary:
      'They are strong systems of record for human software work, ownership, priority, planning, and team visibility.',
    difference:
      'Overlord makes the ticket the active container for agent execution: prompt, objectives, progress, blocking questions, artifacts, delivery, review notes, and file-change rationale.',
    simple:
      'Jira and Linear tell you what work exists and who owns it. Overlord tells you what you asked agents to do, what they did, why files changed, and how to continue or evaluate the work.'
  },
  {
    icon: Rows3,
    title: 'Conductor and Sculptor',
    label: 'Multi-agent execution workbenches',
    summary:
      'They focus on running multiple agents simultaneously, often in managed branches, workspaces, containers, or execution environments.',
    difference:
      'Overlord focuses on the durable workflow around agent work: repo targeting, context handoff, staged objectives, updates, review, artifacts, and change rationale.',
    simple:
      'Conductor and Sculptor are agent execution workbenches. Overlord is the agent coordination and review ledger.'
  },
  {
    icon: Bot,
    title: 'Tasklet and OpenClaw-style tools',
    label: 'Agent software and automation platforms',
    summary:
      'They usually provide their own chat interface, tools, workflow model, memory, and execution runtime.',
    difference:
      'Overlord coordinates the agents, terminals, desktop apps, MCP servers, permissions, subscriptions, tickets, objectives, and review records users already have.',
    simple:
      'Agent platforms do the work inside their own runtime. Overlord records, scopes, routes, resumes, reviews, and coordinates that work across runtimes.'
  }
] as const;

const needs = [
  ['Remember what agents were asked to do', 'Prompts become durable tickets with objectives.'],
  ['Evaluate work later', 'Delivery notes, artifacts, and change rationales stay with the ticket.'],
  [
    'Work across many repos',
    'Project working directories launch agents in the right local context.'
  ],
  ['Move work between agents', 'Shared context and objective history travel with the ticket.'],
  ['Manage sequential work', 'Plan, execute, review, and follow-up can be separate objectives.'],
  ['Avoid tool lock-in', 'Keep using terminal agents, desktop apps, MCP, and hosted agents.']
] as const;

export default function ComparePage() {
  return (
    <div className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto w-full max-w-6xl px-6 sm:px-8 lg:px-12">
        <HomepageHeader />
      </div>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-6 py-8 sm:px-8 lg:px-12">
        <section className="max-w-4xl pt-10">
          <p className="font-mono text-[14px] font-medium uppercase tracking-widest text-sky-400">
            Compare Overlord
          </p>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
            Overlord coordinates agent work without trapping it in one harness.
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
            Use Overlord when the problem is not just running an agent. Use it when you need the
            prompt, context, progress, handoffs, objectives, file changes, and review record to
            survive across tools, agents, repos, and sessions.
          </p>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {categories.map(category => (
            <article
              key={category.title}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-5"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
                  <category.icon className="size-5" />
                </div>
                <div>
                  <p className="font-mono text-[12px] uppercase tracking-widest text-slate-500">
                    {category.label}
                  </p>
                  <h2 className="font-semibold text-white">{category.title}</h2>
                </div>
              </div>
              <p className="mt-5 text-sm leading-7 text-slate-300">{category.summary}</p>
              <p className="mt-4 text-sm leading-7 text-slate-200">{category.difference}</p>
              <p className="mt-5 border-t border-white/10 pt-4 text-sm leading-7 text-sky-100">
                {category.simple}
              </p>
            </article>
          ))}
        </section>

        <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="font-mono text-[14px] font-medium uppercase tracking-widest text-sky-400">
              When it fits
            </p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight">
              The core need is durable coordination.
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              Overlord is for solo developers, engineering teams, and productivity power users who
              have more agent work than one chat thread can safely hold.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {needs.map(([title, description]) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-[#07101d]/70 p-4">
                <div className="flex items-start gap-3">
                  <GitBranch className="mt-1 size-4 shrink-0 text-sky-300" />
                  <div>
                    <h3 className="font-medium text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3 text-sky-300">
                <Workflow className="size-5" />
                <p className="font-mono text-[14px] uppercase tracking-widest">For agents</p>
              </div>
              <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">
                Agents should treat Overlord as the system of record for agent-executed engineering
                work. Read the ticket, attach to the objective, post meaningful progress, ask
                blocking questions, preserve shared context, and deliver artifacts plus file-change
                rationales.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                asChild
                variant="outline"
                className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                <Link href="/docs/for-agents">Agent docs</Link>
              </Button>
              <Button asChild className="rounded-full bg-white text-slate-950 hover:bg-slate-100">
                <Link href="/llms.txt">llms.txt</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <HomepageFooter />
    </div>
  );
}
