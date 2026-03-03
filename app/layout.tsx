import './globals.css';

import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { AppSidebar } from '@/components/app-sidebar';
import { AnnouncementBar } from '@/components/features/announcement-bar/AnnouncementBar';
import { DefaultProjectProvider } from '@/components/features/projects/DefaultProjectContext';
import { ProjectCreatorProvider } from '@/components/features/projects/ProjectCreatorContext';
import { ElectronDetector } from '@/components/features/terminal/ElectronDetector';
import { TerminalProvider } from '@/components/features/terminal/TerminalProvider';
import { TerminalWorkspace } from '@/components/features/terminal/TerminalWorkspace';
import { NavHeader } from '@/components/nav-header';
import { ThemeProvider } from '@/components/theme-provider';
import { SidePanel, SidePanelProvider } from '@/components/ui/side-panel';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getUserOrganizations } from '@/lib/actions/organizations';
import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { DEFAULT_PROJECT_COOKIE } from '@/lib/default-project';
import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';
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

  const [projects, organizations, profileSettings] = await Promise.all([
    getProjectsForCurrentUser(),
    user ? getUserOrganizations() : Promise.resolve([]),
    user ? fetchProfileSettings(supabase, user.id) : Promise.resolve(null)
  ]);

  const cookieStore = await cookies();
  const initialDefaultProjectId =
    profileSettings?.default_project_id ?? cookieStore.get(DEFAULT_PROJECT_COOKIE)?.value ?? null;
  const selectedOrgIdStr = cookieStore.get(SELECTED_ORG_COOKIE)?.value ?? null;
  const selectedOrgId = selectedOrgIdStr ? Number(selectedOrgIdStr) : null;

  return (
    <html lang="en">
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ElectronDetector />
          <TerminalProvider>
            <DefaultProjectProvider
              projects={projects}
              initialDefaultProjectId={initialDefaultProjectId}
            >
              <ProjectCreatorProvider>
                <SidebarProvider defaultOpen>
                  {user ? (
                    <div className="flex h-dvh w-full flex-col overflow-hidden">
                      <AnnouncementBar />
                      {/* Electron title bar drag region — hidden in browser */}
                      <div className="electron-drag-region shrink-0" />
                      <div className="flex min-h-0 flex-1 overflow-hidden">
                        <AppSidebar
                          user={{
                            name:
                              user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'User',
                            email: user.email ?? '',
                            avatar: user.user_metadata?.avatar_url ?? ''
                          }}
                          projects={projects}
                          organizations={organizations}
                          selectedOrgId={selectedOrgId}
                        />
                        <SidebarInset className="min-w-0 overflow-hidden">
                          <NavHeader userEmail={user.email ?? ''} />
                          <TerminalWorkspace>
                            <SidePanelProvider>
                              <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                                  {children}
                                </main>
                                <SidePanel />
                              </div>
                            </SidePanelProvider>
                          </TerminalWorkspace>
                        </SidebarInset>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-dvh w-full flex-col overflow-hidden">
                      <AnnouncementBar />
                      <main className="min-h-0 w-full flex-1 overflow-y-auto">{children}</main>
                    </div>
                  )}
                </SidebarProvider>
              </ProjectCreatorProvider>
            </DefaultProjectProvider>
          </TerminalProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
