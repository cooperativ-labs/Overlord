import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { AgentModelChooser } from '@/components/AgentModelChooser';
import {
  createAssignedAgent,
  formatAssignedAgentLabel,
  selectionFromAssignedAgent
} from '@/lib/agent-models';
import { colors } from '@/lib/colors';
import { useTicketRealtime } from '@/lib/hooks/use-ticket-realtime';
import { launchTicketOnServer, launchTicketOnServerWithPassword } from '@/lib/remote-ticket-launch';
import { useServerConnections } from '@/lib/server-connections-context';
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

  const loadData = useCallback(async () => {
    const supabase = getSupabase();
    const [ticketRes, objectivesRes, eventsRes] = await Promise.all([
      supabase
        .from('tickets')
        .select(
          'id, title, status, priority, execution_target, assigned_agent, due_datetime, ticket_sequence, context, constraints, acceptance_criteria, created_at, updated_at, project_id'
        )
        .eq('id', ticketId)
        .single(),
      supabase
        .from('objectives')
        .select(
          'id, objective, is_executed, title, state, agent_identifier, model_identifier, created_at'
        )
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false }),
      supabase
        .from('ticket_events')
        .select('id, event_type, summary, phase, is_blocking, created_at')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(30)
    ]);

    if (ticketRes.data) setTicket(ticketRes.data as unknown as TicketDetail);
    if (objectivesRes.data) setObjectives(objectivesRes.data);
    if (eventsRes.data) setEvents(eventsRes.data as TicketEvent[]);
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
    () => objectives.find(objective => !objective.is_executed) ?? null,
    [objectives]
  );
  const executedObjectives = useMemo(
    () =>
      objectives
        .filter(objective => objective.is_executed)
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
          state: 'draft',
          is_executed: false
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

  async function launchWithPassword(server: Server, password: string) {
    if (!ticket || !resolvedAssignedSelection) return;

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

    const credential = await getServerDeviceCredential(server.id);

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

  function promptForServerLaunch() {
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

    if (availableServers.length === 0) {
      console.warn(
        '[TicketDetail] No connected SSH servers available.',
        `Total servers: ${allServers.length}.`,
        allServers.map(s => `${s.label}: status=${s.status}, transport=${s.transport}`).join('; ')
      );
      Alert.alert(
        'No Connected Servers',
        `Found ${allServers.length} server(s) but none are connected. ` +
          (allServers.length > 0
            ? allServers.map(s => `${s.label}: ${s.status}/${s.transport}`).join(', ')
            : 'Add and verify a server on this device.')
      );
      return;
    }

    if (availableServers.length === 1) {
      void handleLaunchOnServer(availableServers[0]);
      return;
    }

    Alert.alert(
      'Choose Server',
      'Select a connected SSH server for this ticket.',
      [
        ...availableServers.map(server => ({
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

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen
        options={{
          title: `#${ticket.ticket_sequence}`,
          headerShown: true,
          headerBackTitle: 'Tickets',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground
        }}
      />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{ticket.title || 'Untitled'}</Text>
        <View style={styles.metaRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{ticket.status}</Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{ticket.priority}</Text>
          </View>
          <View style={styles.chip}>
            <Ionicons
              name={
                ticket.execution_target === 'agent' ? 'hardware-chip-outline' : 'person-outline'
              }
              size={12}
              color={colors.secondaryForeground}
              style={{ marginRight: 4 }}
            />
            <Text style={styles.chipText}>{ticket.execution_target}</Text>
          </View>
        </View>
        {agentLabel && (
          <View style={styles.agentRow}>
            <Ionicons name="hardware-chip-outline" size={14} color={colors.mutedForeground} />
            <Text style={styles.agentText}>{agentLabel}</Text>
          </View>
        )}
        {ticket.due_datetime && (
          <View style={styles.dueRow}>
            <Ionicons name="calendar-outline" size={14} color={colors.mutedForeground} />
            <Text style={styles.dueText}>
              Due {new Date(ticket.due_datetime).toLocaleDateString()}
            </Text>
          </View>
        )}

        {/* SSH Connection Status Banner */}
        <View
          style={[
            styles.sshBanner,
            loadingServers
              ? styles.sshBannerLoading
              : availableServers.length > 0
                ? styles.sshBannerConnected
                : styles.sshBannerDisconnected
          ]}
        >
          <View style={styles.sshBannerRow}>
            {loadingServers ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <View
                style={[
                  styles.sshStatusDot,
                  {
                    backgroundColor:
                      availableServers.length > 0 ? colors.success : colors.destructive
                  }
                ]}
              />
            )}
            <Text style={styles.sshBannerText}>
              {loadingServers
                ? 'Checking servers...'
                : availableServers.length > 0
                  ? `${availableServers.length} server${availableServers.length !== 1 ? 's' : ''} connected`
                  : 'No servers connected'}
            </Text>
          </View>
          {!loadingServers && allServers.length > 0 && availableServers.length === 0 && (
            <Text style={styles.sshBannerDetail}>
              {allServers.length} server{allServers.length !== 1 ? 's' : ''} found but none are
              connected. {allServers.map(s => `${s.label}: ${s.status}/${s.transport}`).join(', ')}
            </Text>
          )}
          {!loadingServers && allServers.length === 0 && (
            <Text style={styles.sshBannerDetail}>
              No servers registered for this device. Add one from the Servers tab.
            </Text>
          )}
        </View>
      </View>

      {/* Assigned agent */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Assigned Agent</Text>
          {savingAssignedAgent ? (
            <View style={styles.inlineStatus}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.inlineStatusText}>Saving...</Text>
            </View>
          ) : null}
        </View>
        <AgentModelChooser
          value={assignedSelection}
          onChange={handleAssignedAgentChange}
          onResolvedSelectionChange={setResolvedAssignedSelection}
          helperText="Tap the button to choose the agent and model."
          disabled={savingAssignedAgent}
        />
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
            pressed &&
              !(
                savingAssignedAgent ||
                loadingServers ||
                launchingServerId !== null ||
                !isSSHSupported ||
                !resolvedAssignedSelection
              ) &&
              styles.launchServerButtonPressed
          ]}
        >
          {loadingServers || launchingServerId !== null ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Ionicons name="terminal-outline" size={16} color={colors.primaryForeground} />
          )}
          <Text style={styles.launchServerButtonText}>
            {launchingServerId !== null
              ? 'Starting Remote Session...'
              : loadingServers
                ? 'Loading Servers...'
                : 'Run on Server'}
          </Text>
        </Pressable>
        <Text style={styles.sectionHelperText}>
          {isSSHSupported
            ? availableServers.length > 0
              ? `Launches ${resolvedAssignedSelection?.agent ?? 'the selected agent'} on a connected SSH server using your server terminal preference.`
              : 'No connected SSH servers are currently available on this device.'
            : 'Remote SSH launch is currently available on iOS only.'}
        </Text>
      </View>

      {/* Objective history */}
      {executedObjectives.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Objectives</Text>
          {executedObjectives.map(obj => (
            <View key={obj.id} style={styles.objectiveCard}>
              <Pressable
                onPress={() => toggleObjectiveExpanded(obj.id)}
                style={({ pressed }) => [styles.objectiveCardHeader, pressed && styles.pressed]}
              >
                <View style={styles.objectiveHeaderLeft}>
                  <View
                    style={[
                      styles.objectiveStateDot,
                      { backgroundColor: objectiveStateColors[obj.state] ?? colors.mutedForeground }
                    ]}
                  />
                  <View style={styles.objectiveHeaderTextWrap}>
                    <Text style={styles.objectiveTitle}>{obj.title ?? 'Objective'}</Text>
                    <View style={styles.objectiveMetaRow}>
                      <Text style={styles.objectiveMeta}>{obj.state}</Text>
                      {obj.agent_identifier && (
                        <>
                          <Text style={styles.objectiveMetaSep}>·</Text>
                          <Text style={styles.objectiveMeta}>{obj.agent_identifier}</Text>
                        </>
                      )}
                      {obj.model_identifier && (
                        <>
                          <Text style={styles.objectiveMetaSep}>·</Text>
                          <Text style={styles.objectiveMeta}>{obj.model_identifier}</Text>
                        </>
                      )}
                    </View>
                  </View>
                </View>
                <Ionicons
                  name={expandedObjectiveIds.includes(obj.id) ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.mutedForeground}
                />
              </Pressable>
              {expandedObjectiveIds.includes(obj.id) ? (
                <Text style={styles.objectiveText}>{obj.objective}</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Draft Objective</Text>
        <TextInput
          style={styles.objectiveEditor}
          value={objectiveDraft}
          onChangeText={setObjectiveDraft}
          placeholder="Write the next objective..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
        />
        <Pressable
          onPress={handleSaveObjective}
          disabled={!canSaveObjective}
          style={({ pressed }) => [
            styles.objectiveActionButton,
            !canSaveObjective && styles.objectiveActionButtonDisabled,
            pressed && canSaveObjective && styles.objectiveActionButtonPressed
          ]}
        >
          {savingObjective ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.objectiveActionText}>{objectiveActionLabel}</Text>
          )}
        </Pressable>
      </View>

      {/* Context */}
      {ticket.context.trim() !== '' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Context</Text>
          <Text style={styles.sectionBody}>{ticket.context}</Text>
        </View>
      )}

      {/* Constraints */}
      {ticket.constraints.trim() !== '' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Constraints</Text>
          <Text style={styles.sectionBody}>{ticket.constraints}</Text>
        </View>
      )}

      {/* Acceptance Criteria */}
      {ticket.acceptance_criteria && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Acceptance Criteria</Text>
          <Text style={styles.sectionBody}>{ticket.acceptance_criteria}</Text>
        </View>
      )}

      {/* Activity */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Activity</Text>
        {events.length === 0 ? (
          <Text style={styles.noActivity}>No activity yet</Text>
        ) : (
          events.map(event => {
            const icon = eventIcons[event.event_type] ?? { name: 'ellipse', color: colors.primary };
            return (
              <View
                key={event.id}
                style={[styles.eventCard, event.is_blocking && styles.eventBlocking]}
              >
                <View style={styles.eventHeader}>
                  <Ionicons
                    name={icon.name as keyof typeof Ionicons.glyphMap}
                    size={14}
                    color={icon.color}
                  />
                  <Text style={styles.eventType}>{event.event_type.replace(/_/g, ' ')}</Text>
                  {event.phase && <Text style={styles.eventPhase}>· {event.phase}</Text>}
                  {event.is_blocking && (
                    <View style={styles.blockingBadge}>
                      <Text style={styles.blockingText}>blocking</Text>
                    </View>
                  )}
                </View>
                {event.summary && (
                  <Text style={styles.eventSummary} numberOfLines={4}>
                    {event.summary}
                  </Text>
                )}
                <Text style={styles.eventTime}>{new Date(event.created_at).toLocaleString()}</Text>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background
  },
  errorText: {
    color: colors.mutedForeground,
    fontSize: 16
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  title: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6
  },
  chipText: {
    color: colors.secondaryForeground,
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'capitalize'
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10
  },
  agentText: {
    color: colors.mutedForeground,
    fontSize: 13
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6
  },
  dueText: {
    color: colors.mutedForeground,
    fontSize: 13
  },
  sshBanner: {
    marginTop: 12,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1
  },
  sshBannerLoading: {
    backgroundColor: colors.secondary,
    borderColor: colors.border
  },
  sshBannerConnected: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.3)'
  },
  sshBannerDisconnected: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)'
  },
  sshBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  sshStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  sshBannerText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: '600'
  },
  sshBannerDetail: {
    color: colors.mutedForeground,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    marginLeft: 16
  },
  section: {
    padding: 16
  },
  sectionTitle: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  inlineStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  inlineStatusText: {
    color: colors.mutedForeground,
    fontSize: 13
  },
  launchServerButton: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  launchServerButtonDisabled: {
    opacity: 0.45
  },
  launchServerButtonPressed: {
    opacity: 0.8
  },
  launchServerButtonText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: '600'
  },
  sectionHelperText: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10
  },
  sectionBody: {
    color: colors.foreground,
    fontSize: 15,
    lineHeight: 22
  },
  objectiveEditor: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    minHeight: 120,
    color: colors.foreground,
    fontSize: 15,
    lineHeight: 22
  },
  objectiveActionButton: {
    marginTop: 12,
    backgroundColor: colors.primary,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  objectiveActionButtonDisabled: {
    opacity: 0.45
  },
  objectiveActionButtonPressed: {
    opacity: 0.8
  },
  objectiveActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600'
  },
  objectiveCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border
  },
  objectiveCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10
  },
  objectiveHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
    minWidth: 0
  },
  objectiveHeaderTextWrap: {
    flex: 1,
    minWidth: 0
  },
  objectiveMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 0,
    marginTop: 2
  },
  pressed: {
    opacity: 0.82
  },
  objectiveStateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4
  },
  objectiveMetaSep: {
    color: colors.mutedForeground,
    fontSize: 12
  },
  objectiveMeta: {
    color: colors.mutedForeground,
    fontSize: 12
  },
  objectiveTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600'
  },
  objectiveText: {
    color: colors.secondaryForeground,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8
  },
  noActivity: {
    color: colors.mutedForeground,
    fontSize: 14
  },
  eventCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border
  },
  eventBlocking: {
    borderColor: colors.destructive,
    borderWidth: 1
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4
  },
  eventType: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'capitalize'
  },
  eventPhase: {
    color: colors.mutedForeground,
    fontSize: 13
  },
  blockingBadge: {
    backgroundColor: colors.destructive,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 'auto'
  },
  blockingText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  eventSummary: {
    color: colors.secondaryForeground,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: 4
  },
  eventTime: {
    color: colors.mutedForeground,
    fontSize: 12,
    marginTop: 4
  }
});
