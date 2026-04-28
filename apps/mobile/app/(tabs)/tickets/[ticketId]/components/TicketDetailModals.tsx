import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, Text } from 'react-native';

import { AgentModelChooser } from '@/components/AgentModelChooser';
import { useThemeColors, useThemedStyles } from '@/lib/colors';
import type { AgentModelSelection } from '@/lib/types';

import { createStyles } from './ticket-detail-styles';

export function TicketDetailModals({
  showAgentModal,
  assignedSelection,
  savingAssignedAgent,
  onAssignedAgentChange,
  onResolvedSelectionChange,
  onCloseAgentModal,
  overflowOpen,
  onCloseOverflow,
  onCopyTicketId,
  onReload
}: {
  showAgentModal: boolean;
  assignedSelection: AgentModelSelection | null;
  savingAssignedAgent: boolean;
  onAssignedAgentChange: (nextSelection: AgentModelSelection) => Promise<void>;
  onResolvedSelectionChange: (value: AgentModelSelection | null) => void;
  onCloseAgentModal: () => void;
  overflowOpen: boolean;
  onCloseOverflow: () => void;
  onCopyTicketId: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <>
      <Modal
        visible={showAgentModal}
        transparent
        animationType="fade"
        onRequestClose={onCloseAgentModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCloseAgentModal}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Assigned Agent</Text>
            <AgentModelChooser
              value={assignedSelection}
              onChange={onAssignedAgentChange}
              onResolvedSelectionChange={onResolvedSelectionChange}
              helperText="Choose the agent and model."
              disabled={savingAssignedAgent}
            />
            <Pressable
              style={({ pressed }) => [styles.modalDone, pressed && styles.pressed]}
              onPress={onCloseAgentModal}
            >
              <Text style={styles.modalDoneText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={overflowOpen}
        transparent
        animationType="fade"
        onRequestClose={onCloseOverflow}
      >
        <Pressable style={styles.modalBackdrop} onPress={onCloseOverflow}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
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
