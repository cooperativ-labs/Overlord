import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  AGENT_OPTIONS,
  DEFAULT_AGENT_MODEL_SELECTION,
  normalizeAgentModels,
  normalizeLaunchPreference,
  normalizeUserAgentConfigs,
  resolveAgentModelSelection
} from '@/lib/agent-models';
import { colors } from '@/lib/colors';
import { getSupabase } from '@/lib/supabase';
import type { AgentModelRecord, AgentModelSelection, LaunchAgentType } from '@/lib/types';

type AgentModelChooserProps = {
  disabled?: boolean;
  helperText?: string;
  onChange: (selection: AgentModelSelection) => void;
  onResolvedSelectionChange?: (selection: AgentModelSelection) => void;
  value: AgentModelSelection | null;
};

export function AgentModelChooser({
  disabled = false,
  helperText,
  onChange,
  onResolvedSelectionChange,
  value
}: AgentModelChooserProps) {
  const [models, setModels] = useState<AgentModelRecord[]>([]);
  const [resolvedSelection, setResolvedSelection] = useState<AgentModelSelection>(
    DEFAULT_AGENT_MODEL_SELECTION
  );
  const [loading, setLoading] = useState(true);
  const [showSelector, setShowSelector] = useState(false);

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

          nextSelection = resolveAgentModelSelection(
            normalizeUserAgentConfigs(configRes.data ?? []),
            normalizeLaunchPreference(preferenceRes.data)
          );
        }

        if (!cancelled) {
          setModels(normalizedModels);
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

  const currentModels = modelsByAgent[effectiveSelection.agent] ?? [];
  const selectedModel = currentModels.find(model => model.model_id === effectiveSelection.model);
  const showThinking = effectiveSelection.agent !== 'codex';
  const thinkingOptions = showThinking ? (selectedModel?.thinking_options ?? []) : [];
  const selectedAgentOption = AGENT_OPTIONS.find(
    option => option.value === effectiveSelection.agent
  );

  return (
    <View style={styles.container}>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}

      <Pressable
        disabled={disabled}
        onPress={() => setShowSelector(current => !current)}
        style={({ pressed }) => [
          styles.selectorButton,
          disabled && styles.selectorButtonDisabled,
          pressed && !disabled && styles.selectorButtonPressed
        ]}
      >
        <View style={styles.selectorButtonLeft}>
          <Ionicons
            name={
              (selectedAgentOption?.icon ??
                'hardware-chip-outline') as keyof typeof Ionicons.glyphMap
            }
            size={16}
            color={colors.foreground}
          />
          <View style={styles.selectorButtonTextWrap}>
            <Text style={styles.selectorButtonTitle}>{selectedAgentOption?.label ?? 'Agent'}</Text>
          </View>
        </View>
        <Ionicons
          name={showSelector ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.mutedForeground}
        />
      </Pressable>

      {showSelector ? (
        <View style={styles.selectorPanel}>
          <Text style={styles.groupLabel}>Agent</Text>
          <View style={styles.chipWrap}>
            {AGENT_OPTIONS.map(option => {
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
                  <Ionicons
                    name={option.icon as keyof typeof Ionicons.glyphMap}
                    size={14}
                    color={selected ? colors.foreground : colors.secondaryForeground}
                  />
                  <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.groupLabel}>Model</Text>
          {loading ? (
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

          {thinkingOptions.length > 0 ? (
            <>
              <Text style={styles.groupLabel}>Thinking</Text>
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

const styles = StyleSheet.create({
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
    gap: 10,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8
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
    fontSize: 13,
    fontWeight: '600'
  },
  selectorPanel: {
    gap: 4
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
