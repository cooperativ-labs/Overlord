import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: 'https://aa0c95110792065107c70ff26e11cab2@o4508852831977472.ingest.us.sentry.io/4511274266263552',
  // Sentry 10.50's Node OTel auto-setup currently calls helpers that are missing in
  // the runtime package graph we deploy. Keep server error reporting enabled while
  // bypassing the incompatible instrumentation hook path.
  skipOpenTelemetrySetup: true,
  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: true
});
