import Link from 'next/link';

import { SLIDESHOWS } from './(components)/registry';

export default function PresentationsPage() {
  const slugs = Object.keys(SLIDESHOWS);

  return (
    <div className="p-8">
      <h1 className="mb-6 font-display text-3xl font-semibold text-white">Presentations</h1>
      <ul className="space-y-3">
        {slugs.map(slug => (
          <li key={slug}>
            <Link
              href={`/presentations/${slug}`}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-white transition hover:bg-white/10"
            >
              <span className="font-mono text-sm text-slate-400">{slug}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
