/**
 * Android Digital Asset Links (assetlinks.json).
 *
 * Served at https://ovld.ai/.well-known/assetlinks.json (and on the www. host).
 * Android's Credential Manager fetches this to verify that the native app may
 * use passkeys / login credentials associated with this domain — the Android
 * equivalent of the Apple App Site Association webcredentials block.
 *
 * The `get_login_creds` relation is what enables passkeys; `handle_all_urls`
 * is included so the same file also supports Android App Links if/when the app
 * registers `https` intent filters for this domain.
 *
 * Android requires the SHA-256 fingerprint(s) of the certificate(s) used to
 * sign the app. There is no native Android build in this repo yet, so the
 * fingerprints are supplied via env (comma-separated) rather than hard-coded:
 *
 *   ANDROID_SHA256_CERT_FINGERPRINTS="AA:BB:...,CC:DD:..."
 *
 * Until that env var is set on the deployment, the file is served with an empty
 * fingerprint list and Android passkeys will not verify. Get the fingerprint
 * for a Play-signed app from Play Console → App integrity → App signing, or for
 * a locally signed build via:
 *   keytool -list -v -keystore <keystore> -alias <alias>
 */

export const dynamic = 'force-static';

const ANDROID_PACKAGE_NAME = process.env.ANDROID_PACKAGE_NAME ?? 'com.cooperativ.overlord';

const sha256CertFingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? '')
  .split(',')
  .map(fp => fp.trim())
  .filter(Boolean);

export async function GET() {
  const statements = [
    {
      relation: [
        'delegate_permission/common.get_login_creds',
        'delegate_permission/common.handle_all_urls'
      ],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: sha256CertFingerprints
      }
    }
  ];

  return new Response(JSON.stringify(statements), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
