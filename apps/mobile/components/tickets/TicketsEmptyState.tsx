import { Text, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

import type { StatusFilter } from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type TicketsEmptyStateProps = {
  search: string;
  statusFilter: StatusFilter;
  filterProject: { name: string } | null;
};

export function TicketsEmptyState({ search, statusFilter, filterProject }: TicketsEmptyStateProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);

  return (
    <View style={styles.empty}>
      <Ionicons name="ticket-outline" size={48} color={colors.mutedForeground} />
      <Text style={styles.emptyText}>No tickets</Text>
      <Text style={styles.emptySub}>
        {search.trim() || statusFilter.length > 0
          ? 'Try clearing filters.'
          : filterProject
            ? `No tickets in ${filterProject.name}.`
            : 'No tickets across your projects yet.'}
      </Text>
    </View>
  );
}
