import { Modal, Pressable, Text } from 'react-native';

import { useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';

import { createStyles } from './ticket-detail-styles';

export function TicketDetailModals({
  overflowOpen,
  onCloseOverflow,
  onCopyTicketId,
  onReload,
  onNewTicket,
  onDelete
}: {
  overflowOpen: boolean;
  onCloseOverflow: () => void;
  onCopyTicketId: () => Promise<void>;
  onReload: () => Promise<void>;
  onNewTicket?: () => void;
  onDelete?: () => Promise<void>;
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
            {onDelete ? (
              <OverflowAction
                icon="trash-outline"
                label="Delete"
                onPress={() => {
                  onCloseOverflow();
                  void onDelete();
                }}
                destructive
              />
            ) : null}
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
  onPress,
  destructive
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const actionColor = destructive ? colors.error : colors.foreground;
  return (
    <Pressable
      style={({ pressed }) => [styles.overflowRow, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={16} color={actionColor} />
      <Text style={[styles.overflowText, destructive && { color: actionColor }]}>{label}</Text>
    </Pressable>
  );
}
