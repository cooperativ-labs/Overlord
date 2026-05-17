import type { Metadata } from 'next';
import Link from 'next/link';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { HomepageFooter } from '@/components/marketing/HomepageFooter';
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
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-3xl px-6 py-16 lg:px-8">
        <header className="mb-12">
          <p className="font-mono text-xs font-semibold uppercase tracking-widest text-sky-600">
            Overlord
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-slate-950">
            What&apos;s New
          </h1>
          <p className="mt-3 text-base text-slate-600">
            Recent updates and improvements to Overlord.
          </p>
        </header>

        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">
            No changelog entries published yet — check back soon.
          </div>
        ) : (
          <div className="space-y-12">
            {entries.map(entry => (
              <article
                key={entry.id}
                className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/changelog/${entry.slug}`}
                    className="font-display text-2xl font-semibold tracking-tight text-slate-950 hover:text-sky-700"
                  >
                    {entry.title}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {formatDate(entry.published_at)}
                    {entry.version ? ` · v${entry.version}` : ''}
                  </div>
                </div>
                {entry.summary ? (
                  <p className="mt-2 text-sm text-slate-600">{entry.summary}</p>
                ) : null}
                <div className="mt-6">
                  <MarkdownContent>{entry.body_markdown}</MarkdownContent>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
      <HomepageFooter />
    </div>
  );
}
