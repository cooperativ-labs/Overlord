import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import type { AgentLaunchConfigUpdate } from '@/lib/types';

type AgentLaunchFooterProps = {
  /** agent_type key the pre-command / flags are stored under. */
  agentKey: string;
  /** Initial pre-command for this agent. Empty string means none. */
  preCommand: string;
  /** Initial flags for this agent. */
  flags: string[];
  /**
   * Persist a partial config change. The owner (AgentModelChooser) routes this
   * to the app-wide selected execution target so the same defaults apply
   * everywhere. Omitted when there is no editable target.
   */
  onChange?: (update: AgentLaunchConfigUpdate) => void;
  /** Label of the target these defaults apply to, shown as a caption. */
  targetLabel?: string | null;
  /**
   * When true, the fields edit a per-objective override of the target config
   * rather than the target config itself. Changes the caption to explain that
   * empty fields mean "no pre-command / flags for this objective".
   */
  override?: boolean;
  disabled?: boolean;
};

/**
 * Mobile counterpart of the web AgentLaunchFooter. Shows the selected agent's
 * launch pre-command and command flags, both editable. Persistence is delegated
 * via `onChange` so the values are written to the app-wide selected execution
 * target's per-agent config (`user_execution_targets.agent_flags`) — the same
 * source the Servers tab shows and the ovld runner reads. Mounted with a `key`
 * of the target + agent so the fields re-seed whenever either changes.
 */
export function AgentLaunchFooter({
  agentKey: _agentKey,
  preCommand: initialPreCommand,
  flags: initialFlags,
  onChange,
  targetLabel,
  override = false,
  disabled = false
}: AgentLaunchFooterProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const [preCommand, setPreCommand] = useState(initialPreCommand);
  const [flags, setFlags] = useState<string[]>(initialFlags);
  const [flagDraft, setFlagDraft] = useState('');

  const editable = !disabled && Boolean(onChange);

  const persistPreCommand = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      onChange?.({ preCommand: trimmed.length > 0 ? trimmed : null });
    },
    [onChange]
  );

  const commitFlags = useCallback(
    (raw: string[]) => {
      const cleaned = raw.map(flag => flag.trim()).filter(flag => flag.length > 0);
      setFlags(cleaned);
      onChange?.({ flags: cleaned });
    },
    [onChange]
  );

  const addFlag = useCallback(() => {
    const value = flagDraft.trim();
    if (!value) return;
    commitFlags([...flags, value]);
    setFlagDraft('');
  }, [commitFlags, flagDraft, flags]);

  return (
    <View style={styles.container}>
      <Text style={styles.caption}>
        {override
          ? `Overrides the launch defaults${
              targetLabel ? ` from ${targetLabel}` : ''
            } for this objective. Leave empty to run with no pre-command or flags.`
          : targetLabel
            ? `Launch defaults for ${targetLabel}`
            : 'Select an execution target to set launch defaults.'}
      </Text>

      <Text style={styles.groupLabel}>Pre-command</Text>
      <TextInput
        style={[styles.preCommandInput, !editable && styles.inputDisabled]}
        value={preCommand}
        onChangeText={setPreCommand}
        onBlur={() => persistPreCommand(preCommand)}
        placeholder="none"
        placeholderTextColor={colors.mutedForeground}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[styles.groupLabel, styles.flagsLabel]}>Flags</Text>
      <View style={styles.flagWrap}>
        {flags.map((flag, index) => (
          <View key={`${flag}-${index}`} style={styles.flagChip}>
            <Text style={styles.flagChipText}>{flag}</Text>
            <Pressable
              hitSlop={6}
              disabled={!editable}
              onPress={() => commitFlags(flags.filter((_, i) => i !== index))}
              accessibilityRole="button"
              accessibilityLabel={`Remove flag ${flag}`}
            >
              <Ionicons name="close" size={12} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ))}
        <View style={[styles.flagDraftChip, !editable && styles.inputDisabled]}>
          <TextInput
            style={styles.flagDraftInput}
            value={flagDraft}
            onChangeText={setFlagDraft}
            onBlur={addFlag}
            onSubmitEditing={addFlag}
            placeholder="--flag"
            placeholderTextColor={colors.mutedForeground}
            editable={editable}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
          />
          <Pressable
            hitSlop={6}
            disabled={!editable}
            onPress={addFlag}
            accessibilityRole="button"
            accessibilityLabel="Add flag"
          >
            <Ionicons name="add" size={14} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginTop: 8,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border
    },
    caption: {
      color: colors.mutedForeground,
      fontSize: 11,
      lineHeight: 16,
      marginBottom: 10
    },
    inputDisabled: {
      opacity: 0.5
    },
    groupLabel: {
      color: colors.mutedForeground,
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6
    },
    flagsLabel: {
      marginTop: 12
    },
    preCommandInput: {
      backgroundColor: colors.secondary,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
      color: colors.foreground,
      fontSize: 13,
      fontFamily: 'monospace'
    },
    flagWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 6
    },
    flagChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.secondary,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingLeft: 8,
      paddingRight: 6,
      paddingVertical: 4
    },
    flagChipText: {
      color: colors.foreground,
      fontSize: 12,
      fontFamily: 'monospace'
    },
    flagDraftChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      borderRadius: 8,
      paddingLeft: 8,
      paddingRight: 6,
      paddingVertical: 2
    },
    flagDraftInput: {
      minWidth: 60,
      color: colors.foreground,
      fontSize: 12,
      fontFamily: 'monospace',
      paddingVertical: 2
    }
  });
