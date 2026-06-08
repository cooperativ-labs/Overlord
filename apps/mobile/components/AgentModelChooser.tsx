import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle
} from 'react-native';

import { AgentBrandIcon } from '@/components/AgentBrandIcon';
import { AgentLaunchFooter } from '@/components/AgentLaunchFooter';
import {
  type AgentUserConfig,
  DEFAULT_AGENT_MODEL_SELECTION,
  getAgentThinkingLabel,
  getVisibleBuiltInAgents,
  getVisibleModelsForAgent,
  normalizeAgentModels,
  normalizeLaunchPreference,
  normalizeUserAgentConfigs,
  resolveAgentModelSelection,
  supportsBuiltInThinkingSelection
} from '@/lib/agent-models';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { useExecutionTargets } from '@/lib/execution-targets-context';
import { Ionicons } from '@/lib/icons';
import { getSupabase } from '@/lib/supabase';
import type {
  AgentLaunchConfig,
  AgentLaunchConfigUpdate,
  AgentModelRecord,
  AgentModelSelection,
  LaunchAgentType
} from '@/lib/types';

type AgentModelChooserProps = {
  alwaysExpanded?: boolean;
  accessibilityLabel?: string;
  disabled?: boolean;
  expanded?: boolean;
  helperText?: string;
  onChange: (selection: AgentModelSelection) => void;
  onExpandedChange?: (expanded: boolean) => void;
  onResolvedSelectionChange?: (selection: AgentModelSelection) => void;
  style?: StyleProp<ViewStyle>;
  triggerMetaLabel?: string;
  value: AgentModelSelection | null;
  /**
   * Per-objective launch config override to seed the AgentLaunchFooter with.
   * `null` (with an `onLaunchConfigOverrideChange` handler present) means no
   * override yet, so the footer seeds from the selected target's config as the
   * inherited default. Only meaningful together with
   * `onLaunchConfigOverrideChange`.
   */
  launchConfigOverride?: AgentLaunchConfig | null;
  /**
   * When provided, the AgentLaunchFooter edits a per-objective override (routed
   * here) instead of the app-wide selected target's config. The footer still
   * seeds from the target config when there is no override.
   */
  onLaunchConfigOverrideChange?: (update: AgentLaunchConfigUpdate) => void;
};

export function AgentModelChooser({
  alwaysExpanded = false,
  accessibilityLabel = 'Choose agent model',
  disabled = false,
  expanded,
  helperText,
  onChange,
  onExpandedChange,
  onResolvedSelectionChange,
  style,
  triggerMetaLabel,
  value,
  launchConfigOverride = null,
  onLaunchConfigOverrideChange
}: AgentModelChooserProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const { selectedTarget, updateTargetAgentConfig } = useExecutionTargets();
  const [models, setModels] = useState<AgentModelRecord[]>([]);
  const [userConfigs, setUserConfigs] = useState<Record<string, AgentUserConfig>>({});
  const [resolvedSelection, setResolvedSelection] = useState<AgentModelSelection>(
    DEFAULT_AGENT_MODEL_SELECTION
  );
  const [loading, setLoading] = useState(true);
  const [showSelector, setShowSelector] = useState(alwaysExpanded);

  useEffect(() => {
    let cancelled = false;

    async function loadChooserState() {
      try {
        const supabase = getSupabase();
        const { data: modelRows, error: modelError } = await supabase
          .from('agent_models')
          .select(
            'id, agent_type, model_id, display_name, thinking_options, is_offered, is_recommended, sort_order, updated_at'
          )
          .order('sort_order', { ascending: true })
          .order('is_recommended', { ascending: false });

        if (modelError) {
          throw new Error(modelError.message);
        }

        const normalizedModels = normalizeAgentModels(
          (modelRows ?? []) as unknown as Record<string, unknown>[]
        );

        const {
          data: { user }
        } = await supabase.auth.getUser();

        let normalizedConfigs: Record<string, AgentUserConfig> = {};
        let nextSelection = DEFAULT_AGENT_MODEL_SELECTION;

        if (user) {
          const [configRes, preferenceRes] = await Promise.all([
            supabase.from('user_agent_configs').select('agent_type, config').eq('user_id', user.id),
            supabase
              .from('user_launch_preferences')
              .select('agent_type, model_id, thinking')
              .eq('user_id', user.id)
              .maybeSingle()
          ]);

          if (configRes.error) {
            throw new Error(configRes.error.message);
          }

          if (preferenceRes.error) {
            throw new Error(preferenceRes.error.message);
          }

          normalizedConfigs = normalizeUserAgentConfigs(configRes.data ?? []);
          nextSelection = resolveAgentModelSelection(
            normalizedConfigs,
            normalizeLaunchPreference(preferenceRes.data)
          );
        }

        if (!cancelled) {
          setModels(normalizedModels);
          setUserConfigs(normalizedConfigs);
          setResolvedSelection(nextSelection);
        }
      } catch (error) {
        console.error('Failed to load agent chooser state:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadChooserState();

    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveSelection = value ?? resolvedSelection;

  useEffect(() => {
    onResolvedSelectionChange?.(effectiveSelection);
  }, [effectiveSelection, onResolvedSelectionChange]);

  const modelsByAgent = useMemo(() => {
    return models.reduce(
      (acc, model) => {
        if (!acc[model.agent_type]) {
          acc[model.agent_type] = [];
        }
        acc[model.agent_type].push(model);
        return acc;
      },
      {} as Record<LaunchAgentType, AgentModelRecord[]>
    );
  }, [models]);

  const visibleBuiltInAgents = useMemo(
    () =>
      getVisibleBuiltInAgents({
        configs: userConfigs,
        selectedAgent: effectiveSelection.agent
      }),
    [effectiveSelection.agent, userConfigs]
  );

  const antigravityManagesModels = effectiveSelection.agent === 'antigravity';
  const currentModels = antigravityManagesModels
    ? []
    : getVisibleModelsForAgent({
        models: modelsByAgent[effectiveSelection.agent] ?? [],
        agent: effectiveSelection.agent,
        configs: userConfigs
      });
  const selectedModel = currentModels.find(model => model.model_id === effectiveSelection.model);
  const thinkingEnabled = supportsBuiltInThinkingSelection(
    effectiveSelection.agent,
    antigravityManagesModels
  );
  const thinkingOptions =
    thinkingEnabled && effectiveSelection.model === 'auto'
      ? []
      : thinkingEnabled
        ? (selectedModel?.thinking_options ?? [])
        : [];
  const selectedAgentOption = visibleBuiltInAgents.find(
    option => option.value === effectiveSelection.agent
  );
  const isSelectorVisible = alwaysExpanded || (expanded ?? showSelector);
  const selectedModelLabel = antigravityManagesModels
    ? 'Antigravity default'
    : effectiveSelection.model === 'auto'
      ? 'Auto'
      : (selectedModel?.display_name ?? 'Default model');
  const selectedThinkingLabel = effectiveSelection.thinking
    ? ` · ${effectiveSelection.thinking}`
    : '';

  // Launch defaults (pre-command + flags) are sourced from the app-wide selected
  // execution target's per-agent config — the same data the Servers tab shows
  // and the ovld runner reads — so the agent config settings apply consistently
  // across the app rather than from a separate global config.
  const currentTargetAgentConfig = selectedTarget?.agentFlags[effectiveSelection.agent] ?? null;
  const currentAgentFlags = currentTargetAgentConfig?.flags ?? [];
  const currentAgentPreCommand = currentTargetAgentConfig?.preCommand ?? '';

  // Override mode: the footer edits a per-objective override of the target
  // config instead of the target config itself. When an override exists, seed
  // from it verbatim (an empty override means "none for this objective" and must
  // not fall back to the target default); when it does not, seed from the target
  // config so the user sees what they would inherit before editing.
  const overrideMode = Boolean(onLaunchConfigOverrideChange);
  const footerPreCommand =
    overrideMode && launchConfigOverride
      ? (launchConfigOverride.preCommand ?? '')
      : currentAgentPreCommand;
  const footerFlags =
    overrideMode && launchConfigOverride ? launchConfigOverride.flags : currentAgentFlags;

  function setSelectorVisible(nextVisible: boolean) {
    if (!alwaysExpanded && expanded === undefined) {
      setShowSelector(nextVisible);
    }
    onExpandedChange?.(nextVisible);
  }

  return (
    <View style={[styles.container, style]}>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}

      {!alwaysExpanded ? (
        <Pressable
          disabled={disabled}
          onPress={() => setSelectorVisible(!isSelectorVisible)}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ expanded: isSelectorVisible, disabled }}
          style={({ pressed }) => [
            styles.selectorButton,
            disabled && styles.selectorButtonDisabled,
            pressed && !disabled && styles.selectorButtonPressed
          ]}
        >
          <View style={styles.selectorButtonLeft}>
            {selectedAgentOption ? (
              <AgentBrandIcon agent={selectedAgentOption.value} size={16} />
            ) : (
              <Ionicons name="hardware-chip-outline" size={16} color={colors.foreground} />
            )}
            <View style={styles.selectorButtonTextWrap}>
              <Text style={styles.selectorButtonTitle} numberOfLines={1}>
                {selectedAgentOption?.label ?? 'Agent'}
              </Text>
              <Text style={styles.selectorButtonMeta} numberOfLines={1}>
                {triggerMetaLabel ?? `${selectedModelLabel}${selectedThinkingLabel}`}
              </Text>
            </View>
          </View>
          {loading ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : (
            <Ionicons
              name={isSelectorVisible ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.mutedForeground}
            />
          )}
        </Pressable>
      ) : null}

      {isSelectorVisible ? (
        <View style={styles.selectorPanel}>
          <Text style={styles.groupLabel}>Agent</Text>
          <View style={styles.chipWrap}>
            {visibleBuiltInAgents.map(option => {
              const selected = effectiveSelection.agent === option.value;
              return (
                <Pressable
                  key={option.value}
                  disabled={disabled}
                  onPress={() => onChange({ agent: option.value, model: null, thinking: null })}
                  style={({ pressed }) => [
                    styles.choiceChip,
                    selected && styles.choiceChipSelected,
                    disabled && styles.choiceChipDisabled,
                    pressed && !disabled && styles.choiceChipPressed
                  ]}
                >
                  <AgentBrandIcon agent={option.value} size={14} />
                  <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.groupLabel}>Model</Text>
          {antigravityManagesModels ? (
            <Text style={styles.emptyText}>Antigravity chooses models in its own UI.</Text>
          ) : loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingText}>Loading available models...</Text>
            </View>
          ) : (
            <View style={styles.list}>
              <ModelChoice
                disabled={disabled}
                isSelected={effectiveSelection.model === null}
                label="Default model"
                onPress={() =>
                  onChange({
                    agent: effectiveSelection.agent,
                    model: null,
                    thinking: null
                  })
                }
              />
              {effectiveSelection.agent === 'cursor' ? (
                <ModelChoice
                  disabled={disabled}
                  isSelected={effectiveSelection.model === 'auto'}
                  label="Auto"
                  onPress={() =>
                    onChange({
                      agent: effectiveSelection.agent,
                      model: 'auto',
                      thinking: null
                    })
                  }
                />
              ) : null}
              {currentModels.map(model => (
                <ModelChoice
                  key={model.id}
                  disabled={disabled}
                  isSelected={effectiveSelection.model === model.model_id}
                  label={model.display_name}
                  onPress={() =>
                    onChange({
                      agent: effectiveSelection.agent,
                      model: model.model_id,
                      thinking: null
                    })
                  }
                />
              ))}
              {currentModels.length === 0 ? (
                <Text style={styles.emptyText}>No offered models available for this agent.</Text>
              ) : null}
            </View>
          )}

          {thinkingEnabled && thinkingOptions.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>
                {getAgentThinkingLabel(effectiveSelection.agent)}
              </Text>
              <View style={styles.chipWrap}>
                <Pressable
                  disabled={disabled}
                  onPress={() =>
                    onChange({
                      agent: effectiveSelection.agent,
                      model: effectiveSelection.model,
                      thinking: null
                    })
                  }
                  style={({ pressed }) => [
                    styles.choiceChip,
                    effectiveSelection.thinking === null && styles.choiceChipSelected,
                    disabled && styles.choiceChipDisabled,
                    pressed && !disabled && styles.choiceChipPressed
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceChipText,
                      effectiveSelection.thinking === null && styles.choiceChipTextSelected
                    ]}
                  >
                    Default
                  </Text>
                </Pressable>
                {thinkingOptions.map(option => {
                  const selected = effectiveSelection.thinking === option;
                  return (
                    <Pressable
                      key={option}
                      disabled={disabled}
                      onPress={() =>
                        onChange({
                          agent: effectiveSelection.agent,
                          model: effectiveSelection.model,
                          thinking: option
                        })
                      }
                      style={({ pressed }) => [
                        styles.choiceChip,
                        selected && styles.choiceChipSelected,
                        disabled && styles.choiceChipDisabled,
                        pressed && !disabled && styles.choiceChipPressed
                      ]}
                    >
                      <Text
                        style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}
                      >
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          <AgentLaunchFooter
            key={`${selectedTarget?.id ?? 'none'}:${effectiveSelection.agent}:${
              overrideMode ? (launchConfigOverride ? 'override-set' : 'override-unset') : 'target'
            }`}
            agentKey={effectiveSelection.agent}
            preCommand={footerPreCommand}
            flags={footerFlags}
            targetLabel={selectedTarget?.label ?? null}
            override={overrideMode}
            onChange={
              overrideMode
                ? onLaunchConfigOverrideChange
                : selectedTarget
                  ? update =>
                      void updateTargetAgentConfig(
                        selectedTarget.id,
                        effectiveSelection.agent,
                        update
                      )
                  : undefined
            }
            disabled={disabled || (!overrideMode && !selectedTarget)}
          />
        </View>
      ) : null}
    </View>
  );
}

function ModelChoice({
  disabled,
  isSelected,
  label,
  onPress
}: {
  disabled: boolean;
  isSelected: boolean;
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.listItem,
        isSelected && styles.listItemSelected,
        disabled && styles.listItemDisabled,
        pressed && !disabled && styles.listItemPressed
      ]}
    >
      <Text style={[styles.listItemText, isSelected && styles.listItemTextSelected]}>{label}</Text>
      <View style={styles.listItemMeta}>
        {isSelected ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
      </View>
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {},
    helperText: {
      color: colors.secondaryForeground,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 12
    },
    selectorButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginBottom: 6
    },
    selectorButtonPressed: {
      opacity: 0.85
    },
    selectorButtonDisabled: {
      opacity: 0.55
    },
    selectorButtonLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flexShrink: 1,
      minWidth: 0
    },
    selectorButtonTextWrap: {
      flexShrink: 1,
      minWidth: 0
    },
    selectorButtonTitle: {
      color: colors.foreground,
      fontSize: 15,
      fontWeight: '600'
    },
    selectorButtonMeta: {
      color: colors.mutedForeground,
      fontSize: 12,
      marginTop: 2
    },
    selectorPanel: {
      gap: 4,
      padding: 10,
      borderRadius: 12,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
    },
    groupLabel: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 10
    },
    choiceChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6
    },
    choiceChipSelected: {
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}20`
    },
    choiceChipPressed: {
      opacity: 0.8
    },
    choiceChipDisabled: {
      opacity: 0.55
    },
    choiceChipText: {
      color: colors.secondaryForeground,
      fontSize: 12,
      fontWeight: '600'
    },
    choiceChipTextSelected: {
      color: colors.foreground
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      marginBottom: 16
    },
    loadingText: {
      color: colors.mutedForeground,
      fontSize: 14
    },
    list: {
      marginBottom: 10
    },
    listItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.secondary,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginBottom: 4
    },
    listItemSelected: {
      borderColor: colors.primary,
      backgroundColor: `${colors.primary}18`
    },
    listItemPressed: {
      opacity: 0.85
    },
    listItemDisabled: {
      opacity: 0.55
    },
    listItemText: {
      color: colors.secondaryForeground,
      fontSize: 13,
      flexShrink: 1,
      paddingRight: 8
    },
    listItemTextSelected: {
      color: colors.foreground,
      fontWeight: '600'
    },
    listItemMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0
    },
    emptyText: {
      color: colors.mutedForeground,
      fontSize: 14,
      lineHeight: 20
    }
  });
