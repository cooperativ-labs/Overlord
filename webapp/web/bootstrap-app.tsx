import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { AppBannerProvider, AppBannerRoot } from './components/app-banners';
import { AuthGate } from './components/auth/AuthGate.tsx';
import { NotificationRenderer } from './components/notifications/NotificationRenderer.tsx';
import { ThemeProvider } from './components/theme-provider.tsx';
import { TooltipProvider } from './components/ui/tooltip.tsx';
import { applyDesktopChromeDocumentAttributes, getDesktopBridge } from './lib/desktop-chrome.ts';
import { syncDesktopNativeTheme } from './lib/desktop-native-theme.ts';
import { parseDesktopMissionShellRoute } from './lib/mission-panel-search.ts';
import { RealtimeProvider } from './lib/realtime.tsx';
import { router } from './router.tsx';

applyDesktopChromeDocumentAttributes();
syncDesktopNativeTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

function DesktopDeepLinkNavigation() {
  useEffect(() => {
    const onNavigate = getDesktopBridge()?.onNavigate;
    if (!onNavigate) return;
    return onNavigate(route => {
      // An objective deep link (`?objective=coo:756.k7xm`) still opens the
      // mission panel — the objective is the thing being pointed at, the
      // mission is the surface that shows it. The query must survive this
      // navigate; dropping it made every objective URL land on the mission
      // with no focus target.
      const target = parseDesktopMissionShellRoute(route);
      if (!target) return;
      void router.navigate({
        to: '/user/missions/$missionId',
        params: { missionId: target.missionId },
        search: target.objectiveDisplayId ? { objective: target.objectiveDisplayId } : {}
      });
    });
  }, []);
  return null;
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <QueryClientProvider client={queryClient}>
          <AuthGate>
            <AppBannerProvider>
              <RealtimeProvider>
                <DesktopDeepLinkNavigation />
                <NotificationRenderer />
                <RouterProvider router={router} />
                <AppBannerRoot />
              </RealtimeProvider>
            </AppBannerProvider>
          </AuthGate>
        </QueryClientProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>
);
