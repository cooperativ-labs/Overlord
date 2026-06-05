import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

/**
 * iOS Keychain defaults to `whenUnlocked`; background auto-refresh can read storage while the app
 * is not interactive and fail with "User interaction is not allowed." This accessibility class
 * matches our other mobile secrets and allows reads after first device unlock.
 */
const supabaseAuthSecureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

const ExpoSecureStoreAdapter = {
  getItem(key: string) {
    return SecureStore.getItemAsync(key, supabaseAuthSecureStoreOptions);
  },
  setItem(key: string, value: string) {
    return SecureStore.setItemAsync(key, value, supabaseAuthSecureStoreOptions);
  },
  removeItem(key: string) {
    return SecureStore.deleteItemAsync(key, supabaseAuthSecureStoreOptions);
  }
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

function getSupabaseHost(url: string) {
  if (!url) return 'missing';

  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

const missingSupabaseConfig = [
  !supabaseUrl ? 'EXPO_PUBLIC_SUPABASE_URL' : null,
  !supabasePublishableKey ? 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY' : null
].filter(Boolean) as string[];

export const supabaseConfigError =
  missingSupabaseConfig.length > 0
    ? `Missing required Expo env var${missingSupabaseConfig.length > 1 ? 's' : ''}: ${missingSupabaseConfig.join(', ')}`
    : null;

export const supabaseRuntimeInfo = {
  host: getSupabaseHost(supabaseUrl),
  publishableKeyPrefix: supabasePublishableKey ? supabasePublishableKey.slice(0, 20) : 'missing'
};

let supabaseClient: SupabaseClient | null = null;

export function isSupabaseConfigured() {
  return supabaseConfigError === null;
}

export function getSupabase() {
  if (supabaseConfigError) {
    throw new Error(supabaseConfigError);
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        storage: ExpoSecureStoreAdapter,
        // RN is treated as "always foreground" by gotrue-js unless we manage refresh ourselves.
        // Leaving this true runs refresh ticks in the background and can break iOS SecureStore.
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
        // Enables the `supabase.auth.passkey.*` two-step WebAuthn API used by lib/passkey.ts.
        // The high-level `signInWithPasskey` relies on browser `navigator.credentials`, which
        // does not exist in React Native, so we drive the ceremony with a native authenticator.
        experimental: {
          passkey: true
        }
      }
    });
  }

  return supabaseClient;
}
