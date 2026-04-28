import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { AgentModelChooser } from '@/components/AgentModelChooser';
import { createAssignedAgent } from '@/lib/agent-models';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { useSelectedProject } from '@/lib/selected-project-context';
import { getSupabase } from '@/lib/supabase';
import type { AgentModelSelection, TicketExecutionTarget, TicketPriority } from '@/lib/types';

type Project = {
  id: string;
  name: string;
  organization_id: number;
};

const priorities: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' }
];

function getPriorityColors(colors: ThemeColors): Record<TicketPriority, string> {
  return {
    low: colors.mutedForeground,
    medium: colors.primary,
    high: '#f59e0b',
    urgent: colors.destructive
  };
}

const executionTargets: { value: TicketExecutionTarget; label: string; icon: string }[] = [
  { value: 'agent', label: 'Agent', icon: 'hardware-chip-outline' },
  { value: 'human', label: 'Human', icon: 'person-outline' }
];

export default function CreateTicketScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const { projectId: projectIdParam, dueDate: dueDateParam } = useLocalSearchParams<{
    projectId?: string;
    dueDate?: string;
  }>();
  const { selectedProjectId: contextSelectedProjectId } = useSelectedProject();
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [context, setContext] = useState('');
  const [constraints, setConstraints] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [executionTarget, setExecutionTarget] = useState<TicketExecutionTarget>('agent');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [assignedSelection, setAssignedSelection] = useState<AgentModelSelection | null>(null);
  const priorityColors = getPriorityColors(colors);
  const dueDateKey =
    typeof dueDateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDateParam)
      ? dueDateParam
      : null;
  const dueDateLabel = dueDateKey
    ? format(parseISO(`${dueDateKey}T12:00:00.000Z`), 'EEEE, MMM d')
    : null;

  useEffect(() => {
    async function loadProjects() {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('projects')
          .select('id, name, organization_id')
          .order('name', { ascending: true });

        if (error) {
          Alert.alert('Unable to load projects', error.message);
          return;
        }

        if (data && data.length > 0) {
          setProjects(data);
          const preferredId =
            (projectIdParam && data.some(p => p.id === projectIdParam) && projectIdParam) ||
            (contextSelectedProjectId &&
              data.some(p => p.id === contextSelectedProjectId) &&
              contextSelectedProjectId) ||
            data[0].id;
          setSelectedProjectId(preferredId);
        }
      } finally {
        setLoadingProjects(false);
      }
    }

    loadProjects();
  }, [projectIdParam, contextSelectedProjectId]);

  async function handleSubmit() {
    const trimmedObjective = objective.trim();
    if (!trimmedObjective || !selectedProjectId) return;

    const selectedProject = projects.find(p => p.id === selectedProjectId);
    if (!selectedProject) return;

    setSubmitting(true);

    try {
      const supabase = getSupabase();

      const trimmedTitle = title.trim();
      const fallbackTitle =
        trimmedObjective.length > 80 ? trimmedObjective.substring(0, 77) + '...' : trimmedObjective;
      const finalTitle = trimmedTitle.length > 0 ? trimmedTitle : fallbackTitle;
      const trimmedContext = context.trim();
      const trimmedConstraints = constraints.trim();
      const dueDatetime = dueDateKey ? `${dueDateKey}T12:00:00.000Z` : null;

      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          title: finalTitle,
          status: 'next-up',
          priority,
          execution_target: executionTarget,
          organization_id: selectedProject.organization_id,
          project_id: selectedProjectId,
          due_datetime: dueDatetime,
          acceptance_criteria:
            acceptanceCriteria.trim().length > 0 ? acceptanceCriteria.trim() : null,
          context: trimmedContext,
          constraints: trimmedConstraints,
          assigned_agent: assignedSelection ? createAssignedAgent(assignedSelection) : null
        })
        .select('id, organization_id')
        .single();

      if (ticketError || !ticket) {
        throw new Error(ticketError?.message ?? 'Failed to create ticket.');
      }

      // Insert the objective
      const { error: objectiveError } = await supabase.from('objectives').insert({
        ticket_id: ticket.id,
        objective: trimmedObjective,
        state: 'draft'
      });

      if (objectiveError) {
        console.error('Failed to create objective:', objectiveError.message);
      }

      // Insert a system event
      await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Ticket created from mobile.',
        ticket_id: ticket.id
      });

      router.back();
    } catch (error) {
      Alert.alert(
        'Failed to create ticket',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const canSubmit = objective.trim().length > 0 && selectedProjectId && !submitting;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      <Stack.Screen
        options={{
          title: 'New Ticket',
          headerShown: true,
          headerBackTitle: 'Cancel',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerRight: () => (
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : canSubmit ? 1 : 0.4 })}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.submitButton}>Create</Text>
              )}
            </Pressable>
          )
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder="Optional — generated from objective if empty"
            placeholderTextColor={colors.mutedForeground}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>What needs to be done?</Text>
          <TextInput
            style={styles.objectiveInput}
            value={objective}
            onChangeText={setObjective}
            placeholder="Describe the task..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            autoFocus
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Acceptance criteria</Text>
          <TextInput
            style={styles.criteriaInput}
            value={acceptanceCriteria}
            onChangeText={setAcceptanceCriteria}
            placeholder="Define when this ticket is complete..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Context</Text>
          <TextInput
            style={styles.criteriaInput}
            value={context}
            onChangeText={setContext}
            placeholder="Background, links, references..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Constraints</Text>
          <TextInput
            style={styles.criteriaInput}
            value={constraints}
            onChangeText={setConstraints}
            placeholder="What the agent must avoid or honor..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlignVertical="top"
          />
        </View>

        {dueDateLabel && (
          <View style={styles.section}>
            <Text style={styles.label}>Due date</Text>
            <View style={styles.dueDateCard}>
              <Ionicons name="calendar-outline" size={16} color={colors.primary} />
              <Text style={styles.dueDateText}>{dueDateLabel}</Text>
            </View>
          </View>
        )}

        {/* Project Selector */}
        <View style={styles.section}>
          <Text style={styles.label}>Project</Text>
          {loadingProjects ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>Loading projects...</Text>
            </View>
          ) : (
            <>
              <Pressable
                style={styles.selector}
                onPress={() => setShowProjectPicker(!showProjectPicker)}
              >
                <Text style={styles.selectorText}>
                  {selectedProject?.name ?? 'Select a project'}
                </Text>
                <Ionicons
                  name={showProjectPicker ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
              {showProjectPicker && (
                <View style={styles.pickerList}>
                  {projects.map(project => {
                    const isSelected = project.id === selectedProjectId;
                    return (
                      <Pressable
                        key={project.id}
                        style={[styles.pickerItem, isSelected && styles.pickerItemSelected]}
                        onPress={() => {
                          setSelectedProjectId(project.id);
                          setShowProjectPicker(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.pickerItemText,
                            isSelected && styles.pickerItemTextSelected
                          ]}
                        >
                          {project.name}
                        </Text>
                        {isSelected && (
                          <Ionicons name="checkmark" size={18} color={colors.primary} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>

        {/* Priority Selector */}
        <View style={styles.section}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.priorityRow}>
            {priorities.map(p => {
              const isSelected = p.value === priority;
              return (
                <Pressable
                  key={p.value}
                  style={[
                    styles.priorityChip,
                    isSelected && {
                      backgroundColor: priorityColors[p.value] + '20',
                      borderColor: priorityColors[p.value]
                    }
                  ]}
                  onPress={() => setPriority(p.value)}
                >
                  <View
                    style={[styles.priorityDot, { backgroundColor: priorityColors[p.value] }]}
                  />
                  <Text style={[styles.priorityText, isSelected && { color: colors.foreground }]}>
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Execution target</Text>
          <View style={styles.priorityRow}>
            {executionTargets.map(target => {
              const isSelected = target.value === executionTarget;
              return (
                <Pressable
                  key={target.value}
                  style={[
                    styles.priorityChip,
                    isSelected && {
                      backgroundColor: colors.primary + '20',
                      borderColor: colors.primary
                    }
                  ]}
                  onPress={() => setExecutionTarget(target.value)}
                >
                  <Ionicons
                    name={target.icon as keyof typeof Ionicons.glyphMap}
                    size={14}
                    color={isSelected ? colors.primary : colors.mutedForeground}
                  />
                  <Text style={[styles.priorityText, isSelected && { color: colors.foreground }]}>
                    {target.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Assigned Agent</Text>
          <AgentModelChooser
            value={assignedSelection}
            onChange={setAssignedSelection}
            onResolvedSelectionChange={setAssignedSelection}
            helperText="New tickets start with your saved desktop agent/model preference, but you can override it here."
            disabled={submitting}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background
    },
    scrollView: {
      flex: 1
    },
    scrollContent: {
      padding: 16
    },
    section: {
      marginBottom: 24
    },
    dueDateCard: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    dueDateText: {
      color: colors.foreground,
      fontSize: 15,
      fontWeight: '600'
    },
    label: {
      color: colors.mutedForeground,
      fontSize: 13,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 10
    },
    titleInput: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 12,
      color: colors.foreground,
      fontSize: 16
    },
    objectiveInput: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      color: colors.foreground,
      fontSize: 16,
      lineHeight: 24,
      minHeight: 140
    },
    criteriaInput: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      color: colors.foreground,
      fontSize: 15,
      lineHeight: 22,
      minHeight: 110
    },
    selector: {
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    selectorText: {
      color: colors.foreground,
      fontSize: 16
    },
    pickerList: {
      marginTop: 8,
      backgroundColor: colors.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden'
    },
    pickerItem: {
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    pickerItemSelected: {
      backgroundColor: colors.secondary
    },
    pickerItemText: {
      color: colors.secondaryForeground,
      fontSize: 16
    },
    pickerItemTextSelected: {
      color: colors.foreground,
      fontWeight: '600'
    },
    priorityRow: {
      flexDirection: 'row',
      gap: 8
    },
    priorityChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.card,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 12,
      paddingHorizontal: 8
    },
    priorityDot: {
      width: 8,
      height: 8,
      borderRadius: 4
    },
    priorityText: {
      color: colors.secondaryForeground,
      fontSize: 13,
      fontWeight: '600'
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 16
    },
    loadingText: {
      color: colors.mutedForeground,
      fontSize: 14
    },
    submitButton: {
      color: colors.primary,
      fontSize: 17,
      fontWeight: '600'
    }
  });
