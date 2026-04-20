import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { createContext, useContext, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from './auth-context';
import { getSupabase, isSupabaseConfigured } from './supabase';

// Configure how notifications are displayed when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

const NotificationsContext = createContext<{ expoPushToken: string | null }>({
  expoPushToken: null
});

async function registerForPushNotificationsAsync(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[notifications] permission not granted');
    return null;
  }

  const projectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? Constants.expoConfig?.extra?.eas?.projectId;

  const tokenResponse = await Notifications.getExpoPushTokenAsync({
    projectId
  });

  return tokenResponse.data;
}

async function savePushToken(token: string) {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabase();

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return;

  const platform = Platform.OS as 'ios' | 'android';

  // Upsert the token (unique constraint on user_id + token)
  const { error } = await supabase.from('push_tokens').upsert(
    {
      user_id: user.id,
      token,
      platform,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,token' }
  );

  if (error) {
    console.error('[notifications] failed to save push token:', error.message);
  }
}

async function removePushToken(token: string) {
  if (!isSupabaseConfigured()) return;
  const supabase = getSupabase();

  const { error } = await supabase.from('push_tokens').delete().eq('token', token);
  if (error) {
    console.error('[notifications] failed to remove push token:', error.message);
  }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      // User logged out — remove the token from the database
      if (tokenRef.current) {
        void removePushToken(tokenRef.current);
        tokenRef.current = null;
      }
      return;
    }

    void registerForPushNotificationsAsync().then(token => {
      if (token) {
        tokenRef.current = token;
        void savePushToken(token);
      }
    });
  }, [user]);

  return (
    <NotificationsContext.Provider value={{ expoPushToken: tokenRef.current }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
