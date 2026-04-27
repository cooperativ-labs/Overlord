import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/colors';

export default function AccountScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: signOut
      }
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.profileSection}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={32} color={colors.mutedForeground} />
        </View>
        <Text style={styles.email}>{user?.email ?? 'Not signed in'}</Text>
      </View>

      <View style={styles.menuSection}>
        <Pressable style={styles.menuItem} onPress={() => router.push('/(tabs)/account/servers')}>
          <Ionicons name="server-outline" size={20} color={colors.foreground} />
          <View style={styles.menuItemContent}>
            <Text style={styles.menuText}>Servers</Text>
            <Text style={styles.menuDescription}>Manage connected machines</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>
        <Pressable
          style={[styles.menuItem, styles.menuItemLast]}
          onPress={() => router.push('/(tabs)/account/security')}
        >
          <Ionicons name="shield-outline" size={20} color={colors.foreground} />
          <View style={styles.menuCopy}>
            <Text style={styles.menuText}>Security</Text>
            <Text style={styles.menuDescription}>Server terminal preferences</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <View style={styles.menuSection}>
        <Pressable style={[styles.menuItem, styles.menuItemLast]} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
          <View style={styles.menuItemContent}>
            <Text style={[styles.menuText, { color: colors.destructive }]}>Sign Out</Text>
          </View>
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
    paddingTop: 24
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: 24
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  email: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: '500'
  },
  menuSection: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden'
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12
  },
  menuItemLast: {
    borderBottomWidth: 0
  },
  menuItemContent: {
    flex: 1
  },
  menuCopy: {
    flex: 1
  },
  menuText: {
    color: colors.foreground,
    fontSize: 16
  },
  menuDescription: {
    color: colors.mutedForeground,
    fontSize: 13,
    marginTop: 2
  }
});
