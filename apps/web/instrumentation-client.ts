import * as Sentry from '@sentry/nextjs';

const isDevelopment = process.env.NODE_ENV === 'development';
const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron === true;
const webDsn =
  'https://aa0c95110792065107c70ff26e11cab2@o4508852831977472.ingest.us.sentry.io/4511274266263552';
const electronDsn =
  'https://4217dfda3fcd82c64dab291ea1d15aef@o4508852831977472.ingest.us.sentry.io/4511274027450368';

if (!isDevelopment) {
  Sentry.init({
    dsn: isElectron ? electronDsn : webDsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    integrations: isElectron ? [Sentry.replayIntegration()] : [],
    tracesSampleRate: 1,
    enableLogs: true,
    ...(isElectron
      ? {
          replaysSessionSampleRate: 0.1,
          replaysOnErrorSampleRate: 1.0
        }
      : {}),
    sendDefaultPii: true
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
