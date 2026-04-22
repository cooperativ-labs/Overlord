import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase';
import type { Server } from '@/lib/types';

export function isConnectedSSHServer(server: Server): boolean {
  return (
    server.status === 'connected' &&
    (server.transport === 'ssh' || server.transport === 'tailscale_ssh')
  );
}

export function getConnectedSSHServers(servers: Server[]): Server[] {
  return servers.filter(isConnectedSSHServer);
}

interface ServerConnectionsContextValue {
  servers: Server[];
  connectedSSHServers: Server[];
  loading: boolean;
  refresh: () => Promise<Server[]>;
  getServerById: (serverId: string) => Server | null;
}

const ServerConnectionsContext = createContext<ServerConnectionsContextValue | undefined>(
  undefined
);

export function ServerConnectionsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const serversRef = useRef<Server[]>([]);
  const hasLoadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      if (__DEV__) console.log('[ServerConnections] refresh skipped - no signed-in user');
      hasLoadedRef.current = false;
      setServers([]);
      serversRef.current = [];
      setLoading(false);
      return [];
    }

    if (__DEV__) console.log('[ServerConnections] refresh start');
    if (!hasLoadedRef.current) {
      setLoading(true);
    }

    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('servers')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      const loadedServers = (data ?? []) as Server[];
      setServers(loadedServers);
      serversRef.current = loadedServers;
      hasLoadedRef.current = true;
      if (__DEV__) {
        console.log(
          `[ServerConnections] refresh complete: ${loadedServers.length} server(s), ${getConnectedSSHServers(loadedServers).length} connected`
        );
      }
      return loadedServers;
    } catch (error) {
      if (__DEV__) console.error('Failed to load server connections:', error);
      return serversRef.current;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    hasLoadedRef.current = false;
    setLoading(true);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const supabase = getSupabase();
    const channel = supabase
      .channel(`servers:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'servers',
          filter: `user_id=eq.${userId}`
        },
        () => {
          void refresh();
        }
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void refresh();
        }
      });

    const appStateSubscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        void refresh();
      }
    });

    return () => {
      appStateSubscription.remove();
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const value = useMemo<ServerConnectionsContextValue>(() => {
    const connectedSSHServers = getConnectedSSHServers(servers);
    return {
      servers,
      connectedSSHServers,
      loading,
      refresh,
      getServerById: serverId => servers.find(server => server.id === serverId) ?? null
    };
  }, [loading, refresh, servers]);

  return (
    <ServerConnectionsContext.Provider value={value}>{children}</ServerConnectionsContext.Provider>
  );
}

export function useServerConnections() {
  const context = useContext(ServerConnectionsContext);
  if (context === undefined) {
    throw new Error('useServerConnections must be used within a ServerConnectionsProvider');
  }

  return context;
}
