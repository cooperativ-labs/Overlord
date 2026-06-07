import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QuickCreateTicketModal } from '@/components/QuickCreateTicketModal';
import { formatStatusName, type TicketStatusDefinition } from '@/components/tickets/shared';
import {
  createAssignedAgent,
  DEFAULT_AGENT_MODEL_SELECTION,
  selectionFromAssignedAgent
} from '@/lib/agent-models';
import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { useExecutionTargets } from '@/lib/execution-targets-context';
import { useTicketRealtime } from '@/lib/hooks/use-ticket-realtime';
import { Ionicons } from '@/lib/icons';
import { buildCliLaunchCommand } from '@/lib/launch-commands';
import { resolveLaunchOAuthSession, resolvePlatformUrl } from '@/lib/platform';
import { queueTicketExecution } from '@/lib/queue-execution';
import { getSupabase } from '@/lib/supabase';
import { isTransientNetworkError } from '@/lib/transient-network-error';
import type {
  AgentModelSelection,
  Objective,
  TicketAgentSessionSummary,
  TicketDetail,
  TicketDetailRow,
  TicketEvent
} from '@/lib/types';
import { normalizeTicketExecutionTarget } from '@/lib/types';

import { type ObjectiveAttachmentItem, type Project } from './ticket-detail-shared';
import { createStyles } from './ticket-detail-styles';
import { TicketDetailContent } from './TicketDetailContent';
import {
  type TicketAssigneeOption,
  TicketHeaderRight,
  TicketHeaderSheet,
  TicketHeaderTitle
} from './TicketDetailHeader';
import { TicketDetailModals } from './TicketDetailModals';

export default function TicketDetailScreen() {
  const { ticketId, returnTo } = useLocalSearchParams<
    '/(tabs)/tickets/[ticketId]',
    { returnTo?: string }
  >();
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const { selectedTarget, refresh: refreshTargets } = useExecutionTargets();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [executingSession, setExecutingSession] = useState<TicketAgentSessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [objectiveDraft, setObjectiveDraft] = useState('');
  const [savingObjective, setSavingObjective] = useState(false);
  const [selectedDraftObjectiveId, setSelectedDraftObjectiveId] = useState<string | null>(null);
  const [addingDraftObjective, setAddingDraftObjective] = useState(false);
  const [assignedSelection, setAssignedSelection] = useState<AgentModelSelection | null>(null);
  const [resolvedAssignedSelection, setResolvedAssignedSelection] =
    useState<AgentModelSelection | null>(null);
  const [savingAssignedAgent, setSavingAssignedAgent] = useState(false);
  // `resolvedAssignedSelection` is only emitted while the AgentModelChooser
  // panel is mounted. Fall back to the objective's already-assigned agent so the
  // queue button is enabled without forcing the user to open the chooser.
  const effectiveAssignedSelection = resolvedAssignedSelection ?? assignedSelection;
  const [expandedObjectiveIds, setExpandedObjectiveIds] = useState<string[]>([]);
  const [queueing, setQueueing] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [members, setMembers] = useState<TicketAssigneeOption[]>([]);
  const [savingAssignee, setSavingAssignee] = useState(false);
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
  const [futureObjectivesEnabled, setFutureObjectivesEnabled] = useState(false);
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
        setExecutingSession(null);
        setProjects([]);
        setSelectedProjectId(null);
        setShowProjectPicker(false);
        setShowStatusPicker(false);
        setStatusDefinitions([]);
        setObjectiveAttachments([]);
        setEventProfiles({});
        setFutureObjectivesEnabled(false);
      }

      const supabase = getSupabase();
      const [
        ticketRes,
        objectivesRes,
        eventsRes,
        projectsRes,
        statusDefinitionsRes,
        documentsRes,
        futureObjectivesFeatureRes
      ] = await Promise.all([
        supabase
          .from('tickets')
          .select(
            'id, organization_id, title, status, priority, for_human, due_datetime, ticket_sequence, context, constraints, acceptance_criteria, created_at, updated_at, project_id, ticket_id, everhour_task_id, assigned_member'
          )
          .eq('id', ticketId)
          .single(),
        supabase
          .from('objectives')
          .select(
            'id, objective, title, state, agent_identifier, model_identifier, assigned_agent, position, auto_advance, approval_reason, auto_advanced_at, created_at'
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
        supabase
          .from('app_features')
          .select('is_enabled')
          .eq('key', 'future-objectives')
          .maybeSingle()
      ]);

      if (loadSequenceRef.current !== loadSequence) {
        return;
      }

      if (ticketRes.data) {
        const normalizedTicket = normalizeTicketExecutionTarget(ticketRes.data as TicketDetailRow);
        setTicket(normalizedTicket);
        setSelectedProjectId(normalizedTicket.project_id ?? null);

        // Load the org member directory for the assignee picker (SECURITY DEFINER
        // RPC returns only safe display columns to verified co-members).
        const directoryRes = await supabase.rpc('get_org_member_directory', {
          org_id: normalizedTicket.organization_id
        });
        if (loadSequenceRef.current !== loadSequence) {
          return;
        }
        if (directoryRes.data) {
          const directoryRows = directoryRes.data as {
            member_id: string;
            user_id: string;
            name: string | null;
            username: string | null;
            email: string | null;
          }[];
          setMembers(
            directoryRows.map(row => ({
              memberId: row.member_id,
              userId: row.user_id,
              name: row.name?.trim() || row.username || row.email || 'Member',
              username: row.username ?? null
            }))
          );
        } else if (reset) {
          setMembers([]);
        }
      } else if (ticketRes.error) {
        setTicket(null);
        setSelectedProjectId(null);
      }
      if (objectivesRes.data) {
        setObjectives(objectivesRes.data);
        const objectiveIds = objectivesRes.data.map(objective => objective.id);
        if (objectiveIds.length > 0) {
          const { data: sessionsData, error: sessionsError } = await supabase
            .from('agent_sessions')
            .select('objective_id,session_state,agent_identifier,attached_at')
            .in('objective_id', objectiveIds)
            .eq('session_state', 'attached')
            .order('attached_at', { ascending: false })
            .limit(1);

          if (loadSequenceRef.current !== loadSequence) {
            return;
          }

          if (sessionsError) {
            console.warn('Failed to load executing session:', sessionsError.message);
            setExecutingSession(null);
          } else {
            setExecutingSession(
              ((sessionsData ?? [])[0] as TicketAgentSessionSummary | undefined) ?? null
            );
          }
        } else {
          setExecutingSession(null);
        }
      } else if (reset) {
        setObjectives([]);
        setExecutingSession(null);
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
      if (futureObjectivesFeatureRes.error) {
        console.warn(
          'Failed to load future-objectives app feature:',
          futureObjectivesFeatureRes.error.message
        );
        setFutureObjectivesEnabled(false);
      } else if (typeof futureObjectivesFeatureRes.data?.is_enabled === 'boolean') {
        setFutureObjectivesEnabled(futureObjectivesFeatureRes.data.is_enabled);
      } else {
        setFutureObjectivesEnabled(false);
      }
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
    [ticketId]
  );

  useEffect(() => {
    void loadData({ reset: true });
  }, [loadData]);

  // Realtime updates for ticket detail
  useTicketRealtime(
    ticketId,
    objectives.map(objective => objective.id),
    loadData
  );

  const draftObjectives = useMemo(
    () =>
      objectives
        .filter(
          objective =>
            objective.state === 'draft' || (futureObjectivesEnabled && objective.state === 'future')
        )
        .slice()
        .sort(
          (left, right) =>
            new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
        ),
    [futureObjectivesEnabled, objectives]
  );

  const activeDraftObjective = useMemo(() => {
    if (draftObjectives.length === 0) {
      return null;
    }
    if (selectedDraftObjectiveId) {
      return (
        draftObjectives.find(objective => objective.id === selectedDraftObjectiveId) ??
        draftObjectives[0] ??
        null
      );
    }
    return draftObjectives[0] ?? null;
  }, [draftObjectives, selectedDraftObjectiveId]);

  useEffect(() => {
    if (
      selectedDraftObjectiveId &&
      !draftObjectives.some(objective => objective.id === selectedDraftObjectiveId)
    ) {
      setSelectedDraftObjectiveId(null);
    }
  }, [draftObjectives, selectedDraftObjectiveId]);

  const filteredEvents = useMemo(() => {
    if (activityFilter === 'completed') {
      return events.filter(event => event.event_type === 'deliver' || event.phase === 'complete');
    }
    return events;
  }, [events, activityFilter]);
  const cliTicketId = ticket?.ticket_id ?? ticketId;

  const handleCopyPrompt = useCallback(
    async (context: 'cli' | 'web') => {
      if (!ticket) return;

      setCopyingPromptContext(context);
      try {
        const { accessToken, organizationId } = await resolveLaunchOAuthSession();
        const platformUrl = resolvePlatformUrl();
        const url = new URL(`/api/protocol/context/${cliTicketId}`, `${platformUrl}/`);
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
    [cliTicketId, ticket]
  );

  const handleCopyCliCommand = useCallback(async () => {
    if (!ticket) return;
    const selectedSelection =
      assignedSelection ?? resolvedAssignedSelection ?? DEFAULT_AGENT_MODEL_SELECTION;
    await Clipboard.setStringAsync(
      buildCliLaunchCommand(selectedSelection.agent, cliTicketId, {
        model: selectedSelection.model,
        thinking: selectedSelection.thinking
      })
    );
    Alert.alert('Copied', 'Launch command copied.');
  }, [assignedSelection, cliTicketId, resolvedAssignedSelection, ticket]);

  const handleCopyTicketId = useCallback(async () => {
    if (!ticket) return;
    await Clipboard.setStringAsync(cliTicketId);
    Alert.alert('Copied', 'Ticket ID copied to clipboard.');
  }, [cliTicketId, ticket]);

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
        .filter(
          objective =>
            objective.state !== 'draft' &&
            (!futureObjectivesEnabled || objective.state !== 'future') &&
            objective.state !== 'submitted' &&
            objective.objective.trim().length > 0
        )
        .slice()
        .sort((left, right) => {
          return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        }),
    [futureObjectivesEnabled, objectives]
  );

  useEffect(() => {
    setObjectiveDraft(activeDraftObjective?.objective ?? '');
  }, [activeDraftObjective?.id, activeDraftObjective?.objective]);

  useEffect(() => {
    setAssignedSelection(selectionFromAssignedAgent(activeDraftObjective?.assigned_agent));
  }, [activeDraftObjective?.assigned_agent]);

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
      void refreshTargets();
    }, [refreshTargets])
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
      const hasExistingDraft = Boolean(activeDraftObjective);
      let savedObjectiveId: string | null = activeDraftObjective?.id ?? null;

      if (activeDraftObjective) {
        const { error } = await supabase
          .from('objectives')
          .update({ objective: trimmedObjective })
          .eq('id', activeDraftObjective.id);

        if (error) {
          throw new Error(error.message);
        }
      } else {
        const { data, error } = await supabase
          .from('objectives')
          .insert({
            ticket_id: ticketId,
            objective: trimmedObjective,
            state: 'draft',
            assigned_agent: assignedSelection ? createAssignedAgent(assignedSelection) : null
          })
          .select('id')
          .single();

        if (error) {
          throw new Error(error.message);
        }
        savedObjectiveId = data?.id ?? null;
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: hasExistingDraft
          ? 'Objective updated from mobile.'
          : 'Objective created from mobile.',
        ticket_id: ticketId,
        objective_id: savedObjectiveId
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

  async function handleAddDraftObjective() {
    if (!ticket || addingDraftObjective || !futureObjectivesEnabled) return;
    const lastDraft = draftObjectives[draftObjectives.length - 1];
    if (lastDraft && lastDraft.objective.trim() === '') {
      Alert.alert('Add objective', 'Fill or save the empty objective before adding another.');
      return;
    }

    setAddingDraftObjective(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('objectives')
        .insert({
          ticket_id: ticket.id,
          state: 'draft',
          objective: ''
        })
        .select('id')
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? 'Failed to add objective.');
      }

      setSelectedDraftObjectiveId(data.id);
      await loadData();
    } catch (error) {
      Alert.alert(
        'Unable to add objective',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setAddingDraftObjective(false);
    }
  }

  async function handleAssignedAgentChange(nextSelection: AgentModelSelection) {
    if (!ticket || !activeDraftObjective || savingAssignedAgent) return;

    const supabase = getSupabase();
    const previousAssignedAgent = activeDraftObjective?.assigned_agent ?? null;
    const nextAssignedAgent = createAssignedAgent(nextSelection);

    setAssignedSelection(nextSelection);
    setSavingAssignedAgent(true);

    try {
      const { error } = await supabase
        .from('objectives')
        .update({ assigned_agent: nextAssignedAgent })
        .eq('id', activeDraftObjective?.id ?? '');

      if (error) {
        throw new Error(error.message);
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Assigned agent updated.',
        ticket_id: ticket.id,
        objective_id: activeDraftObjective?.id ?? null
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

  async function handleAssigneeChange(nextAssignedMember: string | null) {
    if (!ticket || savingAssignee) return;
    if ((ticket.assigned_member ?? null) === nextAssignedMember) return;

    const previousAssignedMember = ticket.assigned_member ?? null;
    setTicket(current => (current ? { ...current, assigned_member: nextAssignedMember } : current));
    setSavingAssignee(true);

    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('tickets')
        .update({ assigned_member: nextAssignedMember })
        .eq('id', ticket.id);

      if (error) throw new Error(error.message);

      await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: nextAssignedMember
          ? 'Assignee updated from mobile.'
          : 'Ticket unassigned from mobile.',
        ticket_id: ticket.id
      });
    } catch (error) {
      setTicket(current =>
        current ? { ...current, assigned_member: previousAssignedMember } : current
      );
      Alert.alert(
        'Unable to update assignee',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setSavingAssignee(false);
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
        ticket_id: ticket.id,
        objective_id: activeDraftObjective?.id ?? null
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
    if (activeDraftObjective?.id) return activeDraftObjective.id;
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
      ticket_id: ticketId,
      objective_id: data.id
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
        ticket_id: ticket.id,
        objective_id: objectiveId
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
        ticket_id: ticket.id,
        objective_id: activeDraftObjective?.id ?? null
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
        ticket_id: ticket.id,
        objective_id: activeDraftObjective?.id ?? null
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
  }, [ticket, titleDraft, activeDraftObjective?.id]);

  async function handleQueueExecution() {
    if (!ticket) return;

    if (!effectiveAssignedSelection) {
      Alert.alert('Select an agent', 'Choose an agent before queuing this ticket.');
      return;
    }

    if (!selectedTarget) {
      Alert.alert(
        'No execution target',
        'Choose an execution target in the Servers tab before queuing this ticket.'
      );
      return;
    }

    setQueueing(true);
    try {
      // The runner resolves the agent from the objective's assigned_agent, so
      // make sure the draft objective carries one before queuing.
      if (activeDraftObjective && !activeDraftObjective.assigned_agent?.agent) {
        const supabase = getSupabase();
        const { error: assignError } = await supabase
          .from('objectives')
          .update({ assigned_agent: createAssignedAgent(effectiveAssignedSelection) })
          .eq('id', activeDraftObjective.id);
        if (assignError) {
          throw new Error(assignError.message);
        }
      }

      const result = await queueTicketExecution({
        ticketId: ticket.ticket_id ?? ticket.id,
        objectiveId: activeDraftObjective?.id ?? null,
        executionTargetId: selectedTarget.id
      });

      Alert.alert(
        result.reused ? 'Re-queued' : 'Queued',
        `Queued in ${selectedTarget.label}. The runner attached to this target will pick it up shortly.`
      );
      await loadData();
    } catch (error) {
      Alert.alert(
        'Unable to queue execution',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setQueueing(false);
    }
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
  const normalizedSavedDraft = (activeDraftObjective?.objective ?? '').trim();
  const objectiveActionLabel = activeDraftObjective
    ? normalizedSavedDraft
      ? 'Update Objective'
      : 'Save Objective'
    : 'Create Objective';
  const hasObjectiveChanges = normalizedObjectiveDraft !== normalizedSavedDraft;
  const canSaveObjective =
    !savingObjective && normalizedObjectiveDraft.length > 0 && hasObjectiveChanges;
  const lastDraftForAddCheck = draftObjectives[draftObjectives.length - 1];
  const addDraftObjectiveDisabled = Boolean(
    lastDraftForAddCheck && lastDraftForAddCheck.objective.trim() === ''
  );
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
  const returnToPath = returnTo === '/(tabs)/feed' ? returnTo : null;

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
        ticketUuid={ticket.id}
        everhourTaskId={ticket.everhour_task_id ?? null}
        copyingPromptContext={copyingPromptContext}
        members={members}
        assignedMember={ticket.assigned_member ?? null}
        savingAssignee={savingAssignee}
        onChangeAssignee={value => {
          void handleAssigneeChange(value);
        }}
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
        ticketId={cliTicketId}
        executingSession={executingSession}
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
        draftObjectives={draftObjectives}
        highlightedDraftObjectiveId={activeDraftObjective?.id ?? null}
        onSelectDraftObjective={setSelectedDraftObjectiveId}
        onAddDraftObjective={() => {
          void handleAddDraftObjective();
        }}
        futureObjectivesEnabled={futureObjectivesEnabled}
        addDraftObjectiveDisabled={addDraftObjectiveDisabled}
        addingDraftObjective={addingDraftObjective}
        executedObjectives={executedObjectives}
        expandedObjectiveIds={expandedObjectiveIds}
        toggleObjectiveExpanded={toggleObjectiveExpanded}
        canSaveObjective={canSaveObjective}
        objectiveActionLabel={objectiveActionLabel}
        savingObjective={savingObjective}
        onSaveObjective={handleSaveObjective}
        onQueueExecution={handleQueueExecution}
        queueing={queueing}
        selectedTargetLabel={selectedTarget?.label ?? null}
        resolvedAssignedSelection={effectiveAssignedSelection}
        objectiveAttachments={objectiveAttachments}
        uploadingAttachment={uploadingAttachment}
        onAttachToObjective={handleAttachToObjective}
        onOpenAttachment={handleOpenAttachment}
        draftObjectiveId={activeDraftObjective?.id ?? null}
        assignedSelection={assignedSelection}
        savingAssignedAgent={savingAssignedAgent}
        onAssignedAgentChange={handleAssignedAgentChange}
        onResolvedSelectionChange={setResolvedAssignedSelection}
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
