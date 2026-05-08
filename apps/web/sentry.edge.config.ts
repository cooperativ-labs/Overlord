import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: 'https://aa0c95110792065107c70ff26e11cab2@o4508852831977472.ingest.us.sentry.io/4511274266263552',
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: true
});
