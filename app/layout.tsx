import './globals.css';

import type { Metadata } from 'next';
import Link from 'next/link';

import { AppSidebar } from '@/components/app-sidebar';
import { NewTicketButton } from '@/components/features/NewTicketButton';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { signOut } from '@/lib/actions/auth';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
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

  const projects = await getProjectsForCurrentUser();

  return (
    <html lang="en">
      <body>
        <SidebarProvider defaultOpen>
          {user ? (
            <div className="flex h-dvh w-full overflow-hidden">
              <AppSidebar
                user={{
                  name: user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'User',
                  email: user.email ?? '',
                  avatar: user.user_metadata?.avatar_url ?? ''
                }}
                projects={projects}
              />
              <SidebarInset className="min-w-0 overflow-hidden">
                <header className="flex flex-col gap-4 border-b bg-card p-4 text-card-foreground md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="h-4" />
                    <h1 className="text-xl leading-tight font-semibold">
                      <Link href="/">Orchestrator</Link>
                    </h1>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground max-w-full truncate text-sm">
                      {user.email}
                    </span>
                    <form action={signOut}>
                      <Button type="submit" variant="ghost">
                        Sign out
                      </Button>
                    </form>
                    <NewTicketButton />
                  </div>
                </header>
                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                  {children}
                </main>
              </SidebarInset>
            </div>
          ) : (
            <main className="min-h-dvh ">{children}</main>
          )}
        </SidebarProvider>
      </body>
    </html>
  );
}
