import './globals.css';

import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';

import { AppSidebar } from '@/components/app-sidebar';
import { AnnouncementBar } from '@/components/features/announcement-bar/AnnouncementBar';
import { WebAuthGate } from '@/components/features/auth/WebAuthGate';
import { ElectronAuthGate } from '@/components/features/electron-auth/ElectronAuthGate';
import { ElectronOfflineGate } from '@/components/features/electron-offline/ElectronOfflineGate';
import { TutorialProvider } from '@/components/features/onboarding/TutorialWizardContext';
import { TutorialWizardModal } from '@/components/features/onboarding/TutorialWizardModal';
import { DefaultProjectProvider } from '@/components/features/projects/DefaultProjectContext';
import { ProjectCreatorProvider } from '@/components/features/projects/ProjectCreatorContext';
import { ElectronDetector } from '@/components/features/terminal/ElectronDetector';
import { TerminalProvider } from '@/components/features/terminal/TerminalProvider';
import { NavHeader } from '@/components/nav-header';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { ThemeProvider } from '@/components/theme-provider';
import { SidePanel, SidePanelProvider } from '@/components/ui/side-panel';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getOnboardingState } from '@/lib/actions/onboarding';
import { getUserOrganizations } from '@/lib/actions/organizations';
import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import { getProjectsForCurrentUser } from '@/lib/actions/projects';
import { DEFAULT_PROJECT_COOKIE } from '@/lib/default-project';
import { SELECTED_ORG_COOKIE } from '@/lib/selected-org';
import { createClient } from '@/supabase/utils/server';

const displayFont = localFont({
  src: '../public/fonts/SpaceGrotesk-Variable.woff2',
  variable: '--font-display',
  display: 'block',
  weight: '300 700'
});

const monoFont = localFont({
  src: [
    { path: '../public/fonts/IBMPlexMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/IBMPlexMono-Medium.woff2', weight: '500', style: 'normal' }
  ],
  variable: '--font-mono',
  display: 'block'
});

export const metadata: Metadata = {
  title: 'Overlord',
  description: 'Local-first AI agent orchestration dashboard',
  icons: {
    apple: '/images/256.png'
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Overlord',
    startupImage: '/images/1024.png'
  }
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

  // On web, redirect users who haven't completed org/project setup to /onboarding.
  // On Electron, continue showing the modal-based flow.
  // For users with org+project but incomplete tutorial, show modal from step 3+.
  let tutorialAutoOpen = false;
  let tutorialAutoStep = 1;
  let onboardingState = null;

  if (user) {
    // Check if this is an Electron request via User-Agent header
    const headersList = await headers();
    const userAgent = headersList.get('user-agent') ?? '';
    const isElectronRequest = userAgent.toLowerCase().includes('electron');
    if (isElectronRequest) {
      // Web users without org/project → redirect to full-page onboarding
      if (organizations.length === 0 || projects.length === 0) {
        // Electron users → show modal
        tutorialAutoOpen = true;
        tutorialAutoStep = organizations.length === 0 ? 1 : 2;
        onboardingState = {
          userName:
            (user.user_metadata as { name?: string; full_name?: string })?.name ??
            (user.user_metadata as { name?: string; full_name?: string })?.full_name ??
            user.email?.split('@')[0] ??
            null,
          hasOrganizations: organizations.length > 0,
          hasProjects: projects.length > 0,
          firstOrganizationId: organizations[0]?.id ?? null,
          onboardingCompletedStep: 0,
          onboardingSkipped: false,
          desktopSetupDone: false
        };
      } else {
        // Existing user with org+project — check tutorial progress
        const progress = await getOnboardingState();
        onboardingState = progress;
        const hasCompletedTutorial = progress.onboardingCompletedStep >= 4;
        const hasSkipped = progress.onboardingSkipped;
        if (!hasCompletedTutorial && !hasSkipped) {
          tutorialAutoOpen = true;
          tutorialAutoStep = Math.max(3, progress.onboardingCompletedStep + 1);
        }
      }
    }
  }

  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${monoFont.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ElectronDetector />
          <ServiceWorkerRegister />
          <WebAuthGate />
          <ElectronAuthGate />
          <ElectronOfflineGate>
            <TerminalProvider>
              <DefaultProjectProvider
                projects={projects}
                initialDefaultProjectId={initialDefaultProjectId}
              >
                <ProjectCreatorProvider>
                  <TutorialProvider
                    autoOpen={tutorialAutoOpen}
                    autoOpenStep={tutorialAutoStep}
                    initialState={onboardingState}
                  >
                    <SidebarProvider defaultOpen className="h-dvh min-h-0">
                      {user ? (
                        <div className="flex h-full w-full flex-col overflow-hidden">
                          <AnnouncementBar />
                          {/* Electron title bar drag region — hidden in browser */}
                          <div className="electron-drag-region shrink-0" />
                          <div className="flex min-h-0 flex-1 overflow-hidden">
                            <AppSidebar
                              user={{
                                name:
                                  user.user_metadata?.full_name ??
                                  user.email?.split('@')[0] ??
                                  'User',
                                email: user.email ?? '',
                                avatar:
                                  user.user_metadata?.picture ??
                                  user.user_metadata?.avatar_url ??
                                  ''
                              }}
                              projects={projects}
                              organizations={organizations}
                              selectedOrgId={selectedOrgId}
                            />
                            <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
                              <NavHeader />
                              <SidePanelProvider className="flex flex-col overflow-hidden">
                                <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
                                  <main className="flex min-h-0 min-w-0 flex-col w-full overflow-hidden">
                                    {children}
                                  </main>
                                  <SidePanel />
                                </div>
                              </SidePanelProvider>
                            </SidebarInset>
                          </div>
                        </div>
                      ) : (
                        <div className="flex w-full flex-col ">
                          <AnnouncementBar />
                          <main className="w-full h-full ">{children}</main>
                        </div>
                      )}
                      <TutorialWizardModal />
                    </SidebarProvider>
                  </TutorialProvider>
                </ProjectCreatorProvider>
              </DefaultProjectProvider>
            </TerminalProvider>
          </ElectronOfflineGate>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
