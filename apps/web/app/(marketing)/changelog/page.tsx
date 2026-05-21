import type { Metadata } from 'next';
import Link from 'next/link';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { listPublishedChangelogEntriesAction } from '@/lib/actions/changelog';

export const metadata: Metadata = {
  title: "What's New | Overlord",
  description: 'Release notes and recent updates to Overlord.'
};

export const dynamic = 'force-dynamic';

function formatDate(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(value));
}

export default async function ChangelogIndexPage() {
  const entries = await listPublishedChangelogEntriesAction(50);

  return (
    <div className="mx-auto max-w-[640px] px-1 py-4 sm:px-2 lg:py-8">
      <header className="mb-10 px-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl dark:text-white">
          What&apos;s New
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[#57534e] dark:text-slate-300">
          Recent updates and improvements to Overlord.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-stone-200 bg-white px-6 py-16 text-center text-sm text-[#57534e] dark:border-white/15 dark:bg-white/5 dark:text-slate-400">
          No changelog entries published yet — check back soon.
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {entries.map(entry => (
            <article
              key={entry.id}
              className="rounded-[20px] border border-[#e7e5e0] bg-white px-7 py-9 shadow-sm sm:px-11 sm:py-11 dark:border-white/10 dark:bg-white/5 dark:shadow-[0_20px_80px_-48px_rgba(15,23,42,0.75)]"
            >
              <p className="font-mono text-[11px] font-medium tracking-[0.22em] text-[#a8a29e] uppercase">
                Changelog
                <span className="mx-2 text-[#d6d3ce] dark:text-white/20">·</span>
                <span className="tracking-wide text-[#57534e] dark:text-slate-300">
                  {formatDate(entry.published_at)}
                  {entry.version ? ` · v${entry.version}` : ''}
                </span>
              </p>

              <h2 className="mt-3 font-display text-[1.75rem] font-semibold leading-[1.05] tracking-tight text-stone-900 sm:text-[2.125rem] dark:text-white">
                <Link
                  href={`/changelog/${entry.slug}`}
                  className="transition-colors hover:text-stone-600 dark:hover:text-sky-300"
                >
                  {entry.title}
                </Link>
              </h2>

              {entry.summary ? (
                <p className="mt-3 text-base leading-relaxed text-[#57534e] dark:text-slate-300">
                  {entry.summary}
                </p>
              ) : null}

              <div className="my-7 h-px bg-[#e7e5e0] dark:bg-white/10" role="separator" />

              <MarkdownContent variant="changelog">{entry.body_markdown}</MarkdownContent>

              <div className="mt-8">
                <Link
                  href={`/changelog/${entry.slug}`}
                  className="inline-flex rounded-full bg-stone-900 px-7 py-3.5 text-[15px] font-semibold tracking-tight text-[#fafaf7] no-underline transition-colors hover:bg-stone-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
                >
                  Read full update →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
