import { createSign } from 'node:crypto';
import http2 from 'node:http2';

/**
 * Shared APNs signing and transport for both push surfaces (coo:439 Live
 * Activities and coo:444 standard notifications). Only the credentials and the
 * HTTP/2 mechanics are shared — topics, push types, priorities, and token
 * tables stay owned by each dispatcher, because an ActivityKit token and a
 * device token are not interchangeable.
 */
export type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  /** Host implied by OVERLORD_APNS_ENV; per-registration environments override it. */
  host: string;
};

export type ApnsResult = { status: number; body: string };

const SANDBOX_HOST = 'https://api.sandbox.push.apple.com';
const PRODUCTION_HOST = 'https://api.push.apple.com';

export function apnsHostFor(environment: 'sandbox' | 'production'): string {
  return environment === 'sandbox' ? SANDBOX_HOST : PRODUCTION_HOST;
}

/**
 * Reads APNs credentials from the environment. Returns `null` when any piece is
 * missing so local development stays fully functional with no APNs account:
 * callers treat `null` as "enqueue, but do not attempt delivery".
 */
export function apnsConfig(): ApnsConfig | null {
  const teamId = process.env.OVERLORD_APNS_TEAM_ID?.trim();
  const keyId = process.env.OVERLORD_APNS_KEY_ID?.trim();
  const privateKey = process.env.OVERLORD_APNS_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const bundleId = process.env.OVERLORD_IOS_BUNDLE_ID?.trim();
  if (!teamId || !keyId || !privateKey || !bundleId) return null;
  return {
    teamId,
    keyId,
    privateKey,
    bundleId,
    host: apnsHostFor(process.env.OVERLORD_APNS_ENV === 'sandbox' ? 'sandbox' : 'production')
  };
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

export function apnsJwt(config: ApnsConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }))}.${b64url(
    JSON.stringify({ iss: config.teamId, iat: now })
  )}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign({ key: config.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}

/**
 * `410 Unregistered` and `400 BadDeviceToken` mean the registration will never
 * work again, so the owning dispatcher retires the row instead of retrying.
 */
export function isRetiredTokenResponse(result: ApnsResult): boolean {
  if (result.status === 410) return true;
  return result.status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(result.body);
}

/**
 * Sends one APNs request. Each call opens and closes its own HTTP/2 session;
 * connection pooling is a deliberate later optimization, not a contract change.
 */
export async function sendApnsRequest({
  token,
  body,
  config,
  headers,
  host
}: {
  token: string;
  body: string;
  config: ApnsConfig;
  /** Surface-specific headers: topic, push type, priority, collapse id, expiration. */
  headers: Record<string, string>;
  /** Overrides `config.host` so a sandbox registration is never sent to production. */
  host?: string;
}): Promise<ApnsResult> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(host ?? config.host);
    let settled = false;
    const finish = (result: ApnsResult) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
    };
    client.once('error', error => {
      if (settled) return;
      settled = true;
      client.close();
      reject(error);
    });
    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsJwt(config)}`,
      'content-type': 'application/json',
      ...headers
    });
    let status = 0;
    let response = '';
    request.on('response', responseHeaders => {
      status = Number(responseHeaders[':status'] ?? 0);
    });
    request.setEncoding('utf8');
    request.on('data', chunk => {
      response += chunk;
    });
    request.once('end', () => finish({ status, body: response.slice(0, 512) }));
    request.once('error', reject);
    request.end(body);
  });
}
