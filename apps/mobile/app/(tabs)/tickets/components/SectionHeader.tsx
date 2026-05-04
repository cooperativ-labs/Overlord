import { Pressable, Text, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

import {
  formatStatusName,
  getStatusColors,
  getStatusDefinition,
  type TicketStatusDefinition
} from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type SectionHeaderProps = {
  status: string;
  organizationId: number | null;
  statusDefinitions: TicketStatusDefinition[];
  count: number;
  collapsed: boolean;
  onToggle: () => void;
};

export function SectionHeader({
  status,
  organizationId,
  statusDefinitions,
  count,
  collapsed,
  onToggle
}: SectionHeaderProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);
  const statusColors = getStatusColors(colors);
  const definition =
    (organizationId === null
      ? null
      : getStatusDefinition(statusDefinitions, organizationId, status)) ??
    statusDefinitions.find(candidate => candidate.name === status) ??
    null;
  const accent = definition ? statusColors[definition.status_type] : colors.mutedForeground;
  const label = formatStatusName(status);

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
