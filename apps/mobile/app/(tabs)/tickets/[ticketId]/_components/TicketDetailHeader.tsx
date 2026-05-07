import { GlassView } from 'expo-glass-effect';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';

import { AgentBrandIcon } from '@/components/AgentBrandIcon';
import { useGlassAvailable, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import type { AgentModelSelection } from '@/lib/types';

import { createStyles } from './ticket-detail-styles';

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);
const HEADER_SHEET_EXPAND_DURATION_MS = 200;

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
  const glassAvailable = useGlassAvailable();
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
  // const IconContainer = glassAvailable ? GlassView : View;
  // const iconStyle = glassAvailable
  //   ? styles.headerIconButton
  //   : [styles.headerIconButton, styles.headerIconButtonFallback];

  return (
    <Pressable
      hitSlop={10}
      onPress={onPress}
      accessibilityLabel="More actions"
      accessibilityRole="button"
      style={styles.headerIconPressable}
    >
      <Ionicons name="ellipsis-horizontal" size={18} color={colors.foreground} />
    </Pressable>
  );
}

export function TicketHeaderSheet({
  visible,
  onClose,
  title,
  subtitle,
  copyingPromptContext,
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
  copyingPromptContext: 'cli' | 'web' | null;
  onOpenOverflow: () => void;
  onCopyCliCommand: () => void;
  onCopyPrompt: (context: 'cli' | 'web') => void;
  onCopyTicketId: () => void;
  onReload: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const glassAvailable = useGlassAvailable();
  const sheetMaxHeight = useSharedValue(0);
  const sheetTranslateY = useSharedValue(-6);

  useEffect(() => {
    const windowHeight = Dimensions.get('window').height;
    const maxHeight = windowHeight * 0.82;

    if (!visible) {
      sheetMaxHeight.value = 0;
      sheetTranslateY.value = -6;
      return;
    }

    sheetMaxHeight.value = withTiming(maxHeight, {
      duration: HEADER_SHEET_EXPAND_DURATION_MS,
      easing: Easing.out(Easing.cubic)
    });
    sheetTranslateY.value = withTiming(0, {
      duration: HEADER_SHEET_EXPAND_DURATION_MS,
      easing: Easing.out(Easing.cubic)
    });
  }, [sheetMaxHeight, sheetTranslateY, visible]);

  const animatedSheetStyle = useAnimatedStyle(() => ({
    maxHeight: sheetMaxHeight.value,
    transform: [{ translateY: sheetTranslateY.value }]
  }));

  const sheetStyle = [
    styles.headerSheetExpanded,
    animatedSheetStyle,
    !glassAvailable && styles.headerSheetFallback
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.headerSheetBackdrop} onPress={onClose}>
        <Pressable onPress={() => undefined} style={styles.headerSheetWrap}>
          {glassAvailable ? (
            <AnimatedGlassView style={sheetStyle} glassEffectStyle="regular">
              <ScrollView
                bounces={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.headerSheetContent}
                keyboardShouldPersistTaps="handled"
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

                <HeaderSheetRow
                  icon="copy-outline"
                  label="Copy ticket ID"
                  onPress={onCopyTicketId}
                />
                <HeaderSheetRow
                  icon="ellipsis-horizontal-circle-outline"
                  label="More actions"
                  onPress={onOpenOverflow}
                />
              </ScrollView>
            </AnimatedGlassView>
          ) : (
            <Animated.View style={sheetStyle}>
              <ScrollView
                bounces={false}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.headerSheetContent}
                keyboardShouldPersistTaps="handled"
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

                <HeaderSheetRow
                  icon="copy-outline"
                  label="Copy ticket ID"
                  onPress={onCopyTicketId}
                />
                <HeaderSheetRow
                  icon="ellipsis-horizontal-circle-outline"
                  label="More actions"
                  onPress={onOpenOverflow}
                />
              </ScrollView>
            </Animated.View>
          )}
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
