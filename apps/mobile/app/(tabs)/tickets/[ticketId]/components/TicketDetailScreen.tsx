import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QuickCreateTicketModal } from '@/components/QuickCreateTicketModal';
import {
  createAssignedAgent,
  DEFAULT_AGENT_MODEL_SELECTION,
  selectionFromAssignedAgent
} from '@/lib/agent-models';
import { useAuth } from '@/lib/auth-context';
import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { useTicketRealtime } from '@/lib/hooks/use-ticket-realtime';
import { Ionicons } from '@/lib/icons';
import { buildCliLaunchCommand } from '@/lib/launch-commands';
import {
  launchTicketOnServer,
  launchTicketOnServerWithPassword,
  resolveLaunchOAuthSession,
  resolvePlatformUrl
} from '@/lib/remote-ticket-launch';
import { getConnectedSSHServers, useServerConnections } from '@/lib/server-connections-context';
import {
  getServerDeviceCredential,
  saveServerDeviceCredential
} from '@/lib/server-device-credentials';
import { getSupabase } from '@/lib/supabase';
import { isTransientNetworkError } from '@/lib/transient-network-error';
import type {
  AgentModelSelection,
  Objective,
  Server,
  TicketDetail,
  TicketEvent
} from '@/lib/types';
import { generateKey, installPublicKey, isSSHSupported, verifyConnection } from '@/modules/ssh';

import { type Project, type TicketDocument } from './ticket-detail-shared';
import { createStyles } from './ticket-detail-styles';
import { TicketDetailContent } from './TicketDetailContent';
import { TicketHeaderRight, TicketHeaderSheet, TicketHeaderTitle } from './TicketDetailHeader';
import { TicketDetailModals } from './TicketDetailModals';

export default function TicketDetailScreen() {
  const { ticketId, returnTo } = useLocalSearchParams<{ ticketId: string; returnTo?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id;
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [headerSheetOpen, setHeaderSheetOpen] = useState(false);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showAcceptanceCriteria, setShowAcceptanceCriteria] = useState(true);
  const [documents, setDocuments] = useState<TicketDocument[]>([]);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [showCliQuickstart, setShowCliQuickstart] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'all' | 'completed'>('all');
  const [copyingPromptContext, setCopyingPromptContext] = useState<'cli' | 'web' | null>(null);
  const [acceptanceCriteriaDraft, setAcceptanceCriteriaDraft] = useState('');
  const [savingAcceptanceCriteria, setSavingAcceptanceCriteria] = useState(false);
  const [hasEverhourApiKey, setHasEverhourApiKey] = useState(false);
  const [eventProfiles, setEventProfiles] = useState<
    Record<string, { name: string; image_url: string }>
  >({});
  const loadSequenceRef = useRef(0);

  const loadData = useCallback(
    async (options?: { reset?: boolean; suppressTransientNetworkAlert?: boolean }) => {
      const reset = options?.reset ?? false;
      const suppressTransientNetworkAlert = options?.suppressTransientNetworkAlert ?? false;
      const loadSequence = loadSequenceRef.current + 1;
      loadSequenceRef.current = loadSequence;

      if (reset) {
        setLoading(true);
        setTicket(null);
        setObjectives([]);
        setEvents([]);
        setProjects([]);
        setSelectedProjectId(null);
        setDocuments([]);
        setEventProfiles({});
      }

      const supabase = getSupabase();
      const [ticketRes, objectivesRes, eventsRes, projectsRes, documentsRes, everhourRes] =
        await Promise.all([
          supabase
            .from('tickets')
            .select(
              'id, organization_id, title, status, priority, execution_target, assigned_agent, due_datetime, ticket_sequence, context, constraints, acceptance_criteria, created_at, updated_at, project_id'
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
            .select('id, event_type, summary, phase, is_blocking, created_at, created_by')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: false })
            .limit(30),
          supabase.from('projects').select('id, name, color').order('name', { ascending: true }),
          supabase
            .from('artifacts')
            .select('id, label, storage_path, metadata, created_at')
            .eq('ticket_id', ticketId)
            .not('storage_path', 'is', null)
            .order('created_at', { ascending: false }),
          userId
            ? supabase
                .from('user_integrations')
                .select('id')
                .eq('user_id', userId)
                .eq('provider', 'everhour')
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null })
        ]);

      if (loadSequenceRef.current !== loadSequence) {
        return;
      }

      if (ticketRes.data) {
        setTicket(ticketRes.data as unknown as TicketDetail);
        setSelectedProjectId((ticketRes.data as unknown as TicketDetail).project_id ?? null);
      } else if (ticketRes.error) {
        setTicket(null);
        setSelectedProjectId(null);
      }
      if (objectivesRes.data) {
        setObjectives(objectivesRes.data);
      } else if (reset) {
        setObjectives([]);
      }
      if (eventsRes.data) {
        const loadedEvents = eventsRes.data as TicketEvent[];
        setEvents(loadedEvents);
        const userIds = [
          ...new Set(
            loadedEvents
              .filter(e => e.event_type === 'user_follow_up' && e.created_by)
              .map(e => e.created_by as string)
          )
        ];
        if (userIds.length > 0) {
          const profilesRes = await supabase
            .from('profiles')
            .select('id, name, image_url')
            .in('id', userIds);
          if (loadSequenceRef.current !== loadSequence) {
            return;
          }
          if (profilesRes.data) {
            const map: Record<string, { name: string; image_url: string }> = {};
            for (const p of profilesRes.data) map[p.id] = { name: p.name, image_url: p.image_url };
            setEventProfiles(map);
          }
        } else {
          setEventProfiles({});
        }
      } else if (reset) {
        setEvents([]);
        setEventProfiles({});
      }
      if (projectsRes.data) {
        setProjects(projectsRes.data);
      } else if (reset) {
        setProjects([]);
      }
      if (documentsRes.data) {
        setDocuments(
          documentsRes.data.map(document => {
            const metadata = (document.metadata ?? {}) as Record<string, unknown>;
            return {
              id: document.id,
              label: document.label,
              storagePath: document.storage_path ?? '',
              fileType: typeof metadata.type === 'string' ? metadata.type : '',
              fileSize: typeof metadata.size === 'number' ? metadata.size : 0,
              createdAt: document.created_at
            };
          })
        );
      } else if (reset) {
        setDocuments([]);
      }
      setHasEverhourApiKey(Boolean(everhourRes.data));
      if (
        ticketRes.error &&
        !(suppressTransientNetworkAlert && isTransientNetworkError(ticketRes.error))
      ) {
        Alert.alert('Unable to load ticket', ticketRes.error.message);
      } else if (
        eventsRes.error &&
        !(suppressTransientNetworkAlert && isTransientNetworkError(eventsRes.error))
      ) {
        Alert.alert('Unable to load activity', eventsRes.error.message);
      }
      if (reset && loadSequenceRef.current === loadSequence) {
        setLoading(false);
      }
    },
    [ticketId, userId]
  );

  useEffect(() => {
    void loadData({ reset: true });
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
        const { accessToken, organizationId } = await resolveLaunchOAuthSession();
        const platformUrl = resolvePlatformUrl();
        const url = new URL(`/api/protocol/context/${ticket.id}`, `${platformUrl}/`);
        url.searchParams.set('context', context);
        url.searchParams.set('mode', 'run');
        const response = await fetch(url.toString(), {
          headers: {
            authorization: `Bearer ${accessToken}`,
            'x-organization-id': String(organizationId)
          }
        });
        const prompt = await response.text();

        if (!response.ok || prompt.trim().length === 0) {
          throw new Error(
            prompt || `Failed to build ${context === 'cli' ? 'local' : 'cloud'} prompt.`
          );
        }

        await Clipboard.setStringAsync(prompt);
      } catch (error) {
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

  const handleCopyCliCommand = useCallback(async () => {
    if (!ticket) return;
    const selectedSelection =
      assignedSelection ?? resolvedAssignedSelection ?? DEFAULT_AGENT_MODEL_SELECTION;
    await Clipboard.setStringAsync(
      buildCliLaunchCommand(selectedSelection.agent, ticket.id, {
        model: selectedSelection.model,
        thinking: selectedSelection.thinking
      })
    );
    Alert.alert('Copied', 'Launch command copied.');
  }, [assignedSelection, resolvedAssignedSelection, ticket]);

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

  useEffect(() => {
    setAcceptanceCriteriaDraft(ticket?.acceptance_criteria ?? '');
  }, [ticket?.acceptance_criteria]);

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

  function sanitizeFileName(fileName: string): string {
    const sanitized = fileName
      .replace(/[\\/\0]/g, '-')
      .replace(/[\r\n\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!sanitized) {
      return 'artifact';
    }
    return sanitized.slice(0, 180);
  }

  async function uploadDocument(options: {
    uri: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }) {
    if (!ticket || uploadingDocument) return;

    setUploadingDocument(true);
    try {
      const supabase = getSupabase();
      const storagePath = `${ticket.organization_id}/${ticket.project_id ?? 'personal'}/${ticket.id}/${Date.now()}-${sanitizeFileName(options.fileName)}`;
      const response = await fetch(options.uri);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from('artifacts')
        .upload(storagePath, buffer, {
          contentType: options.mimeType,
          upsert: false
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { error: artifactError } = await supabase.from('artifacts').insert({
        ticket_id: ticket.id,
        artifact_type: options.mimeType.startsWith('image/') ? 'image' : 'document',
        label: options.fileName,
        storage_path: storagePath,
        metadata: {
          size: options.fileSize,
          type: options.mimeType,
          fileName: options.fileName
        }
      });

      if (artifactError) {
        throw new Error(artifactError.message);
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        event_type: 'artifact',
        summary: `Document uploaded from mobile: ${options.fileName}`,
        ticket_id: ticket.id
      });

      if (eventError) {
        console.error('Failed to record upload event:', eventError.message);
      }

      await loadData();
      setShowDocuments(true);
    } catch (error) {
      Alert.alert(
        'Upload failed',
        error instanceof Error ? error.message : 'An unexpected upload error occurred.'
      );
    } finally {
      setUploadingDocument(false);
    }
  }

  async function handleOpenDocument(document: TicketDocument) {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.storage
        .from('artifacts')
        .createSignedUrl(document.storagePath, 3600);

      if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? 'Unable to open document.');
      }

      await Linking.openURL(data.signedUrl);
    } catch (error) {
      Alert.alert(
        'Unable to open document',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  }

  async function handleSaveAcceptanceCriteria() {
    if (!ticket || savingAcceptanceCriteria) return;

    setSavingAcceptanceCriteria(true);
    try {
      const nextCriteria = acceptanceCriteriaDraft.trim();
      const supabase = getSupabase();
      const { error } = await supabase
        .from('tickets')
        .update({ acceptance_criteria: nextCriteria.length > 0 ? nextCriteria : null })
        .eq('id', ticket.id);

      if (error) {
        throw new Error(error.message);
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Acceptance criteria updated from mobile.',
        ticket_id: ticket.id
      });

      if (eventError) {
        console.error('Failed to record acceptance criteria update:', eventError.message);
      }

      await loadData();
    } catch (error) {
      Alert.alert(
        'Unable to save acceptance criteria',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setSavingAcceptanceCriteria(false);
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
  const normalizedCriteriaDraft = acceptanceCriteriaDraft.trim();
  const normalizedSavedCriteria = (ticket.acceptance_criteria ?? '').trim();
  const canSaveAcceptanceCriteria =
    !savingAcceptanceCriteria && normalizedCriteriaDraft !== normalizedSavedCriteria;

  function toggleObjectiveExpanded(objectiveId: string) {
    setExpandedObjectiveIds(current =>
      current.includes(objectiveId)
        ? current.filter(id => id !== objectiveId)
        : [...current, objectiveId]
    );
  }

  const currentProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const dueLabel = ticket.due_datetime ? new Date(ticket.due_datetime).toLocaleDateString() : null;

  const ticketSequenceLabel = ticket.ticket_sequence ? `OVL-${ticket.ticket_sequence}` : null;
  const ticketHeaderSubtitle = [ticketSequenceLabel, ticket.status]
    .filter((value): value is string => Boolean(value))
    .join(' • ');
  const returnToPath = typeof returnTo === 'string' ? returnTo : null;

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <Stack.Screen
        options={{
          headerLeft: returnToPath
            ? ({ tintColor }) => (
                <Pressable
                  hitSlop={10}
                  onPress={() => router.replace(returnToPath)}
                  accessibilityRole="button"
                  accessibilityLabel="Back to feed"
                  style={styles.headerIconPressable}
                >
                  <View
                    style={[
                      styles.headerIconButton,
                      styles.headerIconButtonFallback,
                      { marginRight: 0 }
                    ]}
                  >
                    <Ionicons
                      name="chevron-back"
                      size={18}
                      color={tintColor ?? colors.foreground}
                    />
                  </View>
                </Pressable>
              )
            : undefined,
          headerTitle: () => (
            <TicketHeaderTitle
              title={ticket.title || 'Ticket'}
              subtitle={ticketHeaderSubtitle}
              assignedSelection={assignedSelection}
              savingAssignedAgent={savingAssignedAgent}
              onPress={() => setHeaderSheetOpen(true)}
            />
          ),
          headerRight: () => <TicketHeaderRight onPress={() => setOverflowOpen(true)} />
        }}
      />
      <TicketHeaderSheet
        visible={headerSheetOpen}
        onClose={() => setHeaderSheetOpen(false)}
        title={ticket.title || 'Ticket'}
        subtitle={ticketHeaderSubtitle}
        assignedSelection={assignedSelection}
        savingAssignedAgent={savingAssignedAgent}
        copyingPromptContext={copyingPromptContext}
        onAssignedAgentChange={handleAssignedAgentChange}
        onResolvedSelectionChange={setResolvedAssignedSelection}
        onOpenOverflow={() => {
          setHeaderSheetOpen(false);
          setOverflowOpen(true);
        }}
        onCopyCliCommand={() => {
          setHeaderSheetOpen(false);
          void handleCopyCliCommand();
        }}
        onCopyPrompt={context => {
          setHeaderSheetOpen(false);
          void handleCopyPrompt(context);
        }}
        onCopyTicketId={() => {
          setHeaderSheetOpen(false);
          void handleCopyTicketId();
        }}
        onReload={() => {
          setHeaderSheetOpen(false);
          void loadData();
        }}
      />
      <TicketDetailContent
        ticket={ticket}
        ticketId={ticketId}
        dueLabel={dueLabel}
        currentProject={currentProject}
        projects={projects}
        selectedProjectId={selectedProjectId}
        showProjectPicker={showProjectPicker}
        savingProject={savingProject}
        onToggleProjectPicker={() => setShowProjectPicker(prev => !prev)}
        onChangeProject={handleProjectChange}
        objectiveDraft={objectiveDraft}
        setObjectiveDraft={setObjectiveDraft}
        executedObjectives={executedObjectives}
        expandedObjectiveIds={expandedObjectiveIds}
        toggleObjectiveExpanded={toggleObjectiveExpanded}
        canSaveObjective={canSaveObjective}
        objectiveActionLabel={objectiveActionLabel}
        savingObjective={savingObjective}
        onSaveObjective={handleSaveObjective}
        promptForServerLaunch={promptForServerLaunch}
        isSSHSupported={isSSHSupported}
        loadingServers={loadingServers}
        launchingServerId={launchingServerId}
        resolvedAssignedSelection={resolvedAssignedSelection}
        allServers={allServers}
        availableServers={availableServers}
        documents={documents}
        uploadingDocument={uploadingDocument}
        showDocuments={showDocuments}
        onToggleDocuments={() => setShowDocuments(open => !open)}
        onPickFile={uploadDocument}
        onOpenDocument={handleOpenDocument}
        hasEverhourApiKey={hasEverhourApiKey}
        ticketContext={ticket.context}
        ticketConstraints={ticket.constraints}
        ticketAcceptanceCriteria={ticket.acceptance_criteria}
        showAcceptanceCriteria={showAcceptanceCriteria}
        onToggleAcceptanceCriteria={() => setShowAcceptanceCriteria(open => !open)}
        acceptanceCriteriaDraft={acceptanceCriteriaDraft}
        setAcceptanceCriteriaDraft={setAcceptanceCriteriaDraft}
        canSaveAcceptanceCriteria={canSaveAcceptanceCriteria}
        savingAcceptanceCriteria={savingAcceptanceCriteria}
        onSaveAcceptanceCriteria={handleSaveAcceptanceCriteria}
        showCliQuickstart={showCliQuickstart}
        onToggleCliQuickstart={() => setShowCliQuickstart(open => !open)}
        onCopyCliCommand={handleCopyCliCommand}
        filteredEvents={filteredEvents}
        eventProfiles={eventProfiles}
        activityFilter={activityFilter}
        onToggleActivityFilter={() =>
          setActivityFilter(current => (current === 'completed' ? 'all' : 'completed'))
        }
      />
      <TicketDetailModals
        overflowOpen={overflowOpen}
        onCloseOverflow={() => setOverflowOpen(false)}
        onCopyTicketId={handleCopyTicketId}
        onReload={loadData}
        onNewTicket={() => setShowNewTicketModal(true)}
      />
      <QuickCreateTicketModal
        visible={showNewTicketModal}
        onClose={() => setShowNewTicketModal(false)}
        defaultProjectId={ticket.project_id}
      />
    </SafeAreaView>
  );
}
