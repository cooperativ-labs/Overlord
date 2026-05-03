import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';

import { getStatusColors, statusLabel } from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type SectionHeaderProps = {
  status: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
};

export function SectionHeader({ status, count, collapsed, onToggle }: SectionHeaderProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);
  const statusColors = getStatusColors(colors);
  const accent = statusColors[status] ?? colors.mutedForeground;
  const label = statusLabel[status] ?? status;

  return (
    <Pressable style={styles.sectionHeader} onPress={onToggle} accessibilityRole="button">
      <Ionicons
        name={collapsed ? 'chevron-forward' : 'chevron-down'}
        size={14}
        color={colors.mutedForeground}
      />
      <View style={[styles.sectionDot, { backgroundColor: accent }]} />
      <Text style={styles.sectionTitle}>{label}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </Pressable>
  );
}
