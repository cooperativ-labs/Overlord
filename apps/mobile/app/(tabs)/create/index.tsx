import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';

import { CreateTicketFormFields } from '@/components/CreateTicketFormFields';
import { type ThemeColors, useThemeColors, useThemedStyles } from '@/lib/colors';
import { Ionicons } from '@/lib/icons';
import { useCreateTicketForm } from '@/lib/use-create-ticket-form';

export default function CreateScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const form = useCreateTicketForm();
  const { submitting, canSubmit, submit, reset } = form;

  async function handleCreate() {
    try {
      const ticketId = await submit();
      if (!ticketId) return;
      reset();
      Alert.alert('Ticket created', 'Your ticket has been created.', [
        { text: 'View ticket', onPress: () => router.push(`/(tabs)/tickets/${ticketId}`) },
        { text: 'Create another', style: 'cancel' }
      ]);
    } catch (err) {
      Alert.alert(
        'Failed to create ticket',
        err instanceof Error ? err.message : 'An unexpected error occurred.'
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/*
        The submit button lives inside the ScrollView so native tabs apply the
        automatic content inset for the bottom tab bar. A pinned footer outside
        the scroll view would render underneath the tab bar.
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        <CreateTicketFormFields form={form} />

        <View style={styles.footer}>
          <Pressable
            onPress={handleCreate}
            disabled={!canSubmit}
            style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="arrow-up" size={18} color="#fff" />
                <Text style={styles.submitText}>Create ticket</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background
    },
    scroll: {
      flex: 1
    },
    scrollContent: {
      padding: 16,
      gap: 12,
      paddingBottom: 24
    },
    footer: {
      marginTop: 4,
      paddingTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border
    },
    submitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: colors.primary
    },
    submitButtonDisabled: {
      opacity: 0.4
    },
    submitText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600'
    }
  });
