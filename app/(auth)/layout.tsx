import '../globals.css';

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
          <div className="flex min-h-dvh w-full flex-col overflow-hidden items-center justify-center my-20">
            {/* Logo/Image Section */}
            <div className="flex flex-col items-center justify-center px-4 py-8">
              <img
                src="/images/512.png"
                alt="Overlord"
                className="h-20 w-20 object-contain rounded-4xl"
              />
            </div>

            {/* Main Content */}
            <main className="flex flex-1 items-center justify-center px-4 pb-8">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
