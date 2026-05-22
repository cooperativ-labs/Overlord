import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DocumentAttachmentsSection,
  type DocumentItem,
  type PickedFile
} from '@/components/DocumentAttachmentsSection';
import { ProjectAgentSelector } from '@/components/ProjectAgentSelector';
import { createAssignedAgent, DEFAULT_AGENT_MODEL_SELECTION } from '@/lib/agent-models';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import { useSelectedProject } from '@/lib/selected-project-context';
import { getSupabase } from '@/lib/supabase';
import type { AgentModelSelection } from '@/lib/types';

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

type Props = {
  visible: boolean;
  onClose: () => void;
  defaultProjectId?: string | null;
};

export function QuickCreateTicketModal({ visible, onClose, defaultProjectId }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { selectedProjectId } = useSelectedProject();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [openSelectorPanel, setOpenSelectorPanel] = useState<'agent' | 'project' | null>(null);
  const [agentSelection, setAgentSelection] = useState<AgentModelSelection | null>(null);
  const [resolvedAgentSelection, setResolvedAgentSelection] = useState<AgentModelSelection>(
    DEFAULT_AGENT_MODEL_SELECTION
  );
  const [objective, setObjective] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [availableTools, setAvailableTools] = useState('');
  const [pendingDocuments, setPendingDocuments] = useState<(PickedFile & DocumentItem)[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
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
        setProjectId(prev => {
          if (prev && data.some(p => p.id === prev)) return prev;
          if (defaultProjectId && data.some(p => p.id === defaultProjectId)) {
            return defaultProjectId;
          }
          if (selectedProjectId && data.some(p => p.id === selectedProjectId)) {
            return selectedProjectId;
          }
          return data[0]?.id ?? null;
        });
      }
      setLoadingProjects(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, selectedProjectId, defaultProjectId]);

  useEffect(() => {
    if (!visible) {
      setObjective('');
      setAcceptanceCriteria('');
      setAvailableTools('');
      setPendingDocuments([]);
      setOpenSelectorPanel(null);
    }
  }, [visible]);

  const selectedProject = projects.find(p => p.id === projectId) ?? null;
  const canSubmit = objective.trim().length > 0 && !!selectedProject && !submitting;
  const cardMaxHeight = Math.min(windowHeight - insets.top - 12, windowHeight * 0.9);

  async function handleSubmit() {
    const trimmed = objective.trim();
    if (!trimmed || !selectedProject) return;
    setSubmitting(true);
    try {
      const supabase = getSupabase();
      const title = trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed;
      const selection = agentSelection ?? resolvedAgentSelection;

      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          title,
          status: 'draft',
          priority: 'medium',
          execution_target: 'agent',
          organization_id: selectedProject.organization_id,
          project_id: selectedProject.id,
          acceptance_criteria:
            acceptanceCriteria.trim().length > 0 ? acceptanceCriteria.trim() : null,
          available_tools: availableTools.trim().length > 0 ? availableTools.trim() : ''
        })
        .select('id')
        .single();

      if (ticketError || !ticket) {
        throw new Error(ticketError?.message ?? 'Failed to create ticket.');
      }

      const { data: objective, error: objectiveError } = await supabase
        .from('objectives')
        .insert({
          ticket_id: ticket.id,
          objective: trimmed,
          state: 'draft',
          assigned_agent: createAssignedAgent(selection)
        })
        .select('id')
        .single();

      if (objectiveError || !objective) {
        throw new Error(objectiveError?.message ?? 'Failed to create objective.');
      }

      await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Ticket created from mobile.',
        ticket_id: ticket.id,
        objective_id: objective.id
      });

      for (const doc of pendingDocuments) {
        const storagePath = `${selectedProject.organization_id}/${selectedProject.id}/${ticket.id}/${objective.id}/${Date.now()}-${doc.fileName}`;
        const response = await fetch(doc.uri);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const { error: uploadError } = await supabase.storage
          .from('artifacts')
          .upload(storagePath, buffer, { contentType: doc.mimeType, upsert: false });
        if (uploadError) continue;
        await supabase.from('objective_attachments').insert({
          objective_id: objective.id,
          ticket_id: ticket.id,
          content_type: doc.mimeType,
          file_size: doc.fileSize,
          label: doc.fileName,
          storage_path: storagePath,
          metadata: { size: doc.fileSize, type: doc.mimeType, fileName: doc.fileName }
        });
      }

      onClose();
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
    ? {
        glassEffectStyle: 'regular' as const,
        style: styles.card,
        colorScheme: (colors.isDark ? 'dark' : 'light') as 'dark' | 'light'
      }
    : { style: [styles.card, styles.cardFallback] };

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.avoider}
            keyboardVerticalOffset={Math.min(insets.bottom, 10)}
            pointerEvents="box-none"
          >
            <Pressable style={[styles.cardWrap]} onPress={() => {}}>
              <InnerSurface {...innerSurfaceProps}>
                <View style={[styles.cardSize, { maxHeight: cardMaxHeight }]}>
                  <View style={styles.handleBar} />

                  <View style={styles.headerRow}>
                    <Text style={styles.headerTitle}>New ticket</Text>
                    <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                      <Ionicons name="close" size={22} color={colors.foreground} />
                    </Pressable>
                  </View>

                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.scrollContent}
                    bounces={false}
                  >
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

                    <ProjectAgentSelector
                      openPanel={openSelectorPanel}
                      onOpenPanelChange={setOpenSelectorPanel}
                      project={{
                        options: projects,
                        value: projectId,
                        loading: loadingProjects,
                        disabled: submitting,
                        onChange: setProjectId
                      }}
                      agent={{
                        value: agentSelection,
                        onChange: setAgentSelection,
                        onResolvedSelectionChange: setResolvedAgentSelection,
                        disabled: submitting
                      }}
                    />

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
                            setPendingDocuments(prev => [
                              ...prev,
                              { ...file, id, label: file.fileName }
                            ]);
                          }}
                          onRemove={id =>
                            setPendingDocuments(prev => prev.filter(d => d.id !== id))
                          }
                        />
                      </CollapsibleSection>
                    </View>
                  </ScrollView>

                  <View style={styles.footer}>
                    <Pressable onPress={onClose} style={styles.cancelButton} disabled={submitting}>
                      <Text style={styles.cancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleSubmit}
                      disabled={!canSubmit}
                      style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
                    >
                      {submitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="arrow-up" size={16} color="#fff" />
                          <Text style={styles.submitText}>Create</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </View>
              </InnerSurface>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end'
    },
    avoider: {
      width: '100%'
    },
    cardWrap: {
      paddingHorizontal: 10,
      paddingBottom: 10
    },
    card: {
      borderRadius: 24,
      overflow: 'hidden',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 12
    },
    cardSize: {
      flexShrink: 1
    },
    cardFallback: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    handleBar: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.mutedForeground,
      opacity: 0.4,
      marginBottom: 6
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8
    },
    headerTitle: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: '700'
    },
    scrollContent: {
      gap: 10,
      paddingBottom: 4
    },
    objectiveInput: {
      backgroundColor: glassAvailable
        ? colors.isDark
          ? 'rgba(255,255,255,0.08)'
          : 'rgba(0,0,0,0.06)'
        : colors.secondary,
      borderRadius: 14,
      borderWidth: glassAvailable ? 0 : 1,
      borderColor: colors.border,
      padding: 14,
      color: colors.foreground,
      fontSize: 17,
      lineHeight: 24,
      minHeight: 120
    },
    collapsibleStack: {
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
      paddingVertical: 10
    },
    collapsibleHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8
    },
    collapsibleTitle: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: '600'
    },
    collapsibleBody: {
      paddingHorizontal: 14,
      paddingBottom: 14
    },
    sectionInput: {
      backgroundColor: glassAvailable
        ? colors.isDark
          ? 'rgba(255,255,255,0.08)'
          : 'rgba(0,0,0,0.04)'
        : colors.secondary,
      borderRadius: 10,
      borderWidth: glassAvailable ? 0 : 1,
      borderColor: colors.border,
      padding: 12,
      color: colors.foreground,
      fontSize: 14,
      lineHeight: 20,
      minHeight: 80
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 10
    },
    cancelButton: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12
    },
    cancelText: {
      color: colors.mutedForeground,
      fontSize: 15,
      fontWeight: '500'
    },
    submitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.primary
    },
    submitButtonDisabled: {
      opacity: 0.4
    },
    submitText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600'
    }
  });
