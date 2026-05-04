import { GlassView } from 'expo-glass-effect';
import { Pressable, TextInput, View } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

import { glassAvailable } from './shared';
import { createTicketsScreenStyles } from './TicketsScreenStyles';

type TicketsScreenHeaderProps = {
  search: string;
  onSearchChange: (value: string) => void;
  onOpenDrawer: () => void;
  onCreateTicket: () => void;
  projectColor: string;
  buttonIconColor: string;
};

export function TicketsScreenHeader({
  search,
  onSearchChange,
  onOpenDrawer,
  onCreateTicket,
  projectColor,
  buttonIconColor
}: TicketsScreenHeaderProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createTicketsScreenStyles);

  return (
    <View style={styles.topBar}>
      <Pressable
        hitSlop={10}
        style={styles.ghostButton}
        onPress={onOpenDrawer}
        accessibilityLabel="Open navigation"
      >
        <Ionicons name="menu-outline" size={22} color={colors.foreground} />
      </Pressable>
      {glassAvailable ? (
        <GlassView style={styles.searchWrap} glassEffectStyle="regular">
          <Ionicons name="search" size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={onSearchChange}
            placeholder="Search ticket"
            placeholderTextColor={colors.mutedForeground}
            style={styles.searchInput}
          />
        </GlassView>
      ) : (
        <View style={[styles.searchWrap, styles.searchWrapFallback]}>
          <Ionicons name="search" size={14} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={onSearchChange}
            placeholder="Search ticket"
            placeholderTextColor={colors.mutedForeground}
            style={styles.searchInput}
          />
        </View>
      )}
      <Pressable hitSlop={10} onPress={onCreateTicket} accessibilityLabel="Create ticket">
        {glassAvailable ? (
          <GlassView
            style={styles.createButton}
            glassEffectStyle="regular"
            tintColor={projectColor}
          >
            <Ionicons name="add" size={16} color={buttonIconColor} />
            <Ionicons name="ticket-outline" size={14} color={buttonIconColor} />
          </GlassView>
        ) : (
          <View style={[styles.createButton, { backgroundColor: projectColor }]}>
            <Ionicons name="add" size={16} color={buttonIconColor} />
            <Ionicons name="ticket-outline" size={14} color={buttonIconColor} />
          </View>
        )}
      </Pressable>
    </View>
  );
}
