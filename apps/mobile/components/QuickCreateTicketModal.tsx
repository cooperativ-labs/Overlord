import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { AgentBrandIcon } from '@/components/AgentBrandIcon';
import { AGENT_OPTIONS, createAssignedAgent } from '@/lib/agent-models';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { useSelectedProject } from '@/lib/selected-project-context';
import { getSupabase } from '@/lib/supabase';
import type { AgentModelSelection, LaunchAgentType } from '@/lib/types';

const glassAvailable = Platform.OS === 'ios' && isLiquidGlassAvailable();

type ProjectRecord = {
  id: string;
  name: string;
  color: string;
  organization_id: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function QuickCreateTicketModal({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { selectedProjectId } = useSelectedProject();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [agent, setAgent] = useState<LaunchAgentType>('claude');
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [objective, setObjective] = useState('');
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
  }, [visible, selectedProjectId]);

  useEffect(() => {
    if (!visible) {
      setObjective('');
      setShowProjectMenu(false);
      setShowAgentMenu(false);
    }
  }, [visible]);

  const selectedProject = projects.find(p => p.id === projectId) ?? null;
  const selectedAgent = AGENT_OPTIONS.find(o => o.value === agent) ?? AGENT_OPTIONS[0];
  const canSubmit = objective.trim().length > 0 && !!selectedProject && !submitting;
  const cardMaxHeight = Math.min(windowHeight - insets.top - 12, windowHeight * 0.9);

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

  function toggleAgentMenu() {
    if (showAgentMenu) {
      closeAgentMenu();
    } else {
      closeProjectMenu();
      setShowAgentMenu(true);
    }
  }

  async function handleSubmit() {
    const trimmed = objective.trim();
    if (!trimmed || !selectedProject) return;
    setSubmitting(true);
    try {
      const supabase = getSupabase();
      const title = trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed;
      const selection: AgentModelSelection = { agent, model: null, thinking: null };

      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          title,
          status: 'draft',
          priority: 'medium',
          organization_id: selectedProject.organization_id,
          project_id: selectedProject.id,
          assigned_agent: createAssignedAgent(selection)
        })
        .select('id')
        .single();

      if (ticketError || !ticket) {
        throw new Error(ticketError?.message ?? 'Failed to create ticket.');
      }

      await supabase.from('objectives').insert({
        ticket_id: ticket.id,
        objective: trimmed,
        state: 'draft'
      });

      await supabase.from('ticket_events').insert({
        event_type: 'system',
        summary: 'Ticket created from mobile.',
        ticket_id: ticket.id
      });

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
    ? { glassEffectStyle: 'regular' as const, style: styles.card }
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
            keyboardVerticalOffset={Math.max(insets.bottom, 10)}
            pointerEvents="box-none"
          >
            <Pressable
              style={[styles.cardWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}
              onPress={() => {}}
            >
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
                              style={[
                                styles.projectDotLarge,
                                { backgroundColor: selectedProject.color }
                              ]}
                            />
                          ) : (
                            <Ionicons name="folder-outline" size={18} color={colors.foreground} />
                          )}
                        </View>
                        <View style={styles.dropdownButtonTextWrap}>
                          <Text style={styles.dropdownButtonLabel} numberOfLines={1}>
                            {loadingProjects
                              ? 'Loading projects…'
                              : (selectedProject?.name ?? 'Select project')}
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
                                  <View
                                    style={[styles.projectDot, { backgroundColor: project.color }]}
                                  />
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

                      <Pressable
                        style={({ pressed }) => [
                          styles.dropdownButton,
                          pressed && styles.dropdownButtonPressed
                        ]}
                        onPress={toggleAgentMenu}
                        accessibilityLabel="Choose agent"
                      >
                        <View style={styles.dropdownButtonIcon}>
                          <AgentBrandIcon agent={selectedAgent.value} size={18} />
                        </View>
                        <View style={styles.dropdownButtonTextWrap}>
                          <Text style={styles.dropdownButtonLabel} numberOfLines={1}>
                            {selectedAgent.label}
                          </Text>
                          <Text style={styles.dropdownButtonMeta}>Assigned agent</Text>
                        </View>
                        <Ionicons
                          name={showAgentMenu ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={colors.mutedForeground}
                        />
                      </Pressable>

                      {showAgentMenu ? (
                        <View style={styles.dropdownPanel}>
                          {AGENT_OPTIONS.map(option => {
                            const isSelected = option.value === agent;
                            return (
                              <Pressable
                                key={option.value}
                                style={styles.menuItem}
                                onPress={() => {
                                  setAgent(option.value);
                                  closeAgentMenu();
                                }}
                              >
                                <View style={styles.menuItemLeft}>
                                  <AgentBrandIcon agent={option.value} size={16} />
                                  <Text style={styles.menuItemText}>{option.label}</Text>
                                </View>
                                {isSelected ? (
                                  <Ionicons name="checkmark" size={16} color={colors.primary} />
                                ) : null}
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
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
      backgroundColor: glassAvailable ? 'rgba(255,255,255,0.08)' : colors.background,
      borderRadius: 14,
      borderWidth: glassAvailable ? 0 : 1,
      borderColor: colors.border,
      padding: 14,
      color: colors.foreground,
      fontSize: 17,
      lineHeight: 24,
      minHeight: 160
    },
    chooserStack: {
      gap: 10
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
