import localFont from 'next/font/local';

export const displayFont = localFont({
  src: '../apps/web/public/fonts/SpaceGrotesk-Variable.woff2',
  variable: '--font-display',
  display: 'swap',
  weight: '300 700'
});

export const monoFont = localFont({
  src: [
    {
      path: '../apps/web/public/fonts/IBMPlexMono-Regular.woff2',
      weight: '400',
      style: 'normal'
    },
    {
      path: '../apps/web/public/fonts/IBMPlexMono-Medium.woff2',
      weight: '500',
      style: 'normal'
    }
  ],
  variable: '--font-mono',
  display: 'swap'
});
