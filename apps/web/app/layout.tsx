import './globals.css';

import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import { Toaster } from 'sonner';

import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { ThemeProvider } from '@/components/theme-provider';
import { displayFont, monoFont } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'Overlord',
  description: 'Stop juggling agents. Organize and launch AI agent work with Overlord.',
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
