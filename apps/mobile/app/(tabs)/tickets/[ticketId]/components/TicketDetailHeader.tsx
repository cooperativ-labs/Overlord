import { Ionicons } from '@expo/vector-icons';
import { GlassView } from 'expo-glass-effect';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';

import { AgentBrandIcon } from '@/components/AgentBrandIcon';
import { AGENT_OPTIONS } from '@/lib/agent-models';
import { useThemeColors, useThemedStyles } from '@/lib/colors';
import type { AgentModelSelection } from '@/lib/types';

import { glassAvailable } from './ticket-detail-shared';
import { createStyles } from './ticket-detail-styles';

export function TicketHeaderTitle({
  title,
  subtitle,
  assignedSelection,
  savingAssignedAgent,
  onPress
}: {
  title: string;
  subtitle: string;
  assignedSelection: AgentModelSelection | null;
  savingAssignedAgent: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const PillContainer = glassAvailable ? GlassView : View;
  const pillStyle = glassAvailable
    ? styles.headerTitlePill
    : [styles.headerTitlePill, styles.headerTitlePillFallback];

  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      accessibilityLabel="Open ticket actions"
      accessibilityRole="button"
    >
      <PillContainer
        style={pillStyle}
        {...(glassAvailable ? { glassEffectStyle: 'regular' as const, isInteractive: true } : {})}
      >
        {assignedSelection?.agent ? (
          <AgentBrandIcon agent={assignedSelection.agent} size={14} />
        ) : (
          <Ionicons name="hardware-chip-outline" size={14} color={colors.foreground} />
        )}
        <View style={styles.headerTitleTextWrap}>
          <Text style={styles.headerTitleText} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSubtitleText} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {savingAssignedAgent ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
        )}
      </PillContainer>
    </Pressable>
  );
}

export function TicketHeaderRight({ onPress }: { onPress: () => void }) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const IconContainer = glassAvailable ? GlassView : View;
  const iconStyle = glassAvailable
    ? styles.headerIconButton
    : [styles.headerIconButton, styles.headerIconButtonFallback];

  return (
    <Pressable
      hitSlop={10}
      onPress={onPress}
      accessibilityLabel="More actions"
      accessibilityRole="button"
      style={styles.headerIconPressable}
    >
      <IconContainer
        style={iconStyle}
        {...(glassAvailable ? { glassEffectStyle: 'regular' as const } : {})}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={colors.foreground} />
      </IconContainer>
    </Pressable>
  );
}

export function TicketHeaderSheet({
  visible,
  onClose,
  title,
  subtitle,
  assignedSelection,
  savingAssignedAgent,
  copyingPromptContext,
  onOpenAgentModal,
  onOpenOverflow,
  onCopyCliCommand,
  onCopyPrompt,
  onCopyTicketId,
  onReload
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  assignedSelection: AgentModelSelection | null;
  savingAssignedAgent: boolean;
  copyingPromptContext: 'cli' | 'web' | null;
  onOpenAgentModal: () => void;
  onOpenOverflow: () => void;
  onCopyCliCommand: () => void;
  onCopyPrompt: (context: 'cli' | 'web') => void;
  onCopyTicketId: () => void;
  onReload: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const SheetContainer = glassAvailable ? GlassView : View;
  const sheetStyle = glassAvailable
    ? styles.headerSheet
    : [styles.headerSheet, styles.headerSheetFallback];

  const agentLabel =
    AGENT_OPTIONS.find(option => option.value === assignedSelection?.agent)?.label ??
    'Choose agent';
  const modelLabel = assignedSelection?.model ?? 'Default model';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.headerSheetBackdrop} onPress={onClose}>
        <Pressable onPress={() => undefined} style={styles.headerSheetWrap}>
          <SheetContainer
            style={sheetStyle}
            {...(glassAvailable ? { glassEffectStyle: 'regular' as const } : {})}
          >
            <View style={styles.headerSheetTopRow}>
              <Pressable
                hitSlop={10}
                onPress={onClose}
                accessibilityLabel="Close header"
                style={styles.headerSheetCircle}
              >
                <Ionicons name="close" size={18} color={colors.foreground} />
              </Pressable>
              <View style={styles.headerSheetTitleWrap}>
                <Text style={styles.headerSheetTitle} numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={styles.headerSheetSubtitle} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <Pressable
                hitSlop={10}
                onPress={onOpenOverflow}
                accessibilityLabel="More actions"
                style={styles.headerSheetCircle}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.foreground} />
              </Pressable>
            </View>

            <View style={styles.headerSheetChipRow}>
              <HeaderSheetChip
                icon="copy-outline"
                label="Copy CLI"
                onPress={onCopyCliCommand}
                disabled={copyingPromptContext !== null}
              />
              <HeaderSheetChip
                icon="cloud-outline"
                label="Copy Web"
                onPress={() => onCopyPrompt('web')}
                loading={copyingPromptContext === 'web'}
                disabled={copyingPromptContext !== null}
              />
              <HeaderSheetChip icon="refresh-outline" label="Reload" onPress={onReload} />
            </View>

            <Pressable
              style={({ pressed }) => [styles.headerSheetFeaturedRow, pressed && styles.pressed]}
              onPress={onOpenAgentModal}
              disabled={savingAssignedAgent}
              accessibilityLabel="Change assigned agent"
            >
              <View style={styles.headerSheetFeaturedIcon}>
                {assignedSelection?.agent ? (
                  <AgentBrandIcon agent={assignedSelection.agent} size={20} />
                ) : (
                  <Ionicons name="hardware-chip-outline" size={20} color={colors.foreground} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerSheetFeaturedLabel}>{agentLabel}</Text>
                <Text style={styles.headerSheetFeaturedMeta} numberOfLines={1}>
                  {modelLabel}
                </Text>
              </View>
              {savingAssignedAgent ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              )}
            </Pressable>

            <HeaderSheetRow icon="copy-outline" label="Copy ticket ID" onPress={onCopyTicketId} />
            <HeaderSheetRow
              icon="ellipsis-horizontal-circle-outline"
              label="More actions"
              onPress={onOpenOverflow}
            />
          </SheetContainer>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HeaderSheetChip({
  icon,
  label,
  onPress,
  loading,
  disabled
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.headerSheetChip,
        disabled && !loading && styles.headerSheetChipDisabled,
        pressed && !disabled && styles.pressed
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.foreground} />
      ) : (
        <Ionicons name={icon} size={16} color={colors.foreground} />
      )}
      <Text style={styles.headerSheetChipLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function HeaderSheetRow({
  icon,
  label,
  trailing,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  trailing?: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={({ pressed }) => [styles.headerSheetRow, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={18} color={colors.foreground} />
      <Text style={styles.headerSheetRowLabel}>{label}</Text>
      {trailing ? <Text style={styles.headerSheetRowTrailing}>{trailing}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}
