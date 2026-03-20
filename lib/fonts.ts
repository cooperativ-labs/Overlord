import localFont from 'next/font/local';

export const displayFont = localFont({
  src: '../public/fonts/SpaceGrotesk-Variable.woff2',
  variable: '--font-display',
  display: 'swap',
  weight: '300 700'
});

export const monoFont = localFont({
  src: [
    { path: '../public/fonts/IBMPlexMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/IBMPlexMono-Medium.woff2', weight: '500', style: 'normal' }
  ],
  variable: '--font-mono',
  display: 'swap'
});
