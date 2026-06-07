import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

import { DemoAgenticTicket } from '../../../example-content/demo-frames/DemoAgenticTicket';

export const metadata: Metadata = {
  title: 'The Agentic Ticket | Overlord',
  description:
    'Overlord tickets are shared context around a goal. Objectives map to prompts, agents run in your terminal, and each step inherits the work that came before.',
  alternates: {
    canonical: 'https://www.ovld.ai/the-agentic-ticket'
  }
};

const features = [
  {
    title: 'Open with the first objective',
    description:
      'Start a ticket with an idea, a question, or a scoped ask. The objective is the prompt the agent will execute.'
  },
  {
    title: 'Run in the right repo',
    description:
      'Pick an agent and click Run. Overlord opens your terminal in the project directory and launches the objective with the right guidance.'
  },
  {
    title: 'Structured delivery back to the ticket',
    description:
      'Agents report progress, file-change rationales, artifacts, and delivery summaries so reviewers can follow what happened.'
  },
  {
    title: 'Queue the next objective',
    description:
      'Add future objectives to the same ticket and run them sequentially, with each step inheriting context from the last.'
  }
] as const;

export default function TheAgenticTicketPage() {
  return (
    <div className="flex flex-col gap-14">
      <section className="mx-auto grid w-full max-w-6xl gap-8 pt-2 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <Link
            href="/"
            className="flex flex-row items-start gap-2 font-mono text-[14px] font-medium uppercase tracking-widest text-sky-600 dark:text-sky-400"
          >
            <ChevronLeft className="size-4 shrink-0" /> Overlord
          </Link>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[0.95] tracking-tight text-stone-900 sm:text-6xl dark:text-white">
            The Agentic Ticket
          </h1>
          <p className="mt-6 text-lg leading-8 text-stone-600 dark:text-slate-300">
            Each Overlord project is a kanban board where tickets are shared context around a goal — like a
            feature — and objectives inside each ticket are the prompts agents actually run.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {features.map((feature, index) => (
              <article
                key={feature.title}
                className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#07101d]/70 dark:shadow-none"
              >
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center font-mono text-sm font-semibold text-sky-600 dark:text-sky-300">
                    {index + 1}
                  </span>
                  <h2 className="text-lg font-semibold text-stone-900 dark:text-white">
                    {feature.title}
                  </h2>
                </div>
                <p className="mt-3 text-sm leading-7 text-stone-600 dark:text-slate-300">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </div>
        <div className="p-5">
          <div className='shadow-lg rounded-2xl'>
            <DemoAgenticTicket />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/[0.035] dark:shadow-none">
        <p className="font-mono text-[14px] uppercase tracking-widest text-sky-600 dark:text-sky-400">
          Agent-readable detail
        </p>
        <p className="mt-3 max-w-3xl text-base leading-7 text-stone-600 dark:text-slate-300">
          A ticket is the durable container. Each objective is one agent prompt with its own
          lifecycle: attach, execute, update, ask, deliver. Later objectives inherit shared context,
          prior file changes, and discussion from earlier steps. You can also write future
          objectives into a ticket and let them auto-advance sequentially when each delivery
          completes.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            asChild
            variant="outline"
            className="rounded-full border-stone-300 bg-white text-stone-900 shadow-sm hover:bg-stone-50 dark:border-white/15 dark:bg-white/5 dark:text-white dark:shadow-none dark:hover:bg-white/10"
          >
            <Link href="/llms.txt">llms.txt</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="rounded-full border-stone-300 bg-white text-stone-900 shadow-sm hover:bg-stone-50 dark:border-white/15 dark:bg-white/5 dark:text-white dark:shadow-none dark:hover:bg-white/10"
          >
            <Link href="/overlord-context">Public context</Link>
          </Button>
          {/* <Button
            asChild
            variant="outline"
            className="rounded-full border-stone-300 bg-white text-stone-900 shadow-sm hover:bg-stone-50 dark:border-white/15 dark:bg-white/5 dark:text-white dark:shadow-none dark:hover:bg-white/10"
          >
            <Link href="/anatomy">App anatomy</Link>
          </Button> */}
        </div>
      </section>
    </div>
  );
}

