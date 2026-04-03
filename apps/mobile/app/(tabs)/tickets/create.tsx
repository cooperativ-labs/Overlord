import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
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
  View,
} from 'react-native';

import { colors } from '@/lib/colors';
import { getSupabase } from '@/lib/supabase';
import type { TicketPriority } from '@/lib/types';

type Project = {
  id: string;
  name: string;
  organization_id: number;
};

const priorities: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const priorityColors: Record<TicketPriority, string> = {
  low: colors.mutedForeground,
  medium: colors.primary,
  high: '#f59e0b',
  urgent: colors.destructive,
};

export default function CreateTicketScreen() {
  const router = useRouter();
  const [objective, setObjective] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

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
          setSelectedProjectId(data[0].id);
        }
      } finally {
        setLoadingProjects(false);
      }
    }

    loadProjects();
  }, []);

  async function handleSubmit() {
    const trimmedObjective = objective.trim();
    if (!trimmedObjective || !selectedProjectId) return;

    const selectedProject = projects.find((p) => p.id === selectedProjectId);
    if (!selectedProject) return;

    setSubmitting(true);

    try {
      const supabase = getSupabase();

      // Generate a simple title from the objective
      const title =
        trimmedObjective.length > 80
          ? trimmedObjective.substring(0, 77) + '...'
          : trimmedObjective;

      // Insert the ticket
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          title,
          status: 'next-up',
          priority,
          organization_id: selectedProject.organization_id,
          project_id: selectedProjectId,
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
        state: 'draft',
      });

      if (objectiveError) {
        console.error('Failed to create objective:', objectiveError.message);
      }

      // Insert a system event
      await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Ticket created from mobile.',
        ticket_id: ticket.id,
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

  const selectedProject = projects.find((p) => p.id === selectedProjectId);
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
          ),
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Objective */}
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
                  {projects.map((project) => {
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
                            isSelected && styles.pickerItemTextSelected,
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
            {priorities.map((p) => {
              const isSelected = p.value === priority;
              return (
                <Pressable
                  key={p.value}
                  style={[
                    styles.priorityChip,
                    isSelected && {
                      backgroundColor: priorityColors[p.value] + '20',
                      borderColor: priorityColors[p.value],
                    },
                  ]}
                  onPress={() => setPriority(p.value)}
                >
                  <View
                    style={[styles.priorityDot, { backgroundColor: priorityColors[p.value] }]}
                  />
                  <Text
                    style={[
                      styles.priorityText,
                      isSelected && { color: colors.foreground },
                    ]}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
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
    minHeight: 140,
  },
  selector: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorText: {
    color: colors.foreground,
    fontSize: 16,
  },
  pickerList: {
    marginTop: 8,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pickerItem: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerItemSelected: {
    backgroundColor: colors.secondary,
  },
  pickerItemText: {
    color: colors.secondaryForeground,
    fontSize: 16,
  },
  pickerItemTextSelected: {
    color: colors.foreground,
    fontWeight: '600',
  },
  priorityRow: {
    flexDirection: 'row',
    gap: 8,
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
    paddingHorizontal: 8,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  priorityText: {
    color: colors.secondaryForeground,
    fontSize: 13,
    fontWeight: '600',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
  },
  loadingText: {
    color: colors.mutedForeground,
    fontSize: 14,
  },
  submitButton: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: '600',
  },
});
