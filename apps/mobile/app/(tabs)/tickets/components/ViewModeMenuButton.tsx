import { Pressable, Text, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

import type { ViewMode } from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type ViewModeMenuButtonProps = {
  value: ViewMode;
  open: boolean;
  onPress: () => void;
  onSelect: (mode: ViewMode) => void;
};

export function ViewModeMenuButton({ value, open, onPress, onSelect }: ViewModeMenuButtonProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);
  const viewOptions: Array<{
    value: ViewMode;
    label: string;
    icon: 'list-outline' | 'calendar-outline';
  }> = [
    { value: 'list', label: 'List', icon: 'list-outline' },
    { value: 'calendar', label: 'Cal', icon: 'calendar-outline' }
  ];

  return (
    <View style={styles.viewMenuWrap}>
      <Pressable
        style={({ pressed }) => [
          styles.viewMenuButton,
          open && styles.viewMenuButtonActive,
          pressed && styles.pressed
        ]}
        onPress={onPress}
        accessibilityLabel="Change ticket view"
      >
        <Ionicons
          name={value === 'calendar' ? 'calendar-outline' : 'list-outline'}
          size={16}
          color={colors.foreground}
        />
        <Ionicons name="chevron-down" size={12} color={colors.mutedForeground} />
      </Pressable>
      {open && (
        <View style={[styles.menu, styles.viewMenu]}>
          {viewOptions.map(option => (
            <Pressable
              key={option.value}
              style={styles.viewMenuItem}
              onPress={() => onSelect(option.value)}
            >
              <View style={styles.menuItemLeft}>
                <Ionicons
                  name={option.icon}
                  size={15}
                  color={value === option.value ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={[styles.menuItemText, value === option.value && styles.menuItemTextActive]}
                >
                  {option.label}
                </Text>
              </View>
              {value === option.value && (
                <Ionicons name="checkmark" size={14} color={colors.primary} />
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
