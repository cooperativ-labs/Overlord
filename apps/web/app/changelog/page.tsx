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
    <div className="mx-auto max-w-3xl py-4 lg:py-8">
      <header className="mb-12">
        <p className="font-mono text-xs font-semibold uppercase tracking-widest text-sky-400">
          Overlord
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white">
          What&apos;s New
        </h1>
        <p className="mt-3 text-base text-slate-300">
          Recent updates and improvements to Overlord.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-6 py-16 text-center text-sm text-slate-400">
          No changelog entries published yet — check back soon.
        </div>
      ) : (
        <div className="space-y-12">
          {entries.map(entry => (
            <article
              key={entry.id}
              className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-[0_20px_80px_-48px_rgba(15,23,42,0.75)]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/changelog/${entry.slug}`}
                  className="font-display text-2xl font-semibold tracking-tight text-white hover:text-sky-300"
                >
                  {entry.title}
                </Link>
                <div className="text-xs text-slate-400">
                  {formatDate(entry.published_at)}
                  {entry.version ? ` · v${entry.version}` : ''}
                </div>
              </div>
              {entry.summary ? (
                <p className="mt-2 text-sm text-slate-300">{entry.summary}</p>
              ) : null}
              <div className="mt-6 [&_.prose]:text-slate-200 [&_.prose_a]:text-sky-400 [&_.prose_headings]:text-white [&_.prose_strong]:text-white">
                <MarkdownContent>{entry.body_markdown}</MarkdownContent>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
