import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';

import { createTicketsScreenStyles } from './TicketsScreenStyles';

type FilterChipProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active: boolean;
};

export function FilterChip({ icon, label, onPress, active }: FilterChipProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);

  return (
    <Pressable
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={13} color={colors.foreground} />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}
