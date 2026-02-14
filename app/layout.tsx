import './globals.css';

import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { signOut } from '@/lib/actions/auth';
import { createClient } from '@/supabase/utils/server';

export const metadata: Metadata = {
  title: 'Orchestrator',
  description: 'Local-first AI agent orchestration dashboard'
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body>
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8">
          <header className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl leading-tight font-semibold">
                <Link href="/tickets">Orchestrator</Link>
              </h1>
              <p className="text-muted-foreground text-sm">
                Ticket orchestration for external AI agents
              </p>
            </div>
            {user ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground max-w-full truncate text-sm">
                  {user.email}
                </span>
                <form action={signOut}>
                  <Button type="submit" variant="ghost">
                    Sign out
                  </Button>
                </form>
                <Button asChild>
                  <Link href="/tickets/new">New Ticket</Link>
                </Button>
              </div>
            ) : (
              <Button asChild>
                <Link href="/login">Sign in</Link>
              </Button>
            )}
          </header>
          <Separator />
          <main className="pb-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
