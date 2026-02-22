import './globals.css';

import type { Metadata } from 'next';

import { AppSidebar } from '@/components/app-sidebar';
import { ProjectCreatorProvider } from '@/components/features/projects/ProjectCreatorContext';
import { ElectronDetector } from '@/components/features/terminal/ElectronDetector';
import { TerminalPanel } from '@/components/features/terminal/TerminalPanel';
import { TerminalProvider } from '@/components/features/terminal/TerminalProvider';
import { NavHeader } from '@/components/nav-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { createClient } from '@/supabase/utils/server';

export const metadata: Metadata = {
  title: 'Overlord',
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
        <ElectronDetector />
        <TerminalProvider>
          <ProjectCreatorProvider>
            <SidebarProvider defaultOpen>
              {user ? (
                <div className="flex h-dvh w-full flex-col overflow-hidden">
                  {/* Electron title bar drag region — hidden in browser */}
                  <div className="electron-drag-region shrink-0" />
                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    <AppSidebar
                      user={{
                        name: user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'User',
                        email: user.email ?? '',
                        avatar: user.user_metadata?.avatar_url ?? ''
                      }}
                      projects={projects}
                    />
                    <SidebarInset className="min-w-0 overflow-hidden">
                      <NavHeader userEmail={user.email ?? ''} />
                      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                        {children}
                      </main>
                      <TerminalPanel />
                    </SidebarInset>
                  </div>
                </div>
              ) : (
                <main className="min-h-dvh w-full ">{children}</main>
              )}
            </SidebarProvider>
          </ProjectCreatorProvider>
        </TerminalProvider>
      </body>
    </html>
  );
}
