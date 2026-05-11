import './globals.css';

import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import { Toaster } from 'sonner';

import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { ThemeProvider } from '@/components/theme-provider';
import { getSiteMetadataBaseUrl } from '@/lib/env';
import { displayFont, monoFont } from '@/lib/fonts';

export const metadata: Metadata = {
  metadataBase: new URL(getSiteMetadataBaseUrl()),
  title: 'Overlord AI',
  description: 'Stop juggling AI agents. Organize and launch agent work with Overlord.',
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
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${displayFont.variable} ${monoFont.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ServiceWorkerRegister />
          {children}
          <Toaster />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
