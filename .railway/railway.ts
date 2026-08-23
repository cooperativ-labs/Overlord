import {
  bucket,
  defineRailway,
  github,
  image,
  postgres,
  preserve,
  project,
  service,
  volume
} from 'railway/iac';

/**
 * Railway Infrastructure as Code for overlord-cloud.
 *
 * Preview: `railway config plan`
 * Apply:   `railway config apply` (only after reviewing the plan)
 *
 * Secrets stay as preserve() so remote values are not written to source.
 * Former railway.json settings (Dockerfile path, healthcheck) live on
 * overlord-backend below.
 */
export default defineRailway(() => {
  const Postgres = postgres('Postgres', { region: 'europe-west4-drams3a' });

  const postgresVolume = volume('postgres-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'europe-west4-drams3a',
    sizeMB: 5000
  });

  const racecarGatewayVolume = volume('racecar-gateway-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'europe-west4-drams3a',
    sizeMB: 5000
  });

  const overlordStorage = bucket('overlord-storage', { region: 'ams' });

  const racecarGateway = service('racecar-gateway', {
    source: image('ghcr.io/jchaselubitz/racecar-gateway:edge'),
    replicas: { 'europe-west4-drams3a': 1 },
    volumeMounts: {
      '/data': racecarGatewayVolume
    },
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: preserve(),
      DAYTONA_API_KEY: preserve(),
      DAYTONA_API_URL: preserve(),
      GH_AUTH_TOKEN: preserve(),
      GH_USERNAME: preserve(),
      OVERLORD_BACKEND_URL: preserve(),
      OVERLORD_USER_TOKEN: preserve(),
      RACECAR_GATEWAY_DEVICE_FINGERPRINT: preserve(),
      RACECAR_GATEWAY_STATE_DIR: preserve()
    }
  });

  const overlordBackend = service('overlord-backend', {
    source: github('cooperativ-labs/Overlord'),
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'backend/Dockerfile.railway'
    },
    healthcheck: '/api/health',
    healthcheckTimeout: 120,
    replicas: { 'europe-west4-drams3a': 1 },
    deploy: { restartPolicyMaxRetries: 5 },
    domains: ['backend.ovld.ai'],
    env: {
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      DATABASE_URL: preserve(),
      GEMINI_API_KEY: preserve(),
      GITHUB_CLIENT_ID: preserve(),
      GITHUB_CLIENT_SECRET: preserve(),
      GITHUB_USER_TOKEN_ENCRYPTION_KEY: preserve(),
      NODE_ENV: preserve(),
      OVERLORD_APNS_ENV: preserve(),
      OVERLORD_APNS_KEY_ID: preserve(),
      OVERLORD_APNS_PRIVATE_KEY: preserve(),
      OVERLORD_APNS_TEAM_ID: preserve(),
      OVERLORD_IOS_BUNDLE_ID: preserve(),
      OVERLORD_MCP_ENABLED: preserve(),
      OVERLORD_SITE_URL: preserve(),
      OVERLORD_SQL_STUDIO_ENABLED: preserve(),
      OVERLORD_WEBAPP_PUBLIC_URL: preserve(),
      OVERLORD_WEB_HOST: preserve(),
      OVERLORD_WEB_ORIGINS: preserve(),
      PGOPTIONS: preserve(),
      RESEND_API_KEY: preserve(),
      S3_ACCESS_KEY_ID: preserve(),
      S3_BUCKET: preserve(),
      S3_ENDPOINT: preserve(),
      S3_PATH_PREFIX: preserve(),
      S3_REGION: preserve(),
      S3_SECRET_ACCESS_KEY: preserve()
    }
  });

  return project('overlord-cloud', {
    resources: [
      racecarGateway,
      Postgres,
      overlordBackend,
      postgresVolume,
      racecarGatewayVolume,
      overlordStorage
    ]
  });
});
