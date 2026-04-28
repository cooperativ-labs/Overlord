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
import { useThemeColors, useThemedStyles, type ThemeColors } from '@/lib/colors';
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
  const cardMinHeight = Math.min(cardMaxHeight, Math.max(420, windowHeight * 0.68));

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
          status: 'next-up',
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
              <View
                style={[styles.cardSize, { maxHeight: cardMaxHeight, minHeight: cardMinHeight }]}
              >
                <View style={styles.handleBar} />

                <View style={styles.headerRow}>
                  <Text style={styles.headerTitle}>New ticket</Text>
                  <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                    <Ionicons name="close" size={22} color={colors.foreground} />
                  </Pressable>
                </View>

                <ScrollView
                  style={styles.scroll}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.scrollContent}
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

                  <View style={styles.row}>
                    <Pressable
                      style={styles.chip}
                      onPress={() => {
                        setShowAgentMenu(false);
                        setShowProjectMenu(v => !v);
                      }}
                      disabled={loadingProjects}
                    >
                      {selectedProject ? (
                        <View
                          style={[styles.projectDot, { backgroundColor: selectedProject.color }]}
                        />
                      ) : (
                        <Ionicons name="folder-outline" size={14} color={colors.foreground} />
                      )}
                      <Text style={styles.chipText} numberOfLines={1}>
                        {loadingProjects
                          ? 'Loading…'
                          : (selectedProject?.name ?? 'Select project')}
                      </Text>
                      <Ionicons
                        name={showProjectMenu ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={colors.mutedForeground}
                      />
                    </Pressable>

                    <Pressable
                      style={styles.chip}
                      onPress={() => {
                        setShowProjectMenu(false);
                        setShowAgentMenu(v => !v);
                      }}
                    >
                      <AgentBrandIcon agent={selectedAgent.value} size={14} />
                      <Text style={styles.chipText}>{selectedAgent.label}</Text>
                      <Ionicons
                        name={showAgentMenu ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={colors.mutedForeground}
                      />
                    </Pressable>
                  </View>

                  {showProjectMenu && (
                    <View style={styles.menu}>
                      {projects.map(project => {
                        const isSelected = project.id === projectId;
                        return (
                          <Pressable
                            key={project.id}
                            style={styles.menuItem}
                            onPress={() => {
                              setProjectId(project.id);
                              setShowProjectMenu(false);
                            }}
                          >
                            <View style={styles.menuItemLeft}>
                              <View
                                style={[styles.projectDot, { backgroundColor: project.color }]}
                              />
                              <Text style={styles.menuItemText}>{project.name}</Text>
                            </View>
                            {isSelected && (
                              <Ionicons name="checkmark" size={16} color={colors.primary} />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {showAgentMenu && (
                    <View style={styles.menu}>
                      {AGENT_OPTIONS.map(option => {
                        const isSelected = option.value === agent;
                        return (
                          <Pressable
                            key={option.value}
                            style={styles.menuItem}
                            onPress={() => {
                              setAgent(option.value);
                              setShowAgentMenu(false);
                            }}
                          >
                            <View style={styles.menuItemLeft}>
                              <AgentBrandIcon agent={option.value} size={16} />
                              <Text style={styles.menuItemText}>{option.label}</Text>
                            </View>
                            {isSelected && (
                              <Ionicons name="checkmark" size={16} color={colors.primary} />
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
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
  scroll: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1,
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
    minHeight: 220
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: glassAvailable ? 'rgba(255,255,255,0.10)' : colors.background,
    borderWidth: glassAvailable ? 0 : 1,
    borderColor: colors.border,
    maxWidth: '100%'
  },
  chipText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: '500',
    maxWidth: 160
  },
  projectDot: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  menu: {
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
