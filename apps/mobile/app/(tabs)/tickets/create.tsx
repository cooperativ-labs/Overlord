import { format, parseISO } from 'date-fns';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentModelChooser } from '@/components/AgentModelChooser';
import {
  DocumentAttachmentsSection,
  type DocumentItem,
  type PickedFile
} from '@/components/DocumentAttachmentsSection';
import { createAssignedAgent, DEFAULT_AGENT_MODEL_SELECTION } from '@/lib/agent-models';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import { useSelectedProject } from '@/lib/selected-project-context';
import { getSupabase } from '@/lib/supabase';
import type { AgentModelSelection, TicketExecutionTarget } from '@/lib/types';

const glassAvailable = Platform.OS === 'ios' && isLiquidGlassAvailable();

type ProjectRecord = {
  id: string;
  name: string;
  color: string;
  organization_id: number;
};

type CollapsibleSectionProps = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
};

function CollapsibleSection({ title, icon, children, colors, styles }: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const rotateAnim = useRef(new Animated.Value(0)).current;

  function toggle() {
    const toValue = expanded ? 0 : 1;
    setExpanded(!expanded);
    Animated.spring(rotateAnim, {
      toValue,
      useNativeDriver: true,
      tension: 120,
      friction: 10
    }).start();
  }

  const chevronRotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg']
  });

  return (
    <View style={styles.collapsibleSection}>
      <Pressable
        style={({ pressed }) => [styles.collapsibleHeader, pressed && { opacity: 0.75 }]}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={styles.collapsibleHeaderLeft}>
          <Ionicons name={icon} size={16} color={colors.mutedForeground} />
          <Text style={styles.collapsibleTitle}>{title}</Text>
        </View>
        <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
          <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
        </Animated.View>
      </Pressable>
      {expanded ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

export default function CreateTicketScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const { projectId: projectIdParam, dueDate: dueDateParam } = useLocalSearchParams<{
    projectId?: string;
    dueDate?: string;
  }>();
  const { selectedProjectId: contextSelectedProjectId } = useSelectedProject();

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [agentSelection, setAgentSelection] = useState<AgentModelSelection | null>(null);
  const [resolvedAgentSelection, setResolvedAgentSelection] = useState<AgentModelSelection>(
    DEFAULT_AGENT_MODEL_SELECTION
  );
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [objective, setObjective] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [availableTools, setAvailableTools] = useState('');
  const [executionTarget] = useState<TicketExecutionTarget>('agent');
  const [pendingDocuments, setPendingDocuments] = useState<(PickedFile & DocumentItem)[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const dueDateKey =
    typeof dueDateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDateParam)
      ? dueDateParam
      : null;
  const dueDateLabel = dueDateKey
    ? format(parseISO(`${dueDateKey}T12:00:00.000Z`), 'EEEE, MMM d')
    : null;

  useEffect(() => {
    let cancelled = false;
    setLoadingProjects(true);
    void (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, color, organization_id')
        .order('name', { ascending: true });
      if (cancelled) return;
      if (!error && data) {
        setProjects(data as ProjectRecord[]);
        const preferredId =
          (projectIdParam && data.some(p => p.id === projectIdParam) && projectIdParam) ||
          (contextSelectedProjectId &&
            data.some(p => p.id === contextSelectedProjectId) &&
            contextSelectedProjectId) ||
          data[0]?.id ||
          null;
        setProjectId(preferredId);
      }
      setLoadingProjects(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectIdParam, contextSelectedProjectId]);

  const selectedProject = projects.find(p => p.id === projectId) ?? null;
  const canSubmit = objective.trim().length > 0 && !!selectedProject && !submitting;

  function closeProjectMenu() {
    setShowProjectMenu(false);
  }

  function closeAgentMenu() {
    setShowAgentMenu(false);
  }

  function toggleProjectMenu() {
    if (showProjectMenu) {
      closeProjectMenu();
    } else {
      closeAgentMenu();
      setShowProjectMenu(true);
    }
  }

  async function handleSubmit() {
    const trimmedObjective = objective.trim();
    if (!trimmedObjective || !selectedProject) return;

    setSubmitting(true);
    try {
      const supabase = getSupabase();
      const title =
        trimmedObjective.length > 80 ? trimmedObjective.substring(0, 77) + '...' : trimmedObjective;
      const selection = agentSelection ?? resolvedAgentSelection;
      const dueDatetime = dueDateKey ? `${dueDateKey}T12:00:00.000Z` : null;

      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          title,
          status: 'draft',
          priority: 'medium',
          execution_target: executionTarget,
          organization_id: selectedProject.organization_id,
          project_id: selectedProject.id,
          due_datetime: dueDatetime,
          acceptance_criteria:
            acceptanceCriteria.trim().length > 0 ? acceptanceCriteria.trim() : null,
          available_tools: availableTools.trim().length > 0 ? availableTools.trim() : '',
          assigned_agent: createAssignedAgent(selection)
        })
        .select('id')
        .single();

      if (ticketError || !ticket) {
        throw new Error(ticketError?.message ?? 'Failed to create ticket.');
      }

      await supabase.from('objectives').insert({
        ticket_id: ticket.id,
        objective: trimmedObjective,
        state: 'draft'
      });

      await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Ticket created from mobile.',
        ticket_id: ticket.id
      });

      for (const doc of pendingDocuments) {
        const storagePath = `${selectedProject.organization_id}/${selectedProject.id}/${ticket.id}/${Date.now()}-${doc.fileName}`;
        const response = await fetch(doc.uri);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const { error: uploadError } = await supabase.storage
          .from('artifacts')
          .upload(storagePath, buffer, { contentType: doc.mimeType, upsert: false });
        if (uploadError) continue;
        await supabase.from('artifacts').insert({
          ticket_id: ticket.id,
          artifact_type: doc.mimeType.startsWith('image/') ? 'image' : 'document',
          label: doc.fileName,
          storage_path: storagePath,
          metadata: { size: doc.fileSize, type: doc.mimeType, fileName: doc.fileName }
        });
      }

      router.back();
    } catch (err) {
      Alert.alert(
        'Failed to create ticket',
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const InnerSurface = glassAvailable ? GlassView : View;
  const innerSurfaceProps = glassAvailable
    ? { glassEffectStyle: 'regular' as const, style: styles.surface }
    : { style: [styles.surface, styles.surfaceFallback] };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'New Ticket',
          headerShown: true,
          headerBackTitle: 'Cancel',
          headerStyle: { backgroundColor: glassAvailable ? 'transparent' : colors.background },
          headerTransparent: glassAvailable,
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
                <Text style={styles.headerSubmit}>Create</Text>
              )}
            </Pressable>
          )
        }}
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={100}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 }
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <InnerSurface {...innerSurfaceProps}>
            <TextInput
              style={styles.objectiveInput}
              value={objective}
              onChangeText={setObjective}
              placeholder="What needs to be done?"
              placeholderTextColor={colors.mutedForeground}
              multiline
              autoFocus
              textAlignVertical="top"
            />

            <View style={styles.chooserStack}>
              <Pressable
                style={({ pressed }) => [
                  styles.dropdownButton,
                  pressed && styles.dropdownButtonPressed
                ]}
                onPress={toggleProjectMenu}
                disabled={loadingProjects}
                accessibilityLabel="Choose project"
              >
                <View style={styles.dropdownButtonIcon}>
                  {selectedProject ? (
                    <View
                      style={[styles.projectDotLarge, { backgroundColor: selectedProject.color }]}
                    />
                  ) : (
                    <Ionicons name="folder-outline" size={18} color={colors.foreground} />
                  )}
                </View>
                <View style={styles.dropdownButtonTextWrap}>
                  <Text style={styles.dropdownButtonLabel} numberOfLines={1}>
                    {loadingProjects ? 'Loading…' : (selectedProject?.name ?? 'Select project')}
                  </Text>
                  <Text style={styles.dropdownButtonMeta}>Project</Text>
                </View>
                <Ionicons
                  name={showProjectMenu ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.mutedForeground}
                />
              </Pressable>

              {showProjectMenu ? (
                <View style={styles.dropdownPanel}>
                  {projects.map(project => {
                    const isSelected = project.id === projectId;
                    return (
                      <Pressable
                        key={project.id}
                        style={styles.menuItem}
                        onPress={() => {
                          setProjectId(project.id);
                          closeProjectMenu();
                        }}
                      >
                        <View style={styles.menuItemLeft}>
                          <View style={[styles.projectDot, { backgroundColor: project.color }]} />
                          <Text style={styles.menuItemText}>{project.name}</Text>
                        </View>
                        {isSelected ? (
                          <Ionicons name="checkmark" size={16} color={colors.primary} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <AgentModelChooser
                value={agentSelection}
                onChange={setAgentSelection}
                onResolvedSelectionChange={setResolvedAgentSelection}
                expanded={showAgentMenu}
                onExpandedChange={expanded => {
                  if (expanded) closeProjectMenu();
                  setShowAgentMenu(expanded);
                }}
                disabled={submitting}
              />
            </View>

            {/* Collapsed sections */}
            <View style={styles.collapsibleStack}>
              <CollapsibleSection
                title="Acceptance Criteria"
                icon="checkmark-circle-outline"
                colors={colors}
                styles={styles}
              >
                <TextInput
                  style={styles.sectionInput}
                  value={acceptanceCriteria}
                  onChangeText={setAcceptanceCriteria}
                  placeholder="Define when this ticket is complete..."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  textAlignVertical="top"
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="Tools"
                icon="build-outline"
                colors={colors}
                styles={styles}
              >
                <TextInput
                  style={styles.sectionInput}
                  value={availableTools}
                  onChangeText={setAvailableTools}
                  placeholder="List tools the agent can use..."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  textAlignVertical="top"
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="Documents"
                icon="document-text-outline"
                colors={colors}
                styles={styles}
              >
                <DocumentAttachmentsSection
                  documents={pendingDocuments}
                  onPickFile={file => {
                    const id = `pending-${Date.now()}`;
                    setPendingDocuments(prev => [...prev, { ...file, id, label: file.fileName }]);
                  }}
                  onRemove={id => setPendingDocuments(prev => prev.filter(d => d.id !== id))}
                />
              </CollapsibleSection>
            </View>

            {dueDateLabel ? (
              <View style={styles.dueDateRow}>
                <Ionicons name="calendar-outline" size={15} color={colors.primary} />
                <Text style={styles.dueDateText}>{dueDateLabel}</Text>
              </View>
            ) : null}
          </InnerSurface>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: glassAvailable ? 'transparent' : colors.background
    },
    scrollView: {
      flex: 1
    },
    scrollContent: {
      paddingHorizontal: 12,
      paddingTop: 12,
      gap: 10
    },
    surface: {
      borderRadius: 24,
      overflow: 'hidden',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 16
    },
    surfaceFallback: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    objectiveInput: {
      backgroundColor: glassAvailable ? 'rgba(255,255,255,0.08)' : colors.background,
      borderRadius: 14,
      borderWidth: glassAvailable ? 0 : 1,
      borderColor: colors.border,
      padding: 14,
      color: colors.foreground,
      fontSize: 17,
      lineHeight: 24,
      minHeight: 160,
      marginBottom: 10
    },
    chooserStack: {
      gap: 8
    },
    dropdownButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 12,
      borderRadius: 12,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)'
    },
    dropdownButtonPressed: {
      opacity: 0.85
    },
    dropdownButtonIcon: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
    },
    dropdownButtonTextWrap: {
      flex: 1,
      minWidth: 0
    },
    dropdownButtonLabel: {
      color: colors.foreground,
      fontSize: 15,
      fontWeight: '600'
    },
    dropdownButtonMeta: {
      color: colors.mutedForeground,
      fontSize: 12,
      marginTop: 2
    },
    projectDot: {
      width: 10,
      height: 10,
      borderRadius: 5
    },
    projectDotLarge: {
      width: 12,
      height: 12,
      borderRadius: 6
    },
    dropdownPanel: {
      backgroundColor: glassAvailable ? 'rgba(255,255,255,0.06)' : colors.background,
      borderRadius: 12,
      borderWidth: glassAvailable ? 0 : 1,
      borderColor: colors.border,
      overflow: 'hidden'
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    menuItemLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    menuItemText: {
      color: colors.foreground,
      fontSize: 14
    },
    collapsibleStack: {
      marginTop: 10,
      gap: 1,
      borderRadius: 14,
      overflow: 'hidden'
    },
    collapsibleSection: {
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
    },
    collapsibleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 13
    },
    collapsibleHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    collapsibleTitle: {
      color: colors.foreground,
      fontSize: 14,
      fontWeight: '600'
    },
    collapsibleBody: {
      paddingHorizontal: 14,
      paddingBottom: 14
    },
    sectionInput: {
      backgroundColor: glassAvailable ? 'rgba(255,255,255,0.08)' : colors.background,
      borderRadius: 10,
      borderWidth: glassAvailable ? 0 : 1,
      borderColor: colors.border,
      padding: 12,
      color: colors.foreground,
      fontSize: 15,
      lineHeight: 22,
      minHeight: 90
    },
    dueDateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 12,
      paddingHorizontal: 4
    },
    dueDateText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '500'
    },
    headerSubmit: {
      color: colors.primary,
      fontSize: 17,
      fontWeight: '600'
    }
  });
