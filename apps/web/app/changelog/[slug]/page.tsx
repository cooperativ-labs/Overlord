import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { HomepageFooter } from '@/components/marketing/HomepageFooter';
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
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-3xl px-6 py-16 lg:px-8">
        <nav className="mb-8">
          <Link href="/changelog" className="text-sm text-sky-700 hover:text-sky-900">
            ← All updates
          </Link>
        </nav>

        <article className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <header>
            <div className="text-xs text-slate-500">
              {formatDate(entry.published_at)}
              {entry.version ? ` · v${entry.version}` : ''}
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-950">
              {entry.title}
            </h1>
            {entry.summary ? (
              <p className="mt-3 text-base text-slate-600">{entry.summary}</p>
            ) : null}
          </header>
          <div className="mt-8">
            <MarkdownContent>{entry.body_markdown}</MarkdownContent>
          </div>
        </article>
      </main>
      <HomepageFooter />
    </div>
  );
}
