import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { isAdminEmail } from '@/lib/auth/admin';
import { createClientForRequest } from '@/supabase/utils/server';

import { SLIDESHOWS } from './(components)/registry';

function isLocalhost(host: string | null): boolean {
  return host?.split(':')[0] === 'localhost' || host?.split(':')[0] === '127.0.0.1';
}

export default async function PresentationsPage() {
  const headersList = await headers();
  const host = headersList.get('host');

  if (!isLocalhost(host)) {
    const supabase = await createClientForRequest();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user || !isAdminEmail(user.email)) {
      redirect('/');
    }
  }

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
              {SLIDESHOWS[slug].public && (
                <span className="ml-auto rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                  public
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
