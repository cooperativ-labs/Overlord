import type { Metadata } from 'next';

import { AppSidebar } from '@/components/app-sidebar';
import { AgentModelsPrefetch } from '@/components/features/AgentModelSelector';
import { AnnouncementBar } from '@/components/features/announcement-bar/AnnouncementBar';
import { VersionTransitionBanner } from '@/components/features/announcement-bar/VersionTransitionBanner';
import { WebAuthGate } from '@/components/features/auth/WebAuthGate';
import { ChangelogToast } from '@/components/features/changelog/ChangelogToast';
import { ChangelogUpdateModal } from '@/components/features/changelog/ChangelogUpdateModal';
import {
  ElectronAuthBoundary,
  ElectronAuthGate
} from '@/components/features/electron-auth/ElectronAuthGate';
import { ElectronSessionEndedScreen } from '@/components/features/electron-auth/ElectronSessionEndedScreen';
import { ElectronSessionWatcher } from '@/components/features/electron-auth/ElectronSessionWatcher';
import { MainWindowNavigationBridge } from '@/components/features/electron-nav/MainWindowNavigationBridge';
import { ElectronOfflineGate } from '@/components/features/electron-offline/ElectronOfflineGate';
import { OfflineTicketProcessor } from '@/components/features/electron-offline/OfflineTicketProcessor';
import { RepoProfileMaintenance } from '@/components/features/electron-offline/RepoProfileMaintenance';
import { TutorialProvider } from '@/components/features/onboarding/TutorialWizardContext';
import { TutorialWizardModal } from '@/components/features/onboarding/TutorialWizardModal';
import { DefaultProjectProvider } from '@/components/features/projects/DefaultProjectContext';
import { ProjectCreatorProvider } from '@/components/features/projects/ProjectCreatorContext';
import {
  SystemNotificationProvider,
  SystemNotificationRoot
} from '@/components/features/system-notifications';
import { AutoAdvanceLauncher } from '@/components/features/terminal/AutoAdvanceLauncher';
import { ElectronDetector } from '@/components/features/terminal/ElectronDetector';
import { TerminalProvider } from '@/components/features/terminal/TerminalProvider';
import { NavHeader } from '@/components/nav-header';
import { AppQueryClientProvider } from '@/components/providers/query-client-provider';
import { SidePanel, SidePanelProvider } from '@/components/ui/side-panel';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getAllAgentConfigsAction } from '@/lib/actions/agent-config';
import { getAgentModelsAction } from '@/lib/actions/agent-models';
import { getUnreadChangelogEntriesAction } from '@/lib/actions/changelog';
import { getOnboardingState } from '@/lib/actions/onboarding';
import { getUserOrganizations } from '@/lib/actions/organizations';
import { fetchProfileSettings } from '@/lib/actions/profile-settings';
import {
  getArchivedProjectsForCurrentUser,
  getProjectsForCurrentUser
} from '@/lib/actions/projects';
import { getUserLaunchPreferenceAction } from '@/lib/actions/user-launch-preference';
import { isAppFeatureEnabled } from '@/lib/app-features';
import { isAdminEmail } from '@/lib/auth/admin';
import {
  createClientForRequest,
  getRequestDefaultProjectId,
  getRequestSelectedOrganizationId,
  getRequestSidebarOpen,
  isElectronRequestFromHeaders
} from '@/supabase/utils/server';

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
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [
    projects,
    archivedProjects,
    organizations,
    profileSettings,
    agentModels,
    agentConfigs,
    launchPreference,
    unreadChangelogEntries,
    slackEnabled
  ] = await Promise.all([
    getProjectsForCurrentUser(),
    getArchivedProjectsForCurrentUser(),
    user ? getUserOrganizations() : Promise.resolve([]),
    user ? fetchProfileSettings(supabase, user.id) : Promise.resolve(null),
    getAgentModelsAction(),
    user ? getAllAgentConfigsAction() : Promise.resolve({}),
    user ? getUserLaunchPreferenceAction() : Promise.resolve(null),
    user ? getUnreadChangelogEntriesAction() : Promise.resolve([]),
    isAppFeatureEnabled('slack')
  ]);

  const initialDefaultProjectId = await getRequestDefaultProjectId({
    profileDefaultProjectId: profileSettings?.default_project_id ?? null
  });
  const selectedOrgId = await getRequestSelectedOrganizationId({
    organizations,
    profilePreferences: profileSettings?.preferences
  });
  const sidebarDefaultOpen = await getRequestSidebarOpen();

  let tutorialAutoOpen = false;
  let tutorialAutoStep = 1;
  let onboardingState = null;

  const isElectronRequest = await isElectronRequestFromHeaders();

  if (user) {
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
          desktopSetupDone: false,
          desktopCompletedStep: 0,
          invitedOrganizationId: null
        };
      } else {
        // Existing user with org+project — check tutorial progress
        const progress = await getOnboardingState();
        onboardingState = progress;
        const hasCompletedTutorial = progress.onboardingCompletedStep >= 3;
        const hasSkipped = progress.onboardingSkipped;
        if (!hasCompletedTutorial && !hasSkipped) {
          tutorialAutoOpen = true;
          tutorialAutoStep = Math.max(2, progress.onboardingCompletedStep + 1);
        }
      }
    }
  }

  return (
    <div>
      <AgentModelsPrefetch
        models={agentModels}
        configs={agentConfigs}
        launchPreference={launchPreference}
      />
      <ElectronDetector />
      <MainWindowNavigationBridge />

      <WebAuthGate />
      <ElectronAuthGate />
      <ElectronOfflineGate>
        <ElectronAuthBoundary>
          <AppQueryClientProvider>
            <ElectronSessionWatcher />
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
                    <SystemNotificationProvider>
                      <SidebarProvider defaultOpen={sidebarDefaultOpen} className="h-dvh min-h-0">
                        {user ? (
                          <div className="flex h-full w-full flex-col overflow-hidden [--sidebar-top-offset:2.75rem]">
                            <OfflineTicketProcessor />
                            <AutoAdvanceLauncher />
                            <RepoProfileMaintenance projects={projects} />
                            <AnnouncementBar />
                            <VersionTransitionBanner />
                            <NavHeader projects={projects} />
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
                                isAdmin={isAdminEmail(user.email)}
                                projects={projects}
                                archivedProjects={archivedProjects}
                                organizations={organizations}
                                selectedOrgId={selectedOrgId}
                                slackEnabled={slackEnabled}
                              />
                              <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
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
                        ) : isElectronRequest ? (
                          // Desktop request the server could not authenticate.
                          // Never render a half-app (board without sidebar/nav);
                          // prompt a clean re-sign-in instead.
                          <ElectronSessionEndedScreen />
                        ) : (
                          <div className="flex w-full flex-col ">
                            <main className="w-full h-full ">{children}</main>
                          </div>
                        )}
                        <TutorialWizardModal />
                      </SidebarProvider>
                      <SystemNotificationRoot />
                      {user ? <ChangelogUpdateModal /> : null}
                      {user && unreadChangelogEntries.length > 0 ? (
                        <ChangelogToast
                          entries={unreadChangelogEntries.map(entry => ({
                            id: entry.id,
                            slug: entry.slug,
                            title: entry.title,
                            summary: entry.summary,
                            published_at: entry.published_at
                          }))}
                        />
                      ) : null}
                    </SystemNotificationProvider>
                  </TutorialProvider>
                </ProjectCreatorProvider>
              </DefaultProjectProvider>
            </TerminalProvider>
          </AppQueryClientProvider>
        </ElectronAuthBoundary>
      </ElectronOfflineGate>
    </div>
  );
}
