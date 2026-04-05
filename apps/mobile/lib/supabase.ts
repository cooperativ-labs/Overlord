import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const ExpoSecureStoreAdapter = {
  getItem(key: string) {
    return SecureStore.getItemAsync(key);
  },
  setItem(key: string, value: string) {
    return SecureStore.setItemAsync(key, value);
  },
  removeItem(key: string) {
    return SecureStore.deleteItemAsync(key);
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
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    });
  }

  return supabaseClient;
}
