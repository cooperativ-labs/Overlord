import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AgentModelChooser } from '@/components/AgentModelChooser';
import {
  createAssignedAgent,
  formatAssignedAgentLabel,
  selectionFromAssignedAgent
} from '@/lib/agent-models';
import { colors } from '@/lib/colors';
import { useTicketRealtime } from '@/lib/hooks/use-ticket-realtime';
import {
  ensureAgentToken,
  launchTicketOnServer,
  launchTicketOnServerWithPassword,
  resolvePlatformUrl
} from '@/lib/remote-ticket-launch';
import { getConnectedSSHServers, useServerConnections } from '@/lib/server-connections-context';
import {
  getServerDeviceCredential,
  saveServerDeviceCredential
} from '@/lib/server-device-credentials';
import { getSupabase } from '@/lib/supabase';
import type {
  AgentModelSelection,
  Objective,
  Server,
  TicketDetail,
  TicketEvent
} from '@/lib/types';
import { generateKey, installPublicKey, isSSHSupported, verifyConnection } from '@/modules/ssh';

type Project = {
  id: string;
  name: string;
  color: string;
};

const eventIcons: Record<string, { name: string; color: string }> = {
  system: { name: 'settings-outline', color: colors.mutedForeground },
  question: { name: 'help-circle-outline', color: '#f59e0b' },
  answer: { name: 'chatbubble-outline', color: colors.primary },
  update: { name: 'create-outline', color: colors.primary },
  context_write: { name: 'push-outline', color: colors.mutedForeground },
  context_read: { name: 'download-outline', color: colors.mutedForeground },
  artifact: { name: 'attach-outline', color: '#8b5cf6' },
  deliver: { name: 'checkmark-circle-outline', color: colors.success },
  status_change: { name: 'swap-horizontal-outline', color: colors.primary },
  alert: { name: 'warning-outline', color: colors.destructive },
  user_follow_up: { name: 'person-outline', color: '#f59e0b' },
  ticket_reopened: { name: 'refresh-outline', color: '#f59e0b' }
};

const objectiveStateColors: Record<string, string> = {
  draft: colors.mutedForeground,
  executing: colors.primary,
  blocked: colors.destructive,
  complete: colors.success
};

export default function TicketDetailScreen() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const router = useRouter();
  const {
    servers: allServers,
    connectedSSHServers: availableServers,
    loading: loadingServers,
    refresh: refreshServers
  } = useServerConnections();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [objectiveDraft, setObjectiveDraft] = useState('');
  const [savingObjective, setSavingObjective] = useState(false);
  const [assignedSelection, setAssignedSelection] = useState<AgentModelSelection | null>(null);
  const [resolvedAssignedSelection, setResolvedAssignedSelection] =
    useState<AgentModelSelection | null>(null);
  const [savingAssignedAgent, setSavingAssignedAgent] = useState(false);
  const [expandedObjectiveIds, setExpandedObjectiveIds] = useState<string[]>([]);
  const [launchingServerId, setLaunchingServerId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showCliQuickstart, setShowCliQuickstart] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'all' | 'completed'>('all');
  const [showPromptMenu, setShowPromptMenu] = useState(false);
  const [copyingPromptContext, setCopyingPromptContext] = useState<'cli' | 'web' | null>(null);

  const loadData = useCallback(async () => {
    const supabase = getSupabase();
    const [ticketRes, objectivesRes, eventsRes, projectsRes] = await Promise.all([
      supabase
        .from('tickets')
        .select(
          'id, title, status, priority, execution_target, assigned_agent, due_datetime, ticket_sequence, context, constraints, acceptance_criteria, created_at, updated_at, project_id'
        )
        .eq('id', ticketId)
        .single(),
      supabase
        .from('objectives')
        .select('id, objective, title, state, agent_identifier, model_identifier, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false }),
      supabase
        .from('ticket_events')
        .select('id, event_type, summary, phase, is_blocking, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('projects').select('id, name, color').order('name', { ascending: true })
    ]);

    if (ticketRes.data) {
      setTicket(ticketRes.data as unknown as TicketDetail);
      setSelectedProjectId((ticketRes.data as unknown as TicketDetail).project_id ?? null);
    }
    if (objectivesRes.data) setObjectives(objectivesRes.data);
    if (eventsRes.data) setEvents(eventsRes.data as TicketEvent[]);
    if (projectsRes.data) setProjects(projectsRes.data);
    if (ticketRes.error) {
      Alert.alert('Unable to load ticket', ticketRes.error.message);
    } else if (eventsRes.error) {
      Alert.alert('Unable to load activity', eventsRes.error.message);
    }
  }, [ticketId]);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  // Realtime updates for ticket detail
  useTicketRealtime(ticketId, loadData);

  const draftObjective = useMemo(
    () => objectives.find(objective => objective.state === 'draft') ?? null,
    [objectives]
  );
  const filteredEvents = useMemo(() => {
    if (activityFilter === 'completed') {
      return events.filter(event => event.event_type === 'deliver' || event.phase === 'complete');
    }
    return events;
  }, [events, activityFilter]);

  const handleCopyPrompt = useCallback(
    async (context: 'cli' | 'web') => {
      if (!ticket) return;

      setCopyingPromptContext(context);
      try {
        const agentToken = await ensureAgentToken();
        const platformUrl = resolvePlatformUrl();
        const url = new URL(`/api/protocol/context/${ticket.id}`, `${platformUrl}/`);
        url.searchParams.set('context', context);
        url.searchParams.set('mode', 'run');
        const response = await fetch(url.toString(), {
          headers: {
            authorization: `Bearer ${agentToken}`
          }
        });
        const prompt = await response.text();

        if (!response.ok || prompt.trim().length === 0) {
          throw new Error(
            prompt || `Failed to build ${context === 'cli' ? 'local' : 'cloud'} prompt.`
          );
        }

        await Clipboard.setStringAsync(prompt);
        setShowPromptMenu(false);
      } catch (error) {
        setShowPromptMenu(false);
        Alert.alert(
          'Unable to copy prompt',
          error instanceof Error ? error.message : 'An unexpected error occurred.'
        );
      } finally {
        setCopyingPromptContext(null);
      }
    },
    [ticket]
  );

  const handleOpenPromptMenu = useCallback(() => {
    setShowPromptMenu(true);
  }, []);

  const handleCopyCliCommand = useCallback(async () => {
    if (!ticket) return;
    await Clipboard.setStringAsync(`ovld protocol attach --ticket-id ${ticket.id}`);
    Alert.alert('Copied', 'Attach command copied.');
  }, [ticket]);

  const handleCopyTicketId = useCallback(async () => {
    if (!ticket) return;
    await Clipboard.setStringAsync(ticket.id);
    Alert.alert('Copied', 'Ticket ID copied to clipboard.');
  }, [ticket]);

  const executedObjectives = useMemo(
    () =>
      objectives
        .filter(objective => objective.state !== 'draft')
        .slice()
        .sort((left, right) => {
          return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        }),
    [objectives]
  );

  useEffect(() => {
    setObjectiveDraft(draftObjective?.objective ?? '');
  }, [draftObjective?.id, draftObjective?.objective]);

  useEffect(() => {
    setAssignedSelection(selectionFromAssignedAgent(ticket?.assigned_agent));
  }, [ticket?.assigned_agent]);

  useFocusEffect(
    useCallback(() => {
      void refreshServers();
    }, [refreshServers])
  );

  useEffect(() => {
    console.log('[TicketDetail] server connections updated', {
      loadingServers,
      allServers: allServers.map(server => ({
        id: server.id,
        label: server.label,
        status: server.status,
        transport: server.transport
      })),
      connectedSSHServers: availableServers.map(server => ({
        id: server.id,
        label: server.label,
        status: server.status,
        transport: server.transport
      }))
    });
  }, [allServers, availableServers, loadingServers]);

  async function handleSaveObjective() {
    const trimmedObjective = objectiveDraft.trim();
    if (!trimmedObjective) {
      Alert.alert('Objective required', 'Enter an objective before saving.');
      return;
    }

    setSavingObjective(true);

    try {
      const supabase = getSupabase();
      const hasExistingDraft = Boolean(draftObjective);

      if (draftObjective) {
        const { error } = await supabase
          .from('objectives')
          .update({ objective: trimmedObjective })
          .eq('id', draftObjective.id);

        if (error) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await supabase.from('objectives').insert({
          ticket_id: ticketId,
          objective: trimmedObjective,
          state: 'draft'
        });

        if (error) {
          throw new Error(error.message);
        }
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: hasExistingDraft
          ? 'Objective updated from mobile.'
          : 'Objective created from mobile.',
        ticket_id: ticketId
      });

      if (eventError) {
        console.error('Failed to record objective save event:', eventError.message);
      }

      await loadData();
    } catch (error) {
      Alert.alert(
        'Unable to save objective',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setSavingObjective(false);
    }
  }

  async function handleAssignedAgentChange(nextSelection: AgentModelSelection) {
    if (!ticket || savingAssignedAgent) return;

    const supabase = getSupabase();
    const previousAssignedAgent = ticket.assigned_agent;
    const nextAssignedAgent = createAssignedAgent(nextSelection);

    setAssignedSelection(nextSelection);
    setTicket(current =>
      current
        ? {
            ...current,
            assigned_agent: nextAssignedAgent
          }
        : current
    );
    setSavingAssignedAgent(true);

    try {
      const { error } = await supabase
        .from('tickets')
        .update({ assigned_agent: nextAssignedAgent })
        .eq('id', ticket.id);

      if (error) {
        throw new Error(error.message);
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Assigned agent updated.',
        ticket_id: ticket.id
      });

      if (eventError) {
        console.error('Failed to record assigned agent update:', eventError.message);
      }
    } catch (error) {
      setAssignedSelection(selectionFromAssignedAgent(previousAssignedAgent));
      setTicket(current =>
        current
          ? {
              ...current,
              assigned_agent: previousAssignedAgent
            }
          : current
      );
      Alert.alert(
        'Unable to update assigned agent',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setSavingAssignedAgent(false);
    }
  }

  async function handleProjectChange(nextProjectId: string) {
    if (!ticket || savingProject) return;

    const previousProjectId = selectedProjectId;
    setSelectedProjectId(nextProjectId);
    setShowProjectPicker(false);
    setSavingProject(true);

    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('tickets')
        .update({ project_id: nextProjectId })
        .eq('id', ticket.id);

      if (error) throw new Error(error.message);

      setTicket(current => (current ? { ...current, project_id: nextProjectId } : current));
    } catch (error) {
      setSelectedProjectId(previousProjectId);
      Alert.alert(
        'Unable to update project',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setSavingProject(false);
    }
  }

  async function launchWithPassword(server: Server, password: string) {
    if (!ticket || !resolvedAssignedSelection) return;

    console.log('[TicketDetail] launchWithPassword', {
      server: {
        id: server.id,
        label: server.label,
        status: server.status,
        transport: server.transport
      },
      agent: resolvedAssignedSelection.agent
    });
    setLaunchingServerId(server.id);
    try {
      const result = await launchTicketOnServerWithPassword({
        ticketId: ticket.id,
        ticketSequence: ticket.ticket_sequence,
        agent: resolvedAssignedSelection.agent,
        server,
        password
      });

      const supabase = getSupabase();
      await supabase
        .from('servers')
        .update({
          last_connected_at: new Date().toISOString(),
          last_error: null,
          status: 'connected'
        })
        .eq('id', server.id);

      Alert.alert(
        'Remote Session Started',
        result.output.trim().length > 0
          ? result.output.trim()
          : `Started ${resolvedAssignedSelection.agent} on ${server.label}.`
      );
      await loadData();
      await refreshServers();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to launch the remote session.';
      console.error('Failed password-based launch:', error);
      Alert.alert('Unable to launch on server', message);
      await refreshServers();
    } finally {
      setLaunchingServerId(null);
    }
  }

  async function installKeyAndLaunch(server: Server, password: string) {
    if (!ticket || !resolvedAssignedSelection) return;

    console.log('[TicketDetail] installKeyAndLaunch', {
      server: {
        id: server.id,
        label: server.label,
        status: server.status,
        transport: server.transport
      },
      agent: resolvedAssignedSelection.agent
    });
    setLaunchingServerId(server.id);

    try {
      // 1. Generate a device key
      const tag = `com.cooperativ.overlord.ssh.${Date.now()}`;
      const keyResult = await generateKey(tag);
      console.log('[TicketDetail] Generated device key:', keyResult.fingerprint);

      // 2. Install the public key on the server using the password
      const installResult = await installPublicKey(
        server.host,
        server.port,
        server.username,
        password,
        keyResult.publicKeyOpenSSH
      );
      console.log(
        '[TicketDetail] Key installed, host fingerprint:',
        installResult.hostKeyFingerprint
      );

      // 3. Try to verify the key works via pubkey auth
      let keyAuthWorks = false;
      let hostFingerprint = installResult.hostKeyFingerprint;
      try {
        const verifyResult = await verifyConnection({
          host: server.host,
          port: server.port,
          username: server.username,
          transport: 'ssh',
          keyTag: tag,
          expectedHostKeyFingerprint: installResult.hostKeyFingerprint
        });
        keyAuthWorks = true;
        hostFingerprint = verifyResult.hostKeyFingerprint;
        console.log('[TicketDetail] Pubkey auth verified successfully');
      } catch (verifyError) {
        // Pubkey auth may not work on Tailscale SSH hosts — that's OK,
        // we'll fall back to password-based launch
        console.warn(
          '[TicketDetail] Pubkey auth verification failed (may be expected for Tailscale SSH):',
          verifyError instanceof Error ? verifyError.message : verifyError
        );
      }

      // 4. Save the device credential (even if pubkey didn't verify,
      //    it's installed and may work for future standard SSH connections)
      await saveServerDeviceCredential({
        serverId: server.id,
        keyTag: tag,
        publicKey: keyResult.publicKeyOpenSSH,
        publicKeyFingerprint: keyResult.fingerprint,
        isHardwareBacked: keyResult.isHardwareBacked,
        createdAt: new Date().toISOString()
      });

      // 5. Update server status
      const supabase = getSupabase();
      const verificationTime = new Date().toISOString();
      await supabase
        .from('servers')
        .update({
          status: 'connected',
          host_key_fingerprint: hostFingerprint,
          last_connected_at: verificationTime,
          last_verified_at: verificationTime,
          last_error: null
        })
        .eq('id', server.id);

      await refreshServers();

      // 6. Launch — use key if pubkey auth works, otherwise use password
      const result = keyAuthWorks
        ? await launchTicketOnServer({
            ticketId: ticket.id,
            ticketSequence: ticket.ticket_sequence,
            agent: resolvedAssignedSelection.agent,
            server,
            keyTag: tag
          })
        : await launchTicketOnServerWithPassword({
            ticketId: ticket.id,
            ticketSequence: ticket.ticket_sequence,
            agent: resolvedAssignedSelection.agent,
            server,
            password
          });

      Alert.alert(
        'Remote Session Started',
        result.output.trim().length > 0
          ? result.output.trim()
          : `${resolvedAssignedSelection.agent} started on ${server.label}.`
      );
      await loadData();
      await refreshServers();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to install key or launch session.';
      console.error('Failed key install + launch:', error);
      Alert.alert('Unable to launch on server', message);
      await refreshServers();
    } finally {
      setLaunchingServerId(null);
    }
  }

  async function handleLaunchOnServer(server: Server) {
    if (!ticket || !resolvedAssignedSelection) return;

    console.log('[TicketDetail] handleLaunchOnServer', {
      server: {
        id: server.id,
        label: server.label,
        status: server.status,
        transport: server.transport
      }
    });
    const credential = await getServerDeviceCredential(server.id);
    console.log('[TicketDetail] launch credential lookup result', {
      serverId: server.id,
      hasCredential: !!credential?.keyTag,
      keyTag: credential?.keyTag ?? null
    });

    if (!credential?.keyTag) {
      // No device key — prompt for password to install one
      Alert.prompt(
        'Install Device SSH Key',
        `No SSH key on this device for ${server.label}. Enter the server password to generate and install one. The password is used once and never stored.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Install & Launch',
            onPress: (value?: string) => {
              if (value?.trim()) {
                void installKeyAndLaunch(server, value.trim());
              }
            }
          }
        ],
        'secure-text'
      );
      return;
    }

    setLaunchingServerId(server.id);

    try {
      const result = await launchTicketOnServer({
        ticketId: ticket.id,
        ticketSequence: ticket.ticket_sequence,
        agent: resolvedAssignedSelection.agent,
        server,
        keyTag: credential.keyTag
      });

      const supabase = getSupabase();
      await supabase
        .from('servers')
        .update({
          last_connected_at: new Date().toISOString(),
          last_error: null,
          status: 'connected'
        })
        .eq('id', server.id);

      Alert.alert(
        'Remote Session Started',
        result.output.trim().length > 0
          ? result.output.trim()
          : `Started ${resolvedAssignedSelection.agent} on ${server.label}.`
      );
      await loadData();
      await refreshServers();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to launch the remote session.';

      console.error('Failed to launch remote ticket session:', error);

      // If key auth fails, offer password fallback
      if (
        message.includes('signature') ||
        message.includes('public key') ||
        message.includes('authentication')
      ) {
        setLaunchingServerId(null);
        Alert.prompt(
          'Key Auth Failed — Use Password',
          `Pubkey auth failed for ${server.label}. Enter the server password to launch with password auth instead.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Launch',
              onPress: (value?: string) => {
                if (value?.trim()) {
                  void launchWithPassword(server, value.trim());
                }
              }
            }
          ],
          'secure-text'
        );
        return;
      }

      try {
        const supabase = getSupabase();
        await supabase.from('servers').update({ last_error: message }).eq('id', server.id);
      } catch (updateError) {
        console.error('Failed to persist server launch error:', updateError);
      }

      Alert.alert('Unable to launch on server', message);
      await refreshServers();
    } finally {
      setLaunchingServerId(null);
    }
  }

  async function promptForServerLaunch() {
    console.log('[TicketDetail] promptForServerLaunch called', {
      hasResolvedAgent: !!resolvedAssignedSelection,
      isSSHSupported,
      loadingServers,
      totalServers: allServers.length,
      connectedSSHServers: availableServers.length,
      allServersSummary: allServers.map(s => ({
        id: s.id,
        label: s.label,
        status: s.status,
        transport: s.transport
      }))
    });

    if (!resolvedAssignedSelection) {
      Alert.alert('Select an agent', 'Choose an agent before launching on a server.');
      return;
    }

    if (!isSSHSupported) {
      Alert.alert(
        'Unsupported Platform',
        'Remote ticket launch is currently available on iOS only.'
      );
      return;
    }

    if (loadingServers) {
      console.log('[TicketDetail] Servers still loading, ignoring launch tap');
      return;
    }

    let freshAllServers = allServers;
    let freshAvailableServers = availableServers;

    try {
      freshAllServers = await refreshServers();
      freshAvailableServers = getConnectedSSHServers(freshAllServers);
      console.log('[TicketDetail] refreshed servers before launch', {
        totalServers: freshAllServers.length,
        connectedSSHServers: freshAvailableServers.length
      });
    } catch (error) {
      console.warn(
        '[TicketDetail] refresh before launch failed, falling back to current server snapshot:',
        error
      );
    }

    if (freshAvailableServers.length === 0) {
      console.warn(
        '[TicketDetail] No connected SSH servers available.',
        `Total servers: ${freshAllServers.length}.`,
        freshAllServers
          .map(s => `${s.label}: status=${s.status}, transport=${s.transport}`)
          .join('; ')
      );
      Alert.alert(
        'No Connected Servers',
        `Found ${freshAllServers.length} server(s) but none are connected. ` +
          (freshAllServers.length > 0
            ? freshAllServers.map(s => `${s.label}: ${s.status}/${s.transport}`).join(', ')
            : 'Add and verify a server on this device.')
      );
      return;
    }

    if (freshAvailableServers.length === 1) {
      void handleLaunchOnServer(freshAvailableServers[0]);
      return;
    }

    Alert.alert(
      'Choose Server',
      'Select a connected SSH server for this ticket.',
      [
        ...freshAvailableServers.map(server => ({
          text: server.label,
          onPress: () => {
            void handleLaunchOnServer(server);
          }
        })),
        { text: 'Cancel', style: 'cancel' as const }
      ],
      { cancelable: true }
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Ticket not found</Text>
      </View>
    );
  }

  const agentLabel = formatAssignedAgentLabel(ticket.assigned_agent);
  const normalizedObjectiveDraft = objectiveDraft.trim();
  const normalizedSavedDraft = (draftObjective?.objective ?? '').trim();
  const objectiveActionLabel = draftObjective
    ? normalizedSavedDraft
      ? 'Update Objective'
      : 'Save Objective'
    : 'Create Objective';
  const hasObjectiveChanges = normalizedObjectiveDraft !== normalizedSavedDraft;
  const canSaveObjective =
    !savingObjective && normalizedObjectiveDraft.length > 0 && hasObjectiveChanges;

  function toggleObjectiveExpanded(objectiveId: string) {
    setExpandedObjectiveIds(current =>
      current.includes(objectiveId)
        ? current.filter(id => id !== objectiveId)
        : [...current, objectiveId]
    );
  }

  const currentProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const dueLabel = ticket.due_datetime ? new Date(ticket.due_datetime).toLocaleDateString() : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top action bar */}
      <View style={styles.topBar}>
        <Pressable
          hitSlop={8}
          style={styles.topIconButton}
          onPress={() => setOverflowOpen(true)}
          accessibilityLabel="More actions"
        >
          <Ionicons name="ellipsis-vertical" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.topBarActions}>
          <Pressable hitSlop={8} style={styles.topPillButton} onPress={handleOpenPromptMenu}>
            <Ionicons name="copy-outline" size={13} color={colors.foreground} />
            <Text style={styles.topPillText}>Copy prompt</Text>
            <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            hitSlop={8}
            style={styles.topPillButton}
            onPress={() => setShowAgentModal(true)}
            disabled={savingAssignedAgent}
          >
            <Ionicons
              name={
                ticket.execution_target === 'agent' ? 'hardware-chip-outline' : 'person-outline'
              }
              size={13}
              color={colors.foreground}
            />
            <Text style={styles.topPillText} numberOfLines={1}>
              {agentLabel ?? 'Agent'}
            </Text>
            {savingAssignedAgent ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
            )}
          </Pressable>
        </View>
        <Pressable
          hitSlop={8}
          style={styles.topIconButton}
          onPress={() => router.back()}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Time Tracking */}
        <View style={styles.tracker}>
          <View style={styles.trackerTextWrap}>
            <View style={styles.trackerHeaderRow}>
              <Text style={styles.trackerLabel}>TIME TRACKING</Text>
              <Ionicons
                name="information-circle-outline"
                size={13}
                color={colors.mutedForeground}
              />
            </View>
            <Text style={styles.trackerSub}>Track time on this ticket.</Text>
          </View>
          <Pressable
            hitSlop={8}
            style={styles.trackerButton}
            onPress={() => Alert.alert('Time tracking', 'Time tracking starts soon.')}
          >
            <Ionicons name="play" size={12} color={colors.foreground} />
            <Text style={styles.trackerButtonText}>Start</Text>
          </Pressable>
        </View>

        {/* Title + sequence */}
        <View style={styles.titleBlock}>
          <Text style={styles.sequence}>#{ticket.ticket_sequence}</Text>
          <Text style={styles.titleText}>{ticket.title || 'Untitled'}</Text>
        </View>

        {/* Pill selectors: project · status */}
        <View style={styles.pillRow}>
          <Pressable
            style={({ pressed }) => [styles.selectPill, pressed && styles.pressed]}
            onPress={() => setShowProjectPicker(prev => !prev)}
            disabled={savingProject}
          >
            {currentProject && (
              <View
                style={[
                  styles.pillDot,
                  { backgroundColor: currentProject.color || colors.primary }
                ]}
              />
            )}
            <Text style={styles.selectPillText} numberOfLines={1}>
              {currentProject?.name ?? 'No project'}
            </Text>
            {savingProject ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
            )}
          </Pressable>

          <View style={styles.selectPill}>
            <View style={[styles.pillDot, { backgroundColor: statusPillColor(ticket.status) }]} />
            <Text style={styles.selectPillText}>{ticket.status}</Text>
            <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
          </View>
        </View>

        {showProjectPicker && (
          <View style={styles.projectPickerList}>
            {projects.map(project => {
              const isSelected = project.id === selectedProjectId;
              return (
                <Pressable
                  key={project.id}
                  style={[styles.projectPickerItem, isSelected && styles.projectPickerItemSelected]}
                  onPress={() => handleProjectChange(project.id)}
                >
                  <Text
                    style={[
                      styles.projectPickerItemText,
                      isSelected && styles.projectPickerItemTextSelected
                    ]}
                  >
                    {project.name}
                  </Text>
                  {isSelected && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Schedule buttons */}
        <View style={styles.scheduleRow}>
          <Pressable
            style={({ pressed }) => [styles.scheduleButton, pressed && styles.pressed]}
            onPress={() =>
              Alert.alert('Due date', dueLabel ? `Due ${dueLabel}` : 'Due date picker coming soon.')
            }
          >
            <Ionicons name="calendar-outline" size={13} color={colors.foreground} />
            <Text style={styles.scheduleText}>{dueLabel ? `Due ${dueLabel}` : 'Set due date'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.scheduleButton, pressed && styles.pressed]}
            onPress={() => Alert.alert('Schedule', 'Scheduling coming soon.')}
          >
            <Ionicons name="time-outline" size={13} color={colors.foreground} />
            <Text style={styles.scheduleText}>Add schedule</Text>
          </Pressable>
        </View>

        {/* Objectives list */}
        {executedObjectives.length > 0 && (
          <View style={styles.objectivesBlock}>
            {executedObjectives.map(obj => {
              const expanded = expandedObjectiveIds.includes(obj.id);
              return (
                <View key={obj.id} style={styles.objectiveRow}>
                  <Pressable
                    onPress={() => toggleObjectiveExpanded(obj.id)}
                    style={({ pressed }) => [styles.objectiveRowHeader, pressed && styles.pressed]}
                  >
                    <View style={styles.objectiveStatusIcon}>
                      <Ionicons
                        name={obj.state === 'complete' ? 'checkmark-circle' : 'radio-button-on'}
                        size={16}
                        color={objectiveStateColors[obj.state] ?? colors.mutedForeground}
                      />
                    </View>
                    <Text
                      style={styles.objectiveTitleText}
                      numberOfLines={expanded ? undefined : 1}
                    >
                      {obj.title ?? obj.objective}
                    </Text>
                    <Pressable hitSlop={6} onPress={() => toggleObjectiveExpanded(obj.id)}>
                      <Ionicons
                        name="ellipsis-horizontal"
                        size={16}
                        color={colors.mutedForeground}
                      />
                    </Pressable>
                  </Pressable>
                  {expanded && obj.title && obj.objective && (
                    <Text style={styles.objectiveBody}>{obj.objective}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Draft objective editor */}
        <View style={styles.draftBlock}>
          <TextInput
            style={styles.draftInput}
            value={objectiveDraft}
            onChangeText={setObjectiveDraft}
            placeholder="Click to add an objective..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
          />
          {canSaveObjective && (
            <Pressable
              onPress={handleSaveObjective}
              style={({ pressed }) => [styles.saveObjective, pressed && styles.pressed]}
            >
              {savingObjective ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={styles.saveObjectiveText}>{objectiveActionLabel}</Text>
              )}
            </Pressable>
          )}
        </View>

        {/* Run on server (kept functional, styled as section) */}
        <View style={styles.runSection}>
          <Pressable
            onPress={promptForServerLaunch}
            disabled={
              savingAssignedAgent ||
              loadingServers ||
              launchingServerId !== null ||
              !isSSHSupported ||
              !resolvedAssignedSelection
            }
            style={({ pressed }) => [
              styles.launchServerButton,
              (savingAssignedAgent ||
                loadingServers ||
                launchingServerId !== null ||
                !isSSHSupported ||
                !resolvedAssignedSelection) &&
                styles.launchServerButtonDisabled,
              pressed && styles.pressed
            ]}
          >
            {loadingServers || launchingServerId !== null ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Ionicons name="terminal-outline" size={14} color={colors.primaryForeground} />
            )}
            <Text style={styles.launchServerButtonText}>
              {launchingServerId !== null
                ? 'Starting Remote Session…'
                : loadingServers
                  ? 'Loading Servers…'
                  : 'Run on Server'}
            </Text>
          </Pressable>
          {!isSSHSupported && (
            <Text style={styles.runHint}>
              Remote SSH launch is currently available on iOS only.
            </Text>
          )}
          {isSSHSupported && availableServers.length === 0 && (
            <Text style={styles.runHint}>
              {allServers.length > 0
                ? 'No connected SSH servers on this device.'
                : 'Add a server from the Servers tab to launch remotely.'}
            </Text>
          )}
        </View>

        {/* Collapsible sections */}
        <CollapsibleSection
          label="DOCUMENTS"
          open={showDocuments}
          onToggle={() => setShowDocuments(open => !open)}
        >
          {ticket.context.trim() !== '' && (
            <View style={styles.docBlock}>
              <Text style={styles.docLabel}>Context</Text>
              <Text style={styles.docBody}>{ticket.context}</Text>
            </View>
          )}
          {ticket.constraints.trim() !== '' && (
            <View style={styles.docBlock}>
              <Text style={styles.docLabel}>Constraints</Text>
              <Text style={styles.docBody}>{ticket.constraints}</Text>
            </View>
          )}
          {ticket.acceptance_criteria && (
            <View style={styles.docBlock}>
              <Text style={styles.docLabel}>Acceptance Criteria</Text>
              <Text style={styles.docBody}>{ticket.acceptance_criteria}</Text>
            </View>
          )}
          {ticket.context.trim() === '' &&
            ticket.constraints.trim() === '' &&
            !ticket.acceptance_criteria && (
              <Text style={styles.docEmpty}>No documents attached.</Text>
            )}
        </CollapsibleSection>

        <CollapsibleSection
          label="CLI QUICKSTART"
          open={showCliQuickstart}
          onToggle={() => setShowCliQuickstart(open => !open)}
        >
          <Pressable
            style={({ pressed }) => [styles.cliCopy, pressed && styles.pressed]}
            onPress={handleCopyCliCommand}
          >
            <Text style={styles.cliText} selectable>
              ovld protocol attach --ticket-id {ticket.id}
            </Text>
            <Ionicons name="copy-outline" size={14} color={colors.mutedForeground} />
          </Pressable>
          <Text style={styles.cliHint}>
            Paste in a terminal already authenticated with Overlord to attach this session.
          </Text>
        </CollapsibleSection>

        {/* Activity */}
        <View style={styles.activityHeader}>
          <Text style={styles.sectionLabel}>ACTIVITY</Text>
          <Pressable
            style={({ pressed }) => [styles.activityFilter, pressed && styles.pressed]}
            onPress={() =>
              setActivityFilter(current => (current === 'completed' ? 'all' : 'completed'))
            }
          >
            <Text style={styles.activityFilterText}>
              {activityFilter === 'completed' ? 'Completed' : 'All'}
            </Text>
            <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
          </Pressable>
        </View>
        {filteredEvents.length === 0 ? (
          <Text style={styles.noActivity}>No activity yet</Text>
        ) : (
          filteredEvents.map(event => {
            const icon = eventIcons[event.event_type] ?? {
              name: 'ellipse',
              color: colors.primary
            };
            return (
              <View
                key={event.id}
                style={[styles.eventRow, event.is_blocking && styles.eventBlocking]}
              >
                <View style={styles.eventIconBadge}>
                  <Ionicons
                    name={icon.name as keyof typeof Ionicons.glyphMap}
                    size={12}
                    color={icon.color}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.eventHeader}>
                    <Text style={styles.eventType}>{event.event_type.replace(/_/g, ' ')}</Text>
                    {event.phase && <Text style={styles.eventPhase}>{event.phase}</Text>}
                    <Text style={styles.eventTime}>
                      {new Date(event.created_at).toLocaleString(undefined, {
                        month: 'numeric',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </Text>
                  </View>
                  {event.summary && (
                    <Text style={styles.eventSummary} numberOfLines={4}>
                      {event.summary}
                    </Text>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Prompt menu popover */}
      <Modal
        visible={showPromptMenu}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!copyingPromptContext) setShowPromptMenu(false);
        }}
      >
        <Pressable
          style={styles.promptMenuBackdrop}
          onPress={() => {
            if (!copyingPromptContext) setShowPromptMenu(false);
          }}
        >
          <Pressable style={styles.promptMenuCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Copy prompt</Text>
            <PromptOption
              label="Local prompt"
              description="For Claude Code CLI"
              icon="terminal-outline"
              loading={copyingPromptContext === 'cli'}
              disabled={copyingPromptContext !== null}
              onPress={() => void handleCopyPrompt('cli')}
            />
            <PromptOption
              label="Cloud prompt"
              description="For Claude.ai or web"
              icon="cloud-outline"
              loading={copyingPromptContext === 'web'}
              disabled={copyingPromptContext !== null}
              onPress={() => void handleCopyPrompt('web')}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Agent chooser modal */}
      <Modal
        visible={showAgentModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAgentModal(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowAgentModal(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Assigned Agent</Text>
            <AgentModelChooser
              value={assignedSelection}
              onChange={handleAssignedAgentChange}
              onResolvedSelectionChange={setResolvedAssignedSelection}
              helperText="Choose the agent and model."
              disabled={savingAssignedAgent}
            />
            <Pressable
              style={({ pressed }) => [styles.modalDone, pressed && styles.pressed]}
              onPress={() => setShowAgentModal(false)}
            >
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Overflow modal */}
      <Modal
        visible={overflowOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOverflowOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOverflowOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <OverflowAction
              icon="copy-outline"
              label="Copy ticket ID"
              onPress={() => {
                setOverflowOpen(false);
                void handleCopyTicketId();
              }}
            />
            <OverflowAction
              icon="refresh-outline"
              label="Reload"
              onPress={() => {
                setOverflowOpen(false);
                void loadData();
              }}
            />
            <OverflowAction
              icon="close-outline"
              label="Close"
              onPress={() => setOverflowOpen(false)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function CollapsibleSection({
  label,
  open,
  onToggle,
  children
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.collapsible}>
      <Pressable
        style={({ pressed }) => [styles.collapsibleHeader, pressed && styles.pressed]}
        onPress={onToggle}
      >
        <Text style={styles.sectionLabel}>{label}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.mutedForeground}
        />
      </Pressable>
      {open && <View style={styles.collapsibleBody}>{children}</View>}
    </View>
  );
}

function OverflowAction({
  icon,
  label,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.overflowRow, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={16} color={colors.foreground} />
      <Text style={styles.overflowText}>{label}</Text>
    </Pressable>
  );
}

function PromptOption({
  label,
  description,
  icon,
  loading,
  disabled,
  onPress
}: {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.promptOptionRow,
        disabled && !loading && styles.promptOptionDisabled,
        pressed && !disabled && styles.pressed
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.promptOptionIcon}>
        <Ionicons name={icon} size={18} color={colors.foreground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.promptOptionLabel}>{label}</Text>
        <Text style={styles.promptOptionDesc}>{description}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name="copy-outline" size={16} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

function statusPillColor(status: string): string {
  const map: Record<string, string> = {
    draft: colors.mutedForeground,
    'next-up': colors.primary,
    execute: colors.success,
    review: '#f59e0b',
    complete: colors.success,
    blocked: colors.destructive,
    cancelled: colors.mutedForeground,
    icebox: colors.mutedForeground
  };
  return map[status] ?? colors.mutedForeground;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background
  },
  errorText: { color: colors.mutedForeground, fontSize: 16 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10
  },
  topBarActions: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    minWidth: 0
  },
  topIconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  topPillButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 32,
    maxWidth: 170,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 0
  },
  topPillText: { color: colors.foreground, fontSize: 12, fontWeight: '500' },
  tracker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  trackerTextWrap: { flex: 1 },
  trackerHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trackerLabel: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  trackerSub: { color: colors.mutedForeground, fontSize: 13, marginTop: 4 },
  trackerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border
  },
  trackerButtonText: { color: colors.foreground, fontSize: 13, fontWeight: '600' },
  titleBlock: { paddingHorizontal: 16, marginBottom: 12, gap: 6 },
  sequence: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums']
  },
  titleText: { color: colors.foreground, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10
  },
  selectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 170
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  selectPillText: { color: colors.foreground, fontSize: 13, textTransform: 'capitalize' },
  projectPickerList: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden'
  },
  projectPickerItem: {
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  projectPickerItemSelected: { backgroundColor: colors.secondary },
  projectPickerItemText: { color: colors.secondaryForeground, fontSize: 15 },
  projectPickerItemTextSelected: { color: colors.foreground, fontWeight: '600' },
  scheduleRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 14
  },
  scheduleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  scheduleText: { color: colors.foreground, fontSize: 13 },
  objectivesBlock: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden'
  },
  objectiveRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  objectiveRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  objectiveStatusIcon: {},
  objectiveTitleText: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: '500' },
  objectiveBody: {
    color: colors.secondaryForeground,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginLeft: 26
  },
  draftBlock: {
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 100
  },
  draftInput: {
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 72,
    padding: 0
  },
  saveObjective: {
    alignSelf: 'flex-end',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.primary
  },
  saveObjectiveText: { color: colors.primaryForeground, fontSize: 13, fontWeight: '600' },
  runSection: { paddingHorizontal: 16, marginBottom: 18 },
  launchServerButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  launchServerButtonDisabled: { opacity: 0.45 },
  launchServerButtonText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },
  runHint: { color: colors.mutedForeground, fontSize: 12, marginTop: 8 },
  collapsible: {
    marginHorizontal: 16,
    marginBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14
  },
  collapsibleBody: { paddingBottom: 14, gap: 10 },
  sectionLabel: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  docBlock: { gap: 4 },
  docLabel: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
  docBody: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
  docEmpty: { color: colors.mutedForeground, fontSize: 13, fontStyle: 'italic' },
  cliCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border
  },
  cliText: { color: colors.foreground, fontSize: 12, flex: 1 },
  cliHint: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 6
  },
  activityFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border
  },
  activityFilterText: { color: colors.foreground, fontSize: 12, fontWeight: '500' },
  noActivity: {
    color: colors.mutedForeground,
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  eventRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8
  },
  eventIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2
  },
  eventBlocking: { backgroundColor: 'rgba(239, 68, 68, 0.06)' },
  eventHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  eventType: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
    backgroundColor: colors.muted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  eventPhase: { color: colors.mutedForeground, fontSize: 12 },
  eventTime: { color: colors.mutedForeground, fontSize: 11 },
  eventSummary: { color: colors.secondaryForeground, fontSize: 13, lineHeight: 18, marginTop: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10
  },
  modalTitle: { color: colors.foreground, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  modalDone: {
    marginTop: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center'
  },
  modalDoneText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },
  overflowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 6
  },
  overflowText: { color: colors.foreground, fontSize: 14 },
  pressed: { opacity: 0.82 },
  promptMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 72,
    paddingHorizontal: 24
  },
  promptMenuCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4
  },
  promptOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10
  },
  promptOptionDisabled: { opacity: 0.4 },
  promptOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  promptOptionLabel: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  promptOptionDesc: { color: colors.mutedForeground, fontSize: 12, marginTop: 1 }
});
