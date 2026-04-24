import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: 'https://aa0c95110792065107c70ff26e11cab2@o4508852831977472.ingest.us.sentry.io/4511274266263552',
  integrations: [Sentry.replayIntegration()],
  tracesSampleRate: 1,
  enableLogs: true,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  sendDefaultPii: true
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
