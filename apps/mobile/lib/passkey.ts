import { Passkey, type PasskeyGetRequest, type PasskeyGetResult } from 'react-native-passkey';

import { getSupabase, isSupabaseConfigured, supabaseConfigError } from './supabase';

/**
 * Native passkey (WebAuthn) sign-in for the mobile app.
 *
 * supabase-js ships a high-level `auth.signInWithPasskey()` that drives the ceremony with the
 * browser `navigator.credentials` API. That API does not exist in React Native, so we instead use
 * the lower-level two-step `auth.passkey` API: ask the server for a challenge, run the ceremony
 * through the platform authenticator (Face ID / Touch ID / Android Credential Manager) via
 * react-native-passkey, then verify the resulting credential to mint a session.
 *
 * For this to resolve real credentials the app must declare an associated domain
 * (`webcredentials:<rpId>`) that matches the relying-party id configured in Supabase Auth, and that
 * domain must host the matching apple-app-site-association / assetlinks.json entries.
 */

/** Raised when the device cannot present a platform/security-key authenticator. */
export class PasskeyUnsupportedError extends Error {
  constructor() {
    super('Passkeys are not supported on this device.');
    this.name = 'PasskeyUnsupportedError';
  }
}

/** Raised when the user dismisses or cancels the system passkey sheet. */
export class PasskeyCancelledError extends Error {
  constructor() {
    super('Passkey sign-in was cancelled.');
    this.name = 'PasskeyCancelledError';
  }
}

function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // react-native-passkey surfaces user cancellation as `UserCancelled`; the browser/native
  // WebAuthn equivalent is a `NotAllowedError` DOMException.
  return (
    error.name === 'UserCancelled' ||
    error.name === 'NotAllowedError' ||
    /cancel/i.test(error.message)
  );
}

/**
 * Run the full passkey authentication ceremony and establish a Supabase session.
 *
 * On success the session is persisted and a `SIGNED_IN` event is emitted by supabase-js, so the
 * AuthProvider's `onAuthStateChange` listener will pick it up automatically.
 *
 * @throws {PasskeyUnsupportedError} when the device lacks passkey support.
 * @throws {PasskeyCancelledError} when the user cancels the system sheet.
 * @throws {Error} for configuration or server-side verification failures.
 */
export async function signInWithPasskey(): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error(supabaseConfigError ?? 'Supabase is not configured.');
  }

  if (!Passkey.isSupported()) {
    throw new PasskeyUnsupportedError();
  }

  const supabase = getSupabase();

  const { data: challenge, error: challengeError } =
    await supabase.auth.passkey.startAuthentication();
  if (challengeError) throw challengeError;
  if (!challenge) {
    throw new Error('Could not start passkey sign-in.');
  }

  // The server returns options in W3C `PublicKeyCredentialRequestOptionsJSON` form, which already
  // matches react-native-passkey's request shape (base64url challenge + credential ids). `rpId` is
  // optional in the spec type but required by the native module and always set by Supabase Auth.
  // The two libraries model `transports`/extensions with structurally-identical but nominally
  // distinct enums, so we hand the JSON across the boundary with a single cast.
  const { rpId } = challenge.options;
  if (!rpId) {
    throw new Error('Passkey challenge did not include a relying party id.');
  }

  const request = {
    challenge: challenge.options.challenge,
    rpId,
    timeout: challenge.options.timeout,
    userVerification: challenge.options.userVerification,
    allowCredentials: challenge.options.allowCredentials
  } as PasskeyGetRequest;

  let credential: PasskeyGetResult;
  try {
    credential = await Passkey.get(request);
  } catch (error) {
    if (isCancellation(error)) {
      throw new PasskeyCancelledError();
    }
    throw error;
  }

  // The native result is a complete W3C `AuthenticationResponseJSON`; react-native-passkey and
  // supabase-js model the same JSON with structurally-identical but nominally distinct types, so we
  // assert it to the exact shape `verifyAuthentication` expects.
  type VerifyCredential = Parameters<
    typeof supabase.auth.passkey.verifyAuthentication
  >[0]['credential'];

  const { data, error: verifyError } = await supabase.auth.passkey.verifyAuthentication({
    challengeId: challenge.challenge_id,
    credential: credential as unknown as VerifyCredential
  });
  if (verifyError) throw verifyError;
  if (!data?.session) {
    throw new Error('Passkey sign-in did not return a session.');
  }
}
