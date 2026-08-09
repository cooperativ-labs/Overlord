import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { AppBannerProvider, AppBannerRoot } from './components/app-banners';
import { AuthGate } from './components/auth/AuthGate.tsx';
import { NotificationRenderer } from './components/notifications/NotificationRenderer.tsx';
import { ThemeProvider } from './components/theme-provider.tsx';
import { TooltipProvider } from './components/ui/tooltip.tsx';
import { applyDesktopChromeDocumentAttributes } from './lib/desktop-chrome.ts';
import { syncDesktopNativeTheme } from './lib/desktop-native-theme.ts';
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
    const onNavigate = window.overlord?.onNavigate;
    if (!onNavigate) return;
    return onNavigate(route => {
      const match = /^\/user\/missions\/([A-Za-z0-9:_-]{1,64})$/.exec(route);
      if (!match) return;
      void router.navigate({ to: '/user/missions/$missionId', params: { missionId: match[1] } });
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
