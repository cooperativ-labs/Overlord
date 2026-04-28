import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const glassAvailable = Platform.OS === 'ios' && isLiquidGlassAvailable();

import { AgentBrandIcon } from '@/components/AgentBrandIcon';
import { AgentModelChooser } from '@/components/AgentModelChooser';
import { AGENT_OPTIONS, createAssignedAgent, selectionFromAssignedAgent } from '@/lib/agent-models';
import { useAuth } from '@/lib/auth-context';
import { useThemeColors, useThemedStyles, type ThemeColors } from '@/lib/colors';
import { useTicketRealtime } from '@/lib/hooks/use-ticket-realtime';
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

type TicketDocument = {
  id: string;
  label: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
};

function getEventIcons(colors: ThemeColors): Record<string, { name: string; color: string }> {
  return {
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
}

const eventLabels: Record<string, string> = {
  update: 'Update',
  question: 'Question',
  answer: 'Answer',
  deliver: 'Delivered',
  artifact: 'Artifact',
  status_change: 'Status Changed',
  alert: 'Notification',
  user_follow_up: 'Follow-up',
  context_write: 'Context Written',
  context_read: 'Context Read',
  ticket_reopened: 'Reopened'
};

function getObjectiveStateColors(colors: ThemeColors): Record<string, string> {
  return {
    draft: colors.mutedForeground,
    executing: colors.primary,
    blocked: colors.destructive,
    complete: colors.success
  };
}

export default function TicketDetailScreen() {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
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
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [headerSheetOpen, setHeaderSheetOpen] = useState(false);
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

  const loadData = useCallback(async (options?: { reset?: boolean }) => {
    const reset = options?.reset ?? false;
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
    if (ticketRes.error) {
      Alert.alert('Unable to load ticket', ticketRes.error.message);
    } else if (eventsRes.error) {
      Alert.alert('Unable to load activity', eventsRes.error.message);
    }
    if (reset && loadSequenceRef.current === loadSequence) {
      setLoading(false);
    }
  }, [ticketId, userId]);

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

  async function handleTakePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera permission needed', 'Enable camera access to take a photo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85
    });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await uploadDocument({
      uri: asset.uri,
      fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileSize: asset.fileSize ?? 0
    });
  }

  async function handleSelectImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Photo library permission needed',
        'Enable photo library access to select images.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85
    });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await uploadDocument({
      uri: asset.uri,
      fileName: asset.fileName ?? `image-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileSize: asset.fileSize ?? 0
    });
  }

  async function handleSelectFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: false
    });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await uploadDocument({
      uri: asset.uri,
      fileName: asset.name,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      fileSize: asset.size ?? 0
    });
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

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
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
        onOpenAgentModal={() => {
          setHeaderSheetOpen(false);
          setShowAgentModal(true);
        }}
        onOpenOverflow={() => {
          setHeaderSheetOpen(false);
          setOverflowOpen(true);
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
        onTakePhoto={handleTakePhoto}
        onSelectImage={handleSelectImage}
        onSelectFile={handleSelectFile}
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
        showAgentModal={showAgentModal}
        assignedSelection={assignedSelection}
        savingAssignedAgent={savingAssignedAgent}
        onAssignedAgentChange={handleAssignedAgentChange}
        onResolvedSelectionChange={setResolvedAssignedSelection}
        onCloseAgentModal={() => setShowAgentModal(false)}
        overflowOpen={overflowOpen}
        onCloseOverflow={() => setOverflowOpen(false)}
        onCopyTicketId={handleCopyTicketId}
        onReload={loadData}
      />
    </SafeAreaView>
  );
}

function TicketHeaderTitle({
  title,
  subtitle,
  assignedSelection,
  savingAssignedAgent,
  onPress
}: {
  title: string;
  subtitle: string;
  assignedSelection: AgentModelSelection | null;
  savingAssignedAgent: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const PillContainer = glassAvailable ? GlassView : View;
  const pillStyle = glassAvailable
    ? styles.headerTitlePill
    : [styles.headerTitlePill, styles.headerTitlePillFallback];

  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      accessibilityLabel="Open ticket actions"
      accessibilityRole="button"
    >
      <PillContainer
        style={pillStyle}
        {...(glassAvailable ? { glassEffectStyle: 'regular' as const, isInteractive: true } : {})}
      >
        {assignedSelection?.agent ? (
          <AgentBrandIcon agent={assignedSelection.agent} size={14} />
        ) : (
          <Ionicons name="hardware-chip-outline" size={14} color={colors.foreground} />
        )}
        <View style={styles.headerTitleTextWrap}>
          <Text style={styles.headerTitleText} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSubtitleText} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {savingAssignedAgent ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
        )}
      </PillContainer>
    </Pressable>
  );
}

function TicketHeaderRight({ onPress }: { onPress: () => void }) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const IconContainer = glassAvailable ? GlassView : View;
  const iconStyle = glassAvailable
    ? styles.headerIconButton
    : [styles.headerIconButton, styles.headerIconButtonFallback];

  return (
    <Pressable
      hitSlop={10}
      onPress={onPress}
      accessibilityLabel="More actions"
      accessibilityRole="button"
      style={styles.headerIconPressable}
    >
      <IconContainer
        style={iconStyle}
        {...(glassAvailable ? { glassEffectStyle: 'regular' as const } : {})}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.foreground} />
      </IconContainer>
    </Pressable>
  );
}

function TicketHeaderSheet({
  visible,
  onClose,
  title,
  subtitle,
  assignedSelection,
  savingAssignedAgent,
  copyingPromptContext,
  onOpenAgentModal,
  onOpenOverflow,
  onCopyPrompt,
  onCopyTicketId,
  onReload
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  assignedSelection: AgentModelSelection | null;
  savingAssignedAgent: boolean;
  copyingPromptContext: 'cli' | 'web' | null;
  onOpenAgentModal: () => void;
  onOpenOverflow: () => void;
  onCopyPrompt: (context: 'cli' | 'web') => void;
  onCopyTicketId: () => void;
  onReload: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const SheetContainer = glassAvailable ? GlassView : View;
  const sheetStyle = glassAvailable
    ? styles.headerSheet
    : [styles.headerSheet, styles.headerSheetFallback];

  const agentLabel =
    AGENT_OPTIONS.find(option => option.value === assignedSelection?.agent)?.label ??
    'Choose agent';
  const modelLabel = assignedSelection?.model ?? 'Default model';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.headerSheetBackdrop} onPress={onClose}>
        <Pressable onPress={() => undefined} style={styles.headerSheetWrap}>
          <SheetContainer
            style={sheetStyle}
            {...(glassAvailable ? { glassEffectStyle: 'regular' as const } : {})}
          >
            <View style={styles.headerSheetTopRow}>
              <Pressable
                hitSlop={10}
                onPress={onClose}
                accessibilityLabel="Close header"
                style={styles.headerSheetCircle}
              >
                <Ionicons name="close" size={18} color={colors.foreground} />
              </Pressable>
              <View style={styles.headerSheetTitleWrap}>
                <Text style={styles.headerSheetTitle} numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={styles.headerSheetSubtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <Pressable
                hitSlop={10}
                onPress={onOpenOverflow}
                accessibilityLabel="More actions"
                style={styles.headerSheetCircle}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.foreground} />
              </Pressable>
            </View>

            <View style={styles.headerSheetChipRow}>
              <HeaderSheetChip
                icon="copy-outline"
                label="Copy CLI"
                onPress={() => onCopyPrompt('cli')}
                loading={copyingPromptContext === 'cli'}
                disabled={copyingPromptContext !== null}
              />
              <HeaderSheetChip
                icon="cloud-outline"
                label="Copy Web"
                onPress={() => onCopyPrompt('web')}
                loading={copyingPromptContext === 'web'}
                disabled={copyingPromptContext !== null}
              />
              <HeaderSheetChip icon="refresh-outline" label="Reload" onPress={onReload} />
            </View>

            <Pressable
              style={({ pressed }) => [styles.headerSheetFeaturedRow, pressed && styles.pressed]}
              onPress={onOpenAgentModal}
              disabled={savingAssignedAgent}
              accessibilityLabel="Change assigned agent"
            >
              <View style={styles.headerSheetFeaturedIcon}>
                {assignedSelection?.agent ? (
                  <AgentBrandIcon agent={assignedSelection.agent} size={20} />
                ) : (
                  <Ionicons name="hardware-chip-outline" size={20} color={colors.foreground} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerSheetFeaturedLabel}>{agentLabel}</Text>
                <Text style={styles.headerSheetFeaturedMeta} numberOfLines={1}>
                  {modelLabel}
                </Text>
              </View>
              {savingAssignedAgent ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              )}
            </Pressable>

            <HeaderSheetRow icon="copy-outline" label="Copy ticket ID" onPress={onCopyTicketId} />
            <HeaderSheetRow
              icon="ellipsis-horizontal-circle-outline"
              label="More actions"
              onPress={onOpenOverflow}
            />
          </SheetContainer>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HeaderSheetChip({
  icon,
  label,
  onPress,
  loading,
  disabled
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.headerSheetChip,
        disabled && !loading && styles.headerSheetChipDisabled,
        pressed && !disabled && styles.pressed
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.foreground} />
      ) : (
        <Ionicons name={icon} size={16} color={colors.foreground} />
      )}
      <Text style={styles.headerSheetChipLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function HeaderSheetRow({
  icon,
  label,
  trailing,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  trailing?: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={({ pressed }) => [styles.headerSheetRow, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={18} color={colors.foreground} />
      <Text style={styles.headerSheetRowLabel}>{label}</Text>
      {trailing ? <Text style={styles.headerSheetRowTrailing}>{trailing}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

function TicketDetailContent({
  ticket,
  ticketId,
  dueLabel,
  currentProject,
  projects,
  selectedProjectId,
  showProjectPicker,
  savingProject,
  onToggleProjectPicker,
  onChangeProject,
  objectiveDraft,
  setObjectiveDraft,
  executedObjectives,
  expandedObjectiveIds,
  toggleObjectiveExpanded,
  canSaveObjective,
  objectiveActionLabel,
  savingObjective,
  onSaveObjective,
  promptForServerLaunch,
  isSSHSupported,
  loadingServers,
  launchingServerId,
  resolvedAssignedSelection,
  allServers,
  availableServers,
  documents,
  uploadingDocument,
  showDocuments,
  onToggleDocuments,
  onTakePhoto,
  onSelectImage,
  onSelectFile,
  onOpenDocument,
  hasEverhourApiKey,
  ticketContext,
  ticketConstraints,
  ticketAcceptanceCriteria,
  showAcceptanceCriteria,
  onToggleAcceptanceCriteria,
  acceptanceCriteriaDraft,
  setAcceptanceCriteriaDraft,
  canSaveAcceptanceCriteria,
  savingAcceptanceCriteria,
  onSaveAcceptanceCriteria,
  showCliQuickstart,
  onToggleCliQuickstart,
  onCopyCliCommand,
  filteredEvents,
  eventProfiles,
  activityFilter,
  onToggleActivityFilter
}: {
  ticket: TicketDetail;
  ticketId: string;
  dueLabel: string | null;
  currentProject: Project | null;
  projects: Project[];
  selectedProjectId: string | null;
  showProjectPicker: boolean;
  savingProject: boolean;
  onToggleProjectPicker: () => void;
  onChangeProject: (nextProjectId: string) => Promise<void>;
  objectiveDraft: string;
  setObjectiveDraft: (value: string) => void;
  executedObjectives: Objective[];
  expandedObjectiveIds: string[];
  toggleObjectiveExpanded: (objectiveId: string) => void;
  canSaveObjective: boolean;
  objectiveActionLabel: string;
  savingObjective: boolean;
  onSaveObjective: () => void;
  promptForServerLaunch: () => void;
  isSSHSupported: boolean;
  loadingServers: boolean;
  launchingServerId: string | null;
  resolvedAssignedSelection: AgentModelSelection | null;
  allServers: Server[];
  availableServers: Server[];
  documents: TicketDocument[];
  uploadingDocument: boolean;
  showDocuments: boolean;
  onToggleDocuments: () => void;
  onTakePhoto: () => void;
  onSelectImage: () => void;
  onSelectFile: () => void;
  onOpenDocument: (document: TicketDocument) => void;
  hasEverhourApiKey: boolean;
  ticketContext: string;
  ticketConstraints: string;
  ticketAcceptanceCriteria: string | null;
  showAcceptanceCriteria: boolean;
  onToggleAcceptanceCriteria: () => void;
  acceptanceCriteriaDraft: string;
  setAcceptanceCriteriaDraft: (value: string) => void;
  canSaveAcceptanceCriteria: boolean;
  savingAcceptanceCriteria: boolean;
  onSaveAcceptanceCriteria: () => void;
  showCliQuickstart: boolean;
  onToggleCliQuickstart: () => void;
  onCopyCliCommand: () => void;
  filteredEvents: TicketEvent[];
  eventProfiles: Record<string, { name: string; image_url: string }>;
  activityFilter: 'all' | 'completed';
  onToggleActivityFilter: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const objectiveStateColors = getObjectiveStateColors(colors);
  const eventIcons = getEventIcons(colors);
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {hasEverhourApiKey && (
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
      )}

      <View style={styles.titleBlock}>
        <Text style={styles.sequence}>#{ticket.ticket_sequence}</Text>
        <Text style={styles.titleText}>{ticket.title || 'Untitled'}</Text>
      </View>

      <View style={styles.pillRow}>
        <Pressable
          style={({ pressed }) => [styles.selectPill, pressed && styles.pressed]}
          onPress={onToggleProjectPicker}
          disabled={savingProject}
        >
          {currentProject && (
            <View
              style={[styles.pillDot, { backgroundColor: currentProject.color || colors.primary }]}
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
          <View
            style={[styles.pillDot, { backgroundColor: statusPillColor(ticket.status, colors) }]}
          />
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
                onPress={() => onChangeProject(project.id)}
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
                  <Text style={styles.objectiveTitleText} numberOfLines={expanded ? undefined : 1}>
                    {obj.title ?? obj.objective}
                  </Text>
                  <Pressable hitSlop={6} onPress={() => toggleObjectiveExpanded(obj.id)}>
                    <Ionicons name="ellipsis-horizontal" size={16} color={colors.mutedForeground} />
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
            onPress={onSaveObjective}
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

      <View style={styles.runSection}>
        <Pressable
          onPress={promptForServerLaunch}
          disabled={
            loadingServers ||
            launchingServerId !== null ||
            !isSSHSupported ||
            !resolvedAssignedSelection
          }
          style={({ pressed }) => [
            styles.launchServerButton,
            (loadingServers ||
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
          <Text style={styles.runHint}>Remote SSH launch is currently available on iOS only.</Text>
        )}
        {isSSHSupported && availableServers.length === 0 && (
          <Text style={styles.runHint}>
            {allServers.length > 0
              ? 'No connected SSH servers on this device.'
              : 'Add a server from the Servers tab to launch remotely.'}
          </Text>
        )}
      </View>

      <CollapsibleSection label="DOCUMENTS" open={showDocuments} onToggle={onToggleDocuments}>
        <View style={styles.documentActions}>
          <Pressable
            style={({ pressed }) => [
              styles.documentActionButton,
              uploadingDocument && styles.documentActionButtonDisabled,
              pressed && styles.pressed
            ]}
            onPress={() => onTakePhoto()}
            disabled={uploadingDocument}
          >
            <Ionicons name="camera-outline" size={14} color={colors.foreground} />
            <Text style={styles.documentActionText}>Take image</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.documentActionButton,
              uploadingDocument && styles.documentActionButtonDisabled,
              pressed && styles.pressed
            ]}
            onPress={() => onSelectImage()}
            disabled={uploadingDocument}
          >
            <Ionicons name="images-outline" size={14} color={colors.foreground} />
            <Text style={styles.documentActionText}>Select image</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.documentActionButton,
              uploadingDocument && styles.documentActionButtonDisabled,
              pressed && styles.pressed
            ]}
            onPress={() => onSelectFile()}
            disabled={uploadingDocument}
          >
            <Ionicons name="document-attach-outline" size={14} color={colors.foreground} />
            <Text style={styles.documentActionText}>Select file</Text>
          </Pressable>
        </View>
        {uploadingDocument && (
          <View style={styles.documentUploadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.documentUploadingText}>Uploading document...</Text>
          </View>
        )}
        {documents.length > 0 && (
          <View style={styles.documentList}>
            {documents.map(document => (
              <Pressable
                key={document.id}
                style={({ pressed }) => [styles.documentRow, pressed && styles.pressed]}
                onPress={() => onOpenDocument(document)}
              >
                <Ionicons
                  name={
                    document.fileType.startsWith('image/') ? 'image-outline' : 'document-outline'
                  }
                  size={15}
                  color={colors.foreground}
                />
                <Text style={styles.documentName} numberOfLines={1}>
                  {document.label}
                </Text>
                <Text style={styles.documentMeta}>
                  {new Date(document.createdAt).toLocaleDateString()}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {ticketContext.trim() !== '' && (
          <View style={styles.docBlock}>
            <Text style={styles.docLabel}>Context</Text>
            <Text style={styles.docBody}>{ticketContext}</Text>
          </View>
        )}
        {ticketConstraints.trim() !== '' && (
          <View style={styles.docBlock}>
            <Text style={styles.docLabel}>Constraints</Text>
            <Text style={styles.docBody}>{ticketConstraints}</Text>
          </View>
        )}
        {ticketAcceptanceCriteria && (
          <View style={styles.docBlock}>
            <Text style={styles.docLabel}>Acceptance Criteria</Text>
            <Text style={styles.docBody}>{ticketAcceptanceCriteria}</Text>
          </View>
        )}
        {ticketContext.trim() === '' &&
          ticketConstraints.trim() === '' &&
          !ticketAcceptanceCriteria &&
          documents.length === 0 && <Text style={styles.docEmpty}>No documents attached.</Text>}
      </CollapsibleSection>

      <CollapsibleSection
        label="ACCEPTANCE CRITERIA"
        open={showAcceptanceCriteria}
        onToggle={onToggleAcceptanceCriteria}
      >
        <TextInput
          style={styles.criteriaInput}
          value={acceptanceCriteriaDraft}
          onChangeText={setAcceptanceCriteriaDraft}
          placeholder="Define completion criteria for this ticket..."
          placeholderTextColor={colors.mutedForeground}
          multiline
          textAlignVertical="top"
        />
        {canSaveAcceptanceCriteria && (
          <Pressable
            style={({ pressed }) => [
              styles.saveCriteriaButton,
              savingAcceptanceCriteria && styles.documentActionButtonDisabled,
              pressed && styles.pressed
            ]}
            onPress={() => onSaveAcceptanceCriteria()}
            disabled={savingAcceptanceCriteria}
          >
            {savingAcceptanceCriteria ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text style={styles.saveCriteriaButtonText}>Save acceptance criteria</Text>
            )}
          </Pressable>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        label="CLI QUICKSTART"
        open={showCliQuickstart}
        onToggle={onToggleCliQuickstart}
      >
        <Pressable
          style={({ pressed }) => [styles.cliCopy, pressed && styles.pressed]}
          onPress={onCopyCliCommand}
        >
          <Text style={styles.cliText} selectable>
            ovld protocol attach --ticket-id {ticketId}
          </Text>
          <Ionicons name="copy-outline" size={14} color={colors.mutedForeground} />
        </Pressable>
        <Text style={styles.cliHint}>
          Paste in a terminal already authenticated with Overlord to attach this session.
        </Text>
      </CollapsibleSection>

      <View style={styles.activityHeader}>
        <Text style={styles.sectionLabel}>ACTIVITY</Text>
        <Pressable
          style={({ pressed }) => [styles.activityFilter, pressed && styles.pressed]}
          onPress={onToggleActivityFilter}
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
          const isFollowUp = event.event_type === 'user_follow_up';
          const profile = isFollowUp && event.created_by ? eventProfiles[event.created_by] : null;
          const icon = eventIcons[event.event_type] ?? {
            name: 'ellipse',
            color: colors.primary
          };
          const label = eventLabels[event.event_type] ?? event.event_type.replace(/_/g, ' ');
          return (
            <View
              key={event.id}
              style={[styles.eventRow, event.is_blocking && styles.eventBlocking]}
            >
              {isFollowUp ? (
                <View style={styles.eventAvatarBadge}>
                  {profile?.image_url ? (
                    <Image source={{ uri: profile.image_url }} style={styles.eventAvatarImage} />
                  ) : (
                    <Text style={styles.eventAvatarInitials}>
                      {(profile?.name ?? 'U').slice(0, 2).toUpperCase()}
                    </Text>
                  )}
                </View>
              ) : (
                <View style={styles.eventIconBadge}>
                  <Ionicons
                    name={icon.name as keyof typeof Ionicons.glyphMap}
                    size={12}
                    color={icon.color}
                  />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.eventHeader}>
                  <Text
                    style={[
                      styles.eventType,
                      isFollowUp && { color: '#f59e0b', fontWeight: '600' }
                    ]}
                  >
                    {isFollowUp && profile?.name ? profile.name : label}
                  </Text>
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
  );
}

function TicketDetailModals({
  showAgentModal,
  assignedSelection,
  savingAssignedAgent,
  onAssignedAgentChange,
  onResolvedSelectionChange,
  onCloseAgentModal,
  overflowOpen,
  onCloseOverflow,
  onCopyTicketId,
  onReload
}: {
  showAgentModal: boolean;
  assignedSelection: AgentModelSelection | null;
  savingAssignedAgent: boolean;
  onAssignedAgentChange: (nextSelection: AgentModelSelection) => Promise<void>;
  onResolvedSelectionChange: (value: AgentModelSelection | null) => void;
  onCloseAgentModal: () => void;
  overflowOpen: boolean;
  onCloseOverflow: () => void;
  onCopyTicketId: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <>
      <Modal
        visible={showAgentModal}
        transparent
        animationType="fade"
        onRequestClose={onCloseAgentModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCloseAgentModal}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Assigned Agent</Text>
            <AgentModelChooser
              value={assignedSelection}
              onChange={onAssignedAgentChange}
              onResolvedSelectionChange={onResolvedSelectionChange}
              helperText="Choose the agent and model."
              disabled={savingAssignedAgent}
            />
            <Pressable
              style={({ pressed }) => [styles.modalDone, pressed && styles.pressed]}
              onPress={onCloseAgentModal}
            >
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={overflowOpen}
        transparent
        animationType="fade"
        onRequestClose={onCloseOverflow}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCloseOverflow}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <OverflowAction
              icon="copy-outline"
              label="Copy ticket ID"
              onPress={() => {
                onCloseOverflow();
                void onCopyTicketId();
              }}
            />
            <OverflowAction
              icon="refresh-outline"
              label="Reload"
              onPress={() => {
                onCloseOverflow();
                void onReload();
              }}
            />
            <OverflowAction icon="close-outline" label="Close" onPress={onCloseOverflow} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
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
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
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

function statusPillColor(status: string, colors: ThemeColors): string {
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

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
  headerTitlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    maxWidth: 240,
    overflow: 'hidden'
  },
  headerTitlePillFallback: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  headerTitleTextWrap: { flexShrink: 1, minWidth: 0 },
  headerTitleText: { color: colors.foreground, fontSize: 14, fontWeight: '600' },
  headerSubtitleText: {
    color: colors.mutedForeground,
    fontSize: 11,
    marginTop: 1,
    textTransform: 'capitalize'
  },
  headerIconPressable: { marginRight: 4 },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  headerIconButtonFallback: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  headerSheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 56 : 24
  },
  headerSheetWrap: {
    width: '100%'
  },
  headerSheet: {
    width: '100%',
    borderRadius: 24,
    padding: 12,
    gap: 10,
    overflow: 'hidden'
  },
  headerSheetFallback: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  headerSheetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 6
  },
  headerSheetCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)'
  },
  headerSheetTitleWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  headerSheetTitle: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
  headerSheetSubtitle: {
    color: colors.mutedForeground,
    fontSize: 12,
    marginTop: 2,
    textTransform: 'capitalize'
  },
  headerSheetChipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4
  },
  headerSheetChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 10
  },
  headerSheetChipDisabled: { opacity: 0.45 },
  headerSheetChipLabel: { color: colors.foreground, fontSize: 13, fontWeight: '600' },
  headerSheetFeaturedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginTop: 4
  },
  headerSheetFeaturedIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)'
  },
  headerSheetFeaturedLabel: { color: colors.foreground, fontSize: 15, fontWeight: '600' },
  headerSheetFeaturedMeta: { color: colors.mutedForeground, fontSize: 12, marginTop: 2 },
  headerSheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 14,
    borderRadius: 10
  },
  headerSheetRowLabel: { flex: 1, color: colors.foreground, fontSize: 15 },
  headerSheetRowTrailing: { color: colors.mutedForeground, fontSize: 13 },
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
  documentActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  documentActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border
  },
  documentActionButtonDisabled: { opacity: 0.55 },
  documentActionText: { color: colors.foreground, fontSize: 12, fontWeight: '500' },
  documentUploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  documentUploadingText: { color: colors.mutedForeground, fontSize: 12 },
  documentList: { marginTop: 4, borderRadius: 8, overflow: 'hidden' },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginBottom: 6
  },
  documentName: { flex: 1, color: colors.foreground, fontSize: 13 },
  documentMeta: { color: colors.mutedForeground, fontSize: 11 },
  criteriaInput: {
    minHeight: 96,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 20
  },
  saveCriteriaButton: {
    marginTop: 8,
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary
  },
  saveCriteriaButtonText: { color: colors.primaryForeground, fontSize: 13, fontWeight: '600' },
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
  eventAvatarBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#f59e0b22',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    overflow: 'hidden'
  },
  eventAvatarImage: {
    width: 22,
    height: 22,
    borderRadius: 11
  },
  eventAvatarInitials: {
    color: '#f59e0b',
    fontSize: 8,
    fontWeight: '700'
  },
  eventBlocking: { backgroundColor: 'rgba(239, 68, 68, 0.06)' },
  eventHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  eventType: {
    color: colors.foreground,
    fontSize: 12,
    fontWeight: '600',
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
  pressed: { opacity: 0.82 }
  });
