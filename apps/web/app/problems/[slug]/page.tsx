import { CheckCircle2, ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { getProblemPage, problemPages } from '@/lib/marketing/problem-pages';

import { DemoFeedShowcase } from '../../../example-content/demo-frames/DemoFeedShowcase';
import { DemoTicketActivity } from '../../../example-content/demo-frames/DemoTicketActivity';
import { DemoTicketDetails } from '../../../example-content/demo-frames/DemoTicketDetails';

function youtubeEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed${parsed.pathname}`;
    }
    if (parsed.hostname.includes('youtube.com')) {
      const id = parsed.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

type ProblemRouteProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return problemPages.map(page => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: ProblemRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getProblemPage(slug);

  if (!page) {
    return {
      title: 'Problem not found | Overlord'
    };
  }

  return {
    title: `${page.shortTitle} | Overlord`,
    description: page.summary,
    alternates: {
      canonical: `https://www.ovld.ai/problems/${page.slug}`
    }
  };
}

export default async function ProblemPage({ params }: ProblemRouteProps) {
  const { slug } = await params;
  const page = getProblemPage(slug);

  if (!page) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-14">
      <section className="mx-auto grid w-full max-w-6xl gap-8 pt-2 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <Link
            href="/#problems"
            className="flex flex-row items-start gap-2 font-mono text-[14px] font-medium uppercase tracking-widest text-sky-400"
          >
            <ChevronLeft className="size-4 shrink-0" /> {page.problem}
          </Link>
          {/* <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
                  <page.icon className="size-6" />
                </div>
                <div>
                  <p className="font-mono text-[12px] uppercase tracking-widest text-slate-500">
                    The problem
                  </p>
                  <p className="mt-2 text-xl font-semibold leading-8 text-white">{page.problem}</p>
                </div>
              </div>
            </div> */}
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
            {page.headline}
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-300">{page.summary}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {page.features.map(feature => (
              <article
                key={feature.title}
                className="rounded-2xl border border-white/10 bg-[#07101d]/70 p-5"
              >
                <div className="mb-4 flex items-center gap-3">
                  <CheckCircle2 className="size-5 text-sky-300" />
                  <h2 className="text-lg font-semibold text-white">{feature.title}</h2>{' '}
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-300">{feature.description}</p>
              </article>
            ))}
          </div>
          {/* <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="rounded-full bg-white text-slate-950 hover:bg-slate-100">
                <Link href="/demo">
                  Try the demo
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                <Link href="/docs/for-agents">Agent docs</Link>
              </Button>
            </div> */}
        </div>
        {page.slug === 'remember-agent-intent' ? (
          <ProblemDemoFrame
            title="The Feed"
            description="Each ticket becomes a feed post that lets you explore the objectives, file changes, and delivery summaries."
          >
            <DemoFeedShowcase numberOfPosts={1} />
          </ProblemDemoFrame>
        ) : null}
        {page.slug === 'handoff-between-agents' ? (
          <ProblemDemoFrame
            title="Tickets & Objectives"
            description="Tickets are the durable record for a thread of work. Each ticket holds one or more objectives: the units of work the agent actually executes."
          >
            <DemoTicketDetails />
          </ProblemDemoFrame>
        ) : null}
        {page.slug === 'review-agent-diffs' ? (
          <ProblemDemoFrame
            title="Ticket activity"
            description="The activity feed shows the events that happened on the ticket: one checkpoint, an agent update, a user follow-up, the delivery, and the file changes with rationales the reviewer reads next."
          >
            <DemoTicketActivity />
          </ProblemDemoFrame>
        ) : null}
        {page.slug === 'juggling-repos' ? (
          <ProblemDemoFrame
            title="The Feed"
            description="Each ticket becomes a feed post that lets you explore the objectives, file changes, and delivery summaries."
          >
            <DemoFeedShowcase numberOfPosts={1} />
          </ProblemDemoFrame>
        ) : null}
      </section>

      {/* <section className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-3">
        {page.features.map(feature => (
          <article
            key={feature.title}
            className="rounded-2xl border border-white/10 bg-[#07101d]/70 p-5"
          >
            <CheckCircle2 className="size-5 text-sky-300" />
            <h2 className="mt-4 text-lg font-semibold text-white">{feature.title}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-300">{feature.description}</p>
          </article>
        ))}
      </section> */}

      {page.video ? (
        <section className="mx-auto w-full max-w-6xl">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
            <div className="relative aspect-video w-full">
              <iframe
                src={youtubeEmbedUrl(page.video) ?? ''}
                title="Product demo"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto w-full max-w-6xl rounded-2xl border border-white/10 bg-white/[0.035] p-6">
        <p className="font-mono text-[14px] uppercase tracking-widest text-sky-400">
          Agent-readable detail
        </p>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-300">{page.agentNote}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            asChild
            variant="outline"
            className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10"
          >
            <Link href="/llms.txt">llms.txt</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10"
          >
            <Link href="/overlord-context">Public context</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function ProblemDemoFrame({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#07101d]/70 p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-400">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
