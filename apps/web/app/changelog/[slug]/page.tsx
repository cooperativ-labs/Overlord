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
    <div className="mx-auto max-w-3xl py-4 lg:py-8">
      <nav className="mb-8">
        <Link href="/changelog" className="text-sm text-sky-400 hover:text-sky-300">
          ← All updates
        </Link>
      </nav>

      <article className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-[0_20px_80px_-48px_rgba(15,23,42,0.75)]">
        <header>
          <div className="text-xs text-slate-400">
            {formatDate(entry.published_at)}
            {entry.version ? ` · v${entry.version}` : ''}
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white">
            {entry.title}
          </h1>
          {entry.summary ? <p className="mt-3 text-base text-slate-300">{entry.summary}</p> : null}
        </header>
        <div className="mt-8 [&_.prose]:text-slate-200 [&_.prose_a]:text-sky-400 [&_.prose_headings]:text-white [&_.prose_strong]:text-white">
          <MarkdownContent>{entry.body_markdown}</MarkdownContent>
        </div>
      </article>
    </div>
  );
}
