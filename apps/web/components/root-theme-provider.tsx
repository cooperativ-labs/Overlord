'use client';

import { usePathname } from 'next/navigation';

import { ThemeProvider } from '@/components/theme-provider';
import { isMarketingRoute } from '@/lib/marketing-routes';

export function RootThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const marketing = isMarketingRoute(pathname);

  return (
    <ThemeProvider
      key={marketing ? 'marketing' : 'app'}
      attribute="class"
      defaultTheme={marketing ? 'dark' : 'system'}
      enableSystem
      disableTransitionOnChange
      storageKey={marketing ? 'overlord-marketing-theme' : 'theme'}
    >
      {children}
    </ThemeProvider>
  );
}
