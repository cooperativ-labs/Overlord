import '../globals.css';

import Image from 'next/image';

import { ThemeProvider } from '@/components/theme-provider';

export default function AuthLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <header className="flex w-full h-14 electron-drag-region" />
          <div className="flex flex-col min-h-dvh w-full gap-8 overflow-hidden items-center justify-center">
            {/* Electron title bar drag region — hidden in browser */}
            <div className="electron-drag-region shrink-0" />
            {/* Logo/Image Section */}
            <div className="flex flex-col items-center justify-center px-4 py-8">
              <Image
                src="/images/256.png"
                alt="Overlord"
                className="h-32 w-32 object-contain rounded-4xl"
                width={128}
                height={128}
              />
            </div>

            {/* Main Content */}
            <main className="flex  items-center justify-center px-4 pb-8">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
