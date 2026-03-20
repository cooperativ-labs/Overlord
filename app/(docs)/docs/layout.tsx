import '../../globals.css';

import type { Metadata } from 'next';

import { ThemeProvider } from '@/components/theme-provider';
import { displayFont, monoFont } from '@/lib/fonts';

export const metadata: Metadata = {
  title: {
    default: 'Overlord Docs',
    template: '%s | Overlord Docs'
  },
  description:
    'Learn the Overlord workflow, product surfaces, and how to get from a ticket to reviewed agent work.'
};

export default function DocsLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${monoFont.variable}`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
