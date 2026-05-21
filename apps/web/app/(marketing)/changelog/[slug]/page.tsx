import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { getChangelogEntryBySlugAction } from '@/lib/actions/changelog';

type PageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = await getChangelogEntryBySlugAction(slug);
  if (!entry) {
    return { title: 'Changelog | Overlord' };
  }
  return {
    title: `${entry.title} | Overlord Changelog`,
    description: entry.summary ?? undefined
  };
}

function formatDate(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(value));
}

export default async function ChangelogEntryPage({ params }: PageProps) {
  const { slug } = await params;
  const entry = await getChangelogEntryBySlugAction(slug);
  if (!entry) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-[640px] px-1 py-4 sm:px-2 lg:py-8">
      <nav className="mb-8 px-1">
        <Link
          href="/changelog"
          className="text-sm font-medium text-[#57534e] underline decoration-[#d6d3ce] underline-offset-4 transition-colors hover:text-stone-900 hover:decoration-stone-900 dark:text-sky-400 dark:decoration-sky-400/40 dark:hover:text-sky-300"
        >
          ← All updates
        </Link>
      </nav>

      <article className="rounded-[20px] border border-[#e7e5e0] bg-white px-7 py-9 shadow-sm sm:px-11 sm:py-11 dark:border-white/10 dark:bg-white/5 dark:shadow-[0_20px_80px_-48px_rgba(15,23,42,0.75)]">
        <p className="font-mono text-[11px] font-medium tracking-[0.22em] text-[#a8a29e] uppercase">
          Changelog
          <span className="mx-2 text-[#d6d3ce] dark:text-white/20">·</span>
          <span className="tracking-wide text-[#57534e] dark:text-slate-300">
            {formatDate(entry.published_at)}
            {entry.version ? ` · v${entry.version}` : ''}
          </span>
        </p>

        <h1 className="mt-3 font-display text-[1.75rem] font-semibold leading-[1.05] tracking-tight text-stone-900 sm:text-[2.125rem] dark:text-white">
          {entry.title}
        </h1>

        {entry.summary ? (
          <p className="mt-3 text-base leading-relaxed text-[#57534e] dark:text-slate-300">
            {entry.summary}
          </p>
        ) : null}

        <div className="my-7 h-px bg-[#e7e5e0] dark:bg-white/10" role="separator" />

        <MarkdownContent variant="changelog">{entry.body_markdown}</MarkdownContent>

        <div className="mt-8">
          <Link
            href="/changelog"
            className="inline-flex rounded-full bg-stone-900 px-7 py-3.5 text-[15px] font-semibold tracking-tight text-[#fafaf7] no-underline transition-colors hover:bg-stone-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
          >
            All updates →
          </Link>
        </div>
      </article>
    </div>
  );
}
