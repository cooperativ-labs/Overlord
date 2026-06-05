import { Text, View } from 'react-native';

import { useThemedStyles } from '@/lib/colors';

import { createTicketsScreenStyles } from './TicketsScreenStyles';

type CalendarListHeaderProps = {
  projectName: string;
};

export function CalendarListHeader({ projectName }: CalendarListHeaderProps) {
  const styles = useThemedStyles(createTicketsScreenStyles);

  return (
    <View style={styles.calendarHeader}>
      <Text style={styles.calendarTitle}>Scheduled days</Text>
      <Text style={styles.calendarSub}>
        Add tickets directly onto the calendar for {projectName}.
      </Text>
    </View>
  );
}
