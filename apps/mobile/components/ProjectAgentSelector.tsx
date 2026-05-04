import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AgentBrandIcon } from '@/components/AgentBrandIcon';
import { AgentModelChooser } from '@/components/AgentModelChooser';
import { AGENT_OPTIONS } from '@/lib/agent-models';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import type { AgentModelSelection } from '@/lib/types';

export type ProjectSelectorOption = {
  color: string;
  id: string;
  name: string;
};

type SelectorPanel = 'agent' | 'project' | null;

type ProjectConfig = {
  disabled?: boolean;
  loading?: boolean;
  onChange: (projectId: string) => void;
  options: ProjectSelectorOption[];
  value: string | null;
};

type AgentConfig = {
  disabled?: boolean;
  onChange: (selection: AgentModelSelection) => void;
  onResolvedSelectionChange?: (selection: AgentModelSelection) => void;
  value: AgentModelSelection | null;
};

type Props = {
  agent?: AgentConfig;
  openPanel: SelectorPanel;
  onOpenPanelChange: (panel: SelectorPanel) => void;
  project?: ProjectConfig;
};

export function ProjectAgentSelector({ agent, openPanel, onOpenPanelChange, project }: Props) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  const selectedProject = project?.options.find(option => option.id === project.value) ?? null;
  const selectedAgentOption = AGENT_OPTIONS.find(option => option.value === agent?.value?.agent);
  const selectedAgentModelLabel = agent?.value?.model ?? 'Default model';
  const selectedAgentThinkingLabel = agent?.value?.thinking ? ` · ${agent.value.thinking}` : '';
  const hasMultipleSelectors = Boolean(project && agent);

  function renderTrigger({
    icon,
    label,
    meta,
    isOpen,
    loading,
    disabled,
    onPress,
    iconSlot
  }: {
    disabled?: boolean;
    icon: keyof typeof Ionicons.glyphMap;
    iconSlot?: ReactNode;
    isOpen: boolean;
    label: string;
    loading?: boolean;
    meta: string;
    onPress: () => void;
  }) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.triggerButton,
          hasMultipleSelectors && styles.triggerButtonSplit,
          disabled && styles.triggerButtonDisabled,
          pressed && !disabled && styles.triggerButtonPressed
        ]}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen, disabled }}
      >
        <View style={styles.triggerLeading}>
          <View style={styles.triggerIconWrap}>
            {iconSlot ?? <Ionicons name={icon} size={16} color={colors.foreground} />}
          </View>
          <View style={styles.triggerTextWrap}>
            <Text style={styles.triggerLabel} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.triggerMeta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.mutedForeground}
          />
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.triggerRow, !hasMultipleSelectors && styles.triggerRowSingle]}>
        {project
          ? renderTrigger({
              icon: 'folder-outline',
              iconSlot: selectedProject ? (
                <View style={[styles.projectDot, { backgroundColor: selectedProject.color }]} />
              ) : undefined,
              label: project.loading
                ? 'Loading projects…'
                : (selectedProject?.name ?? 'Select project'),
              meta: 'Project',
              isOpen: openPanel === 'project',
              loading: project.loading,
              disabled: project.disabled ?? project.loading,
              onPress: () => onOpenPanelChange(openPanel === 'project' ? null : 'project')
            })
          : null}

        {agent
          ? renderTrigger({
              icon: 'hardware-chip-outline',
              iconSlot: selectedAgentOption ? (
                <AgentBrandIcon agent={selectedAgentOption.value} size={16} />
              ) : undefined,
              label: selectedAgentOption?.label ?? 'Choose agent',
              meta: `${selectedAgentModelLabel}${selectedAgentThinkingLabel}`,
              isOpen: openPanel === 'agent',
              disabled: agent.disabled,
              onPress: () => onOpenPanelChange(openPanel === 'agent' ? null : 'agent')
            })
          : null}
      </View>

      {openPanel === 'project' && project ? (
        <View style={styles.panel}>
          {project.options.map(option => {
            const isSelected = option.id === project.value;
            return (
              <Pressable
                key={option.id}
                style={({ pressed }) => [
                  styles.projectOption,
                  isSelected && styles.projectOptionSelected,
                  pressed && styles.projectOptionPressed
                ]}
                onPress={() => {
                  project.onChange(option.id);
                  onOpenPanelChange(null);
                }}
              >
                <View style={styles.projectOptionLeft}>
                  <View style={[styles.projectOptionDot, { backgroundColor: option.color }]} />
                  <Text style={styles.projectOptionText}>{option.name}</Text>
                </View>
                {isSelected ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {openPanel === 'agent' && agent ? (
        <View style={styles.panel}>
          <AgentModelChooser
            alwaysExpanded
            value={agent.value}
            onChange={agent.onChange}
            onResolvedSelectionChange={agent.onResolvedSelectionChange}
            disabled={agent.disabled}
          />
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      gap: 6
    },
    triggerRow: {
      flexDirection: 'row',
      gap: 8
    },
    triggerRowSingle: {
      gap: 0
    },
    triggerButton: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)'
    },
    triggerButtonSplit: {
      flexBasis: 0
    },
    triggerButtonPressed: {
      opacity: 0.85
    },
    triggerButtonDisabled: {
      opacity: 0.55
    },
    triggerLeading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
      minWidth: 0
    },
    triggerIconWrap: {
      width: 28,
      height: 28,
      borderRadius: 7,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'
    },
    triggerTextWrap: {
      flex: 1,
      minWidth: 0
    },
    triggerLabel: {
      color: colors.foreground,
      fontSize: 15,
      fontWeight: '600'
    },
    triggerMeta: {
      color: colors.mutedForeground,
      fontSize: 12,
      marginTop: 2
    },
    projectDot: {
      width: 10,
      height: 10,
      borderRadius: 999
    },
    panel: {
      padding: 10,
      borderRadius: 12,
      backgroundColor: colors.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
    },
    projectOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: 10
    },
    projectOptionSelected: {
      backgroundColor: `${colors.primary}14`
    },
    projectOptionPressed: {
      opacity: 0.85
    },
    projectOptionLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
      minWidth: 0
    },
    projectOptionDot: {
      width: 8,
      height: 8,
      borderRadius: 999
    },
    projectOptionText: {
      color: colors.foreground,
      fontSize: 14,
      flexShrink: 1
    }
  });
