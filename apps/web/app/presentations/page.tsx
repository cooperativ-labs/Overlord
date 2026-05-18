import Link from 'next/link';

import { SLIDESHOWS } from './(components)/registry';

export default function PresentationsPage() {
  const slugs = Object.keys(SLIDESHOWS);

  return (
    <div className="min-h-screen bg-background p-8">
      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight text-foreground">
        Presentations
      </h1>
      <ul className="space-y-3">
        {slugs.map(slug => (
          <li key={slug}>
            <Link
              href={`/presentations/${slug}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 text-foreground shadow-sm transition hover:bg-muted/60"
            >
              <span className="font-mono text-sm text-muted-foreground">{slug}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
