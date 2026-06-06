import { Metadata } from 'next';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Overlord | Authentication',
  description: 'Authenticate to access your Overlord account'
};

export default function AuthLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
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
            loading="eager"
          />
        </div>

        {/* Main Content */}
        <main className="flex items-center justify-center px-4 pb-8">{children}</main>
      </div>
    </>
  );
}
