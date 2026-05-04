import { Modal, Pressable, Text } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

import { createStyles } from './ticket-detail-styles';

export function TicketDetailModals({
  overflowOpen,
  onCloseOverflow,
  onCopyTicketId,
  onReload,
  onNewTicket
}: {
  overflowOpen: boolean;
  onCloseOverflow: () => void;
  onCopyTicketId: () => Promise<void>;
  onReload: () => Promise<void>;
  onNewTicket?: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <>
      <Modal
        visible={overflowOpen}
        transparent
        animationType="fade"
        onRequestClose={onCloseOverflow}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCloseOverflow}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            {onNewTicket ? (
              <OverflowAction
                icon="ticket-outline"
                label="New ticket"
                onPress={() => {
                  onCloseOverflow();
                  onNewTicket();
                }}
              />
            ) : null}
            <OverflowAction
              icon="copy-outline"
              label="Copy ticket ID"
              onPress={() => {
                onCloseOverflow();
                void onCopyTicketId();
              }}
            />
            <OverflowAction
              icon="refresh-outline"
              label="Reload"
              onPress={() => {
                onCloseOverflow();
                void onReload();
              }}
            />
            <OverflowAction icon="close-outline" label="Close" onPress={onCloseOverflow} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function OverflowAction({
  icon,
  label,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      style={({ pressed }) => [styles.overflowRow, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={16} color={colors.foreground} />
      <Text style={styles.overflowText}>{label}</Text>
    </Pressable>
  );
}
