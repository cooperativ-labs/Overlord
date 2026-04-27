import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/lib/colors';
import {
  DEFAULT_SERVER_TERMINAL_CUSTOM_COMMAND,
  DEFAULT_SERVER_TERMINAL_PREFERENCE,
  getServerTerminalPreference,
  saveServerTerminalPreference,
  type ServerTerminalPreference
} from '@/lib/server-terminal-preferences';

export default function AccountSecurityScreen() {
  const [serverTerminalPreference, setServerTerminalPreference] =
    useState<ServerTerminalPreference>(DEFAULT_SERVER_TERMINAL_PREFERENCE);
  const [savingServerTerminalPreference, setSavingServerTerminalPreference] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getServerTerminalPreference()
      .then(preference => {
        if (!cancelled) setServerTerminalPreference(preference);
      })
      .catch(error => {
        if (__DEV__) {
          console.warn('[AccountSecurity] Failed to load server terminal preference:', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveServerTerminalPreference() {
    if (
      serverTerminalPreference.launchMode === 'custom' &&
      !serverTerminalPreference.customCommand.includes('{command}')
    ) {
      Alert.alert('Command placeholder required', 'Custom server commands must include {command}.');
      return;
    }

    setSavingServerTerminalPreference(true);
    try {
      await saveServerTerminalPreference(serverTerminalPreference);
      Alert.alert('Server terminal saved', 'Future server launches will use this preference.');
    } catch (error) {
      Alert.alert(
        'Unable to save server terminal',
        error instanceof Error ? error.message : 'An unexpected error occurred.'
      );
    } finally {
      setSavingServerTerminalPreference(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.securitySection}>
        <View style={styles.securityHeader}>
          <Ionicons name="shield-outline" size={20} color={colors.foreground} />
          <Text style={styles.sectionLabel}>Security</Text>
        </View>

        <View style={styles.settingsHeader}>
          <Ionicons name="terminal-outline" size={20} color={colors.foreground} />
          <View style={styles.settingsHeaderText}>
            <Text style={styles.settingsTitle}>Server terminal</Text>
            <Text style={styles.settingsSubtitle}>
              Choose how remote ticket sessions open from this device.
            </Text>
          </View>
        </View>

        <View style={styles.optionGroup}>
          <Pressable
            style={({ pressed }) => [
              styles.optionItem,
              serverTerminalPreference.launchMode === 'tmux' && styles.optionItemActive,
              pressed && styles.optionItemPressed
            ]}
            onPress={() =>
              setServerTerminalPreference(current => ({
                ...current,
                launchMode: 'tmux'
              }))
            }
          >
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionTitle}>Default tmux window</Text>
              <Text style={styles.optionDescription}>
                Reuse an existing tmux session or create an overlord session.
              </Text>
            </View>
            {serverTerminalPreference.launchMode === 'tmux' ? (
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            ) : null}
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.optionItem,
              serverTerminalPreference.launchMode === 'custom' && styles.optionItemActive,
              pressed && styles.optionItemPressed
            ]}
            onPress={() =>
              setServerTerminalPreference(current => ({
                ...current,
                launchMode: 'custom'
              }))
            }
          >
            <View style={styles.optionTextWrap}>
              <Text style={styles.optionTitle}>Custom server command</Text>
              <Text style={styles.optionDescription}>
                Use your own tmux, zellij, screen, or shell launcher.
              </Text>
            </View>
            {serverTerminalPreference.launchMode === 'custom' ? (
              <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            ) : null}
          </Pressable>
        </View>

        {serverTerminalPreference.launchMode === 'custom' ? (
          <View style={styles.commandSection}>
            <Text style={styles.commandLabel}>Command template</Text>
            <TextInput
              value={serverTerminalPreference.customCommand}
              onChangeText={customCommand =>
                setServerTerminalPreference(current => ({
                  ...current,
                  customCommand
                }))
              }
              placeholder={DEFAULT_SERVER_TERMINAL_CUSTOM_COMMAND}
              placeholderTextColor={colors.mutedForeground}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.commandInput}
            />
            <Text style={styles.commandHelp}>
              Use {'{command}'} for the generated agent launch command and {'{window}'} for the
              ticket window name.
            </Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.savePreferenceButton,
            savingServerTerminalPreference && styles.savePreferenceButtonDisabled,
            pressed && !savingServerTerminalPreference && styles.savePreferenceButtonPressed
          ]}
          disabled={savingServerTerminalPreference}
          onPress={handleSaveServerTerminalPreference}
        >
          <Text style={styles.savePreferenceButtonText}>
            {savingServerTerminalPreference ? 'Saving...' : 'Save server terminal'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    paddingTop: 24,
    paddingBottom: 24
  },
  securitySection: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16
  },
  securityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  sectionLabel: {
    color: colors.foreground,
    fontSize: 17,
    fontWeight: '600'
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14
  },
  settingsHeaderText: {
    flex: 1
  },
  settingsTitle: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: '600'
  },
  settingsSubtitle: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2
  },
  optionGroup: {
    gap: 10
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12
  },
  optionItemActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(59, 130, 246, 0.1)'
  },
  optionItemPressed: {
    opacity: 0.82
  },
  optionTextWrap: {
    flex: 1
  },
  optionTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600'
  },
  optionDescription: {
    color: colors.mutedForeground,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2
  },
  commandSection: {
    marginTop: 14
  },
  commandLabel: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 8
  },
  commandInput: {
    minHeight: 96,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    padding: 12,
    fontSize: 14,
    lineHeight: 20
  },
  commandHelp: {
    color: colors.mutedForeground,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8
  },
  savePreferenceButton: {
    marginTop: 14,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  savePreferenceButtonDisabled: {
    opacity: 0.45
  },
  savePreferenceButtonPressed: {
    opacity: 0.82
  },
  savePreferenceButtonText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: '600'
  }
});
