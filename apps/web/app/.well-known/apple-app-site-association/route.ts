/**
 * Apple App Site Association (AASA).
 *
 * Served at https://ovld.ai/.well-known/apple-app-site-association (and on the
 * www. host). iOS fetches this file — via Apple's CDN — to verify that the
 * native app is allowed to act on behalf of the domain.
 *
 * For passkeys this is what makes a credential registered against the
 * `ovld.ai` / `www.ovld.ai` relying-party id (e.g. one synced from 1Password)
 * available inside the native app's system passkey sheet. The app must declare
 * the matching `webcredentials:` Associated Domains entitlement, which it does
 * in apps/mobile/app.json / ios/Overlord/Overlord.entitlements.
 *
 * Requirements Apple enforces:
 *  - Path is exactly /.well-known/apple-app-site-association (no extension).
 *  - Content-Type is application/json.
 *  - Served over HTTPS with NO redirects (apex and www must each serve it
 *    directly — do not 301 www → apex on this path).
 *
 * The app identifier is `<TeamID>.<BundleID>`. Both are public values and can
 * be overridden via env if the team or bundle id ever changes.
 */

export const dynamic = 'force-static';

const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID ?? 'X84RPB4674';
const IOS_BUNDLE_ID = process.env.IOS_BUNDLE_ID ?? 'com.cooperativ.overlord';
const APP_ID = `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`;

export async function GET() {
  const association = {
    // Lets the native app use passkeys registered for this domain.
    webcredentials: {
      apps: [APP_ID]
    }
  };

  return new Response(JSON.stringify(association), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
