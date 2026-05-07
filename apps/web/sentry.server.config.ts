// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: 'https://aa0c95110792065107c70ff26e11cab2@o4508852831977472.ingest.us.sentry.io/4511274266263552',

  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: true,

  // Node.js 24 ships undici v7 which removed getHttpClientSubscriptions.
  // Disable undici instrumentation until Sentry supports the new API.
  integrations: (integrations) =>
    integrations.map((integration) =>
      integration.name === 'Http'
        ? Sentry.httpIntegration({ undici: false })
        : integration
    )
});
