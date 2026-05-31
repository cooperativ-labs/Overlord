import './globals.css';

import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import { Toaster } from 'sonner';

import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { RootThemeProvider } from '@/components/root-theme-provider';
import { getSiteMetadataBaseUrl } from '@/lib/env';
import { displayFont, monoFont } from '@/lib/fonts';

export const metadata: Metadata = {
  metadataBase: new URL(getSiteMetadataBaseUrl()),
  title: 'Overlord',
  description: 'Stop juggling AI agents. Organize, manage, and launch agent work with Overlord.',
  icons: {
    apple: '/images/256.png'
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Overlord',
    startupImage: '/images/1024.png'
  },
  alternates: {
    canonical: 'https://www.ovld.ai'
  },
  openGraph: {
    title: 'Overlord',
    description: 'Stop juggling AI agents. Organize, manage, and launch agent work with Overlord.',
    images: ['/images/social/overlord-header.png']
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Overlord',
    description: 'Stop juggling AI agents. Organize and launch agent work with Overlord.',
    images: ['/images/social/overlord-header.png']
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
        <RootThemeProvider>
          <ServiceWorkerRegister />
          {children}
          <Toaster />
        </RootThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
