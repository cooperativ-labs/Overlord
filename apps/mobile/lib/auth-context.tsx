import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { getSupabase, isSupabaseConfigured, supabaseConfigError } from './supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGithub: () => Promise<void>;
  signInWithBitbucket: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    const supabase = getSupabase();

    const syncAuthRefreshWithAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void supabase.auth.startAutoRefresh();
        void supabase.auth.getSession().then(({ data: { session } }) => {
          setSession(session);
        });
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    };

    syncAuthRefreshWithAppState(AppState.currentState);
    const appStateSubscription = AppState.addEventListener('change', syncAuthRefreshWithAppState);

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      appStateSubscription.remove();
      void supabase.auth.stopAutoRefresh();
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured()) {
      throw new Error(supabaseConfigError ?? 'Supabase is not configured.');
    }

    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signInWithGithub = async () => {
    if (!isSupabaseConfigured()) {
      throw new Error(supabaseConfigError ?? 'Supabase is not configured.');
    }

    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        scopes: 'user:email'
      }
    });
    if (error) throw error;
  };

  const signInWithBitbucket = async () => {
    if (!isSupabaseConfigured()) {
      throw new Error(supabaseConfigError ?? 'Supabase is not configured.');
    }

    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'bitbucket',
      options: {
        scopes: 'account email'
      }
    });
    if (error) throw error;
  };

  const signOut = async () => {
    if (!isSupabaseConfigured()) {
      throw new Error(supabaseConfigError ?? 'Supabase is not configured.');
    }

    const supabase = getSupabase();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signIn,
        signInWithGithub,
        signInWithBitbucket,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
