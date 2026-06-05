import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateTicketFormFields } from '@/components/CreateTicketFormFields';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import { useCreateTicketForm } from '@/lib/use-create-ticket-form';

const glassAvailable = Platform.OS === 'ios' && isLiquidGlassAvailable();

type Props = {
  visible: boolean;
  onClose: () => void;
  defaultProjectId?: string | null;
};

export function QuickCreateTicketModal({ visible, onClose, defaultProjectId }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const form = useCreateTicketForm({ active: visible, defaultProjectId });
  const { submitting, canSubmit, submit, reset } = form;

  useEffect(() => {
    if (!visible) {
      reset();
    }
  }, [visible, reset]);

  const cardMaxHeight = Math.min(windowHeight - insets.top - 12, windowHeight * 0.9);

  async function handleSubmit() {
    try {
      const ticketId = await submit();
      if (ticketId) {
        onClose();
      }
    } catch (err) {
      Alert.alert(
        'Failed to create ticket',
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      );
    }
  }

  const InnerSurface = glassAvailable ? GlassView : View;
  const innerSurfaceProps = glassAvailable
    ? {
        glassEffectStyle: 'regular' as const,
        style: styles.card,
        colorScheme: (colors.isDark ? 'dark' : 'light') as 'dark' | 'light'
      }
    : { style: [styles.card, styles.cardFallback] };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.avoider}
          keyboardVerticalOffset={Math.min(insets.bottom, 10)}
          pointerEvents="box-none"
        >
          <Pressable style={styles.cardWrap} onPress={() => {}}>
            <InnerSurface {...innerSurfaceProps}>
              <View style={[styles.cardSize, { maxHeight: cardMaxHeight }]}>
                <View style={styles.handleBar} />

                <View style={styles.headerRow}>
                  <Text style={styles.headerTitle}>New ticket</Text>
                  <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
                    <Ionicons name="close" size={22} color={colors.foreground} />
                  </Pressable>
                </View>

                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.scrollContent}
                  bounces={false}
                >
                  <CreateTicketFormFields form={form} autoFocus />
                </ScrollView>

                <View style={styles.footer}>
                  <Pressable onPress={onClose} style={styles.cancelButton} disabled={submitting}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSubmit}
                    disabled={!canSubmit}
                    style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="arrow-up" size={16} color="#fff" />
                        <Text style={styles.submitText}>Create</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            </InnerSurface>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end'
    },
    avoider: {
      width: '100%'
    },
    cardWrap: {
      paddingHorizontal: 10,
      paddingBottom: 10
    },
    card: {
      borderRadius: 24,
      overflow: 'hidden',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 12
    },
    cardSize: {
      flexShrink: 1
    },
    cardFallback: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border
    },
    handleBar: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.mutedForeground,
      opacity: 0.4,
      marginBottom: 6
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8
    },
    headerTitle: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: '700'
    },
    scrollContent: {
      gap: 10,
      paddingBottom: 4
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 10
    },
    cancelButton: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12
    },
    cancelText: {
      color: colors.mutedForeground,
      fontSize: 15,
      fontWeight: '500'
    },
    submitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.primary
    },
    submitButtonDisabled: {
      opacity: 0.4
    },
    submitText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: '600'
    }
  });
