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

import { formatStatusName, type TicketStatusDefinition } from '../../components/shared';

import { type ObjectiveAttachmentItem, type Project } from './ticket-detail-shared';
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
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [statusDefinitions, setStatusDefinitions] = useState<TicketStatusDefinition[]>([]);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [headerSheetOpen, setHeaderSheetOpen] = useState(false);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [showAcceptanceCriteria, setShowAcceptanceCriteria] = useState(false);
  const [objectiveAttachments, setObjectiveAttachments] = useState<ObjectiveAttachmentItem[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [showCliQuickstart, setShowCliQuickstart] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'all' | 'completed'>('all');
  const [copyingPromptContext, setCopyingPromptContext] = useState<'cli' | 'web' | null>(null);
  const [acceptanceCriteriaDraft, setAcceptanceCriteriaDraft] = useState('');
  const [savingAcceptanceCriteria, setSavingAcceptanceCriteria] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [hasEverhourApiKey, setHasEverhourApiKey] = useState(false);
  const [eventProfiles, setEventProfiles] = useState<
    Record<string, { name: string; image_url: string }>
  >({});
  const savingTitleRef = useRef(false);
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
        setShowProjectPicker(false);
        setShowStatusPicker(false);
        setStatusDefinitions([]);
        setObjectiveAttachments([]);
        setEventProfiles({});
      }

      const supabase = getSupabase();
      const [
        ticketRes,
        objectivesRes,
        eventsRes,
        projectsRes,
        statusDefinitionsRes,
        documentsRes,
        everhourRes
      ] = await Promise.all([
        supabase
          .from('tickets')
          .select(
            'id, organization_id, title, status, priority, execution_target, due_datetime, ticket_sequence, context, constraints, acceptance_criteria, created_at, updated_at, project_id'
          )
          .eq('id', ticketId)
          .single(),
        supabase
          .from('objectives')
          .select(
            'id, objective, title, state, agent_identifier, model_identifier, assigned_agent, created_at'
          )
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
          .from('ticket_statuses')
          .select('organization_id, name, position, status_type')
          .order('position', { ascending: true }),
        supabase
          .from('objective_attachments')
          .select('id, objective_id, label, storage_path, content_type, file_size, created_at')
          .eq('ticket_id', ticketId)
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
      if (statusDefinitionsRes.data) {
        setStatusDefinitions(statusDefinitionsRes.data as TicketStatusDefinition[]);
      } else if (reset) {
        setStatusDefinitions([]);
      }
      if (documentsRes.data) {
        setObjectiveAttachments(
          documentsRes.data.map(attachment => ({
            id: attachment.id,
            objectiveId: attachment.objective_id,
            label: attachment.label,
            storagePath: attachment.storage_path ?? '',
            contentType: attachment.content_type ?? '',
            fileSize: Number(attachment.file_size ?? 0),
            createdAt: attachment.created_at
          }))
        );
      } else if (reset) {
        setObjectiveAttachments([]);
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
        const promptTicketId = ticket.ticket_id ?? ticket.id;
        const url = new URL(`/api/protocol/context/${promptTicketId}`, `${platformUrl}/`);
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
    const cliTicketId = ticket.ticket_id ?? ticket.id;
    await Clipboard.setStringAsync(
      buildCliLaunchCommand(selectedSelection.agent, cliTicketId, {
        model: selectedSelection.model,
        thinking: selectedSelection.thinking
      })
    );
    Alert.alert('Copied', 'Launch command copied.');
  }, [assignedSelection, resolvedAssignedSelection, ticket]);

  const handleCopyTicketId = useCallback(async () => {
    if (!ticket) return;
    await Clipboard.setStringAsync(ticket.ticket_id ?? ticket.id);
    Alert.alert('Copied', 'Ticket ID copied to clipboard.');
  }, [ticket]);

  const handleDeleteTicket = useCallback(async () => {
    if (!ticket) return;

    Alert.alert(
      'Delete Ticket?',
      'This action cannot be undone. The ticket will be permanently deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const supabase = getSupabase();
              const { error } = await supabase.from('tickets').delete().eq('id', ticket.id);
              if (error) {
                throw new Error(error.message);
              }
              router.replace('/(tabs)/tickets');
            } catch (error) {
              Alert.alert(
                'Unable to delete ticket',
                error instanceof Error ? error.message : 'An unexpected error occurred.'
              );
            }
          }
        }
      ]
    );
  }, [ticket, router]);

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
    setAssignedSelection(selectionFromAssignedAgent(draftObjective?.assigned_agent));
  }, [draftObjective?.assigned_agent]);

  useEffect(() => {
    setAcceptanceCriteriaDraft(ticket?.acceptance_criteria ?? '');
  }, [ticket?.acceptance_criteria]);

  useEffect(() => {
    if (!editingTitle) {
      setTitleDraft(ticket?.title ?? '');
    }
  }, [editingTitle, ticket?.title]);

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
          state: 'draft',
          assigned_agent: assignedSelection ? createAssignedAgent(assignedSelection) : null
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
    if (!ticket || !draftObjective || savingAssignedAgent) return;

    const supabase = getSupabase();
    const previousAssignedAgent = draftObjective?.assigned_agent ?? null;
    const nextAssignedAgent = createAssignedAgent(nextSelection);

    setAssignedSelection(nextSelection);
    setSavingAssignedAgent(true);

    try {
      const { error } = await supabase
        .from('objectives')
        .update({ assigned_agent: nextAssignedAgent })
        .eq('id', draftObjective?.id ?? '');

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
    setShowStatusPicker(false);
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

  async function handleStatusChange(nextStatus: string) {
    if (!ticket) return;

    const previousStatus = ticket.status;
    if (previousStatus === nextStatus) {
      setShowStatusPicker(false);
      return;
    }

    setTicket(current => (current ? { ...current, status: nextStatus } : current));
    setShowStatusPicker(false);

    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('tickets')
        .update({ status: nextStatus })
        .eq('id', ticket.id);

      if (error) {
        throw new Error(error.message);
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        event_type: 'status_change',
        summary: `Status changed to ${formatStatusName(nextStatus)} from mobile.`,
        ticket_id: ticket.id
      });

      if (eventError) {
        console.error('Failed to record status update event:', eventError.message);
      }
    } catch (error) {
      setTicket(current => (current ? { ...current, status: previousStatus } : current));
      Alert.alert(
        'Unable to update status',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
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

  async function ensureDraftObjectiveId(): Promise<string | null> {
    if (draftObjective?.id) return draftObjective.id;
    const trimmed = objectiveDraft.trim();
    if (!trimmed) {
      Alert.alert('Objective required', 'Enter an objective before attaching files.');
      return null;
    }
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('objectives')
      .insert({
        ticket_id: ticketId,
        objective: trimmed,
        state: 'draft'
      })
      .select('id')
      .single();
    if (error || !data) {
      Alert.alert('Unable to save objective', error?.message ?? 'An unexpected error occurred.');
      return null;
    }
    await supabase.from('ticket_events').insert({
      event_type: 'system',
      summary: 'Objective created from mobile.',
      ticket_id: ticketId
    });
    await loadData();
    return data.id;
  }

  async function handleAttachToObjective(options: {
    uri: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }) {
    if (!ticket || uploadingAttachment) return;

    const objectiveId = await ensureDraftObjectiveId();
    if (!objectiveId) return;

    setUploadingAttachment(true);
    try {
      const supabase = getSupabase();
      const storagePath = `${ticket.organization_id}/${ticket.project_id ?? 'personal'}/${ticket.id}/${objectiveId}/${Date.now()}-${sanitizeFileName(options.fileName)}`;
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

      const { error: attachmentError } = await supabase.from('objective_attachments').insert({
        objective_id: objectiveId,
        ticket_id: ticket.id,
        content_type: options.mimeType,
        file_size: options.fileSize,
        label: options.fileName,
        storage_path: storagePath,
        metadata: {
          size: options.fileSize,
          type: options.mimeType,
          fileName: options.fileName
        }
      });

      if (attachmentError) {
        throw new Error(attachmentError.message);
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        event_type: 'artifact',
        summary: `Objective attachment uploaded: ${options.fileName}`,
        ticket_id: ticket.id
      });

      if (eventError) {
        console.error('Failed to record attachment event:', eventError.message);
      }

      await loadData();
    } catch (error) {
      Alert.alert(
        'Upload failed',
        error instanceof Error ? error.message : 'An unexpected upload error occurred.'
      );
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleOpenAttachment(attachment: ObjectiveAttachmentItem) {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.storage
        .from('artifacts')
        .createSignedUrl(attachment.storagePath, 3600);

      if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? 'Unable to open attachment.');
      }

      await Linking.openURL(data.signedUrl);
    } catch (error) {
      Alert.alert(
        'Unable to open attachment',
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

  const handleBeginTitleEdit = useCallback(() => {
    if (!ticket || savingTitleRef.current) return;
    setTitleDraft(ticket.title ?? '');
    setEditingTitle(true);
  }, [ticket]);

  const handleSaveTitle = useCallback(async () => {
    if (!ticket || savingTitleRef.current) return;

    const nextTitle = titleDraft.trim();
    const previousTitle = ticket.title ?? '';

    if (!nextTitle) {
      Alert.alert('Title required', 'Ticket titles cannot be empty.');
      setTitleDraft(previousTitle);
      setEditingTitle(false);
      return;
    }

    if (nextTitle === previousTitle.trim()) {
      setTitleDraft(previousTitle);
      setEditingTitle(false);
      return;
    }

    const supabase = getSupabase();
    setEditingTitle(false);
    savingTitleRef.current = true;
    setTicket(current => (current ? { ...current, title: nextTitle } : current));
    setTitleDraft(nextTitle);

    try {
      const { error } = await supabase
        .from('tickets')
        .update({ title: nextTitle })
        .eq('id', ticket.id);

      if (error) {
        throw new Error(error.message);
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Ticket title updated from mobile.',
        ticket_id: ticket.id
      });

      if (eventError) {
        console.error('Failed to record ticket title update event:', eventError.message);
      }
    } catch (error) {
      setTitleDraft(previousTitle);
      setTicket(current => (current ? { ...current, title: previousTitle } : current));
      Alert.alert(
        'Unable to update ticket title',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      savingTitleRef.current = false;
    }
  }, [ticket, titleDraft]);

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
        ticketId: ticket.ticket_id ?? ticket.id,
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
            ticketId: ticket.ticket_id ?? ticket.id,
            ticketSequence: ticket.ticket_sequence,
            agent: resolvedAssignedSelection.agent,
            server,
            keyTag: tag
          })
        : await launchTicketOnServerWithPassword({
            ticketId: ticket.ticket_id ?? ticket.id,
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
        ticketId: ticket.ticket_id ?? ticket.id,
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
  const ticketStatuses = statusDefinitions
    .filter(status => status.organization_id === ticket.organization_id)
    .slice()
    .sort((left, right) => left.position - right.position);
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
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerTintColor: colors.foreground,
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
        copyingPromptContext={copyingPromptContext}
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
        titleDraft={titleDraft}
        editingTitle={editingTitle}
        dueLabel={dueLabel}
        currentProject={currentProject}
        projects={projects}
        selectedProjectId={selectedProjectId}
        showProjectPicker={showProjectPicker}
        statusDefinitions={ticketStatuses}
        showStatusPicker={showStatusPicker}
        savingProject={savingProject}
        onToggleProjectPicker={() => {
          setShowStatusPicker(false);
          setShowProjectPicker(prev => !prev);
        }}
        onToggleStatusPicker={() => {
          setShowProjectPicker(false);
          setShowStatusPicker(prev => !prev);
        }}
        onChangeProject={handleProjectChange}
        onChangeStatus={handleStatusChange}
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
        objectiveAttachments={objectiveAttachments}
        uploadingAttachment={uploadingAttachment}
        onAttachToObjective={handleAttachToObjective}
        onOpenAttachment={handleOpenAttachment}
        draftObjectiveId={draftObjective?.id ?? null}
        assignedSelection={assignedSelection}
        savingAssignedAgent={savingAssignedAgent}
        onAssignedAgentChange={handleAssignedAgentChange}
        onResolvedSelectionChange={setResolvedAssignedSelection}
        hasEverhourApiKey={hasEverhourApiKey}
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
        onBeginTitleEdit={handleBeginTitleEdit}
        onTitleChange={setTitleDraft}
        onTitleSubmit={() => {
          void handleSaveTitle();
        }}
        onTitleBlur={() => {
          void handleSaveTitle();
        }}
        onBackgroundPress={() => {
          if (editingTitle) {
            void handleSaveTitle();
          }
        }}
      />
      <TicketDetailModals
        overflowOpen={overflowOpen}
        onCloseOverflow={() => setOverflowOpen(false)}
        onCopyTicketId={handleCopyTicketId}
        onReload={loadData}
        onNewTicket={() => setShowNewTicketModal(true)}
        onDelete={handleDeleteTicket}
      />
      <QuickCreateTicketModal
        visible={showNewTicketModal}
        onClose={() => setShowNewTicketModal(false)}
        defaultProjectId={ticket.project_id}
      />
    </SafeAreaView>
  );
}
