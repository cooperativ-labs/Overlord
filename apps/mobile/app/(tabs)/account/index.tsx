import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/colors';

export default function AccountScreen() {
  const { user, signOut } = useAuth();

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
    <View style={styles.container}>
      <View style={styles.profileSection}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={32} color={colors.mutedForeground} />
        </View>
        <Text style={styles.email}>{user?.email ?? 'Not signed in'}</Text>
      </View>

      <View style={styles.menuSection}>
        <Pressable style={styles.menuItem}>
          <Ionicons name="notifications-outline" size={20} color={colors.foreground} />
          <Text style={styles.menuText}>Notifications</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>

        <Pressable style={styles.menuItem}>
          <Ionicons name="shield-outline" size={20} color={colors.foreground} />
          <Text style={styles.menuText}>Security</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>

        <Pressable style={[styles.menuItem, styles.menuItemLast]} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
          <Text style={[styles.menuText, { color: colors.destructive }]}>Sign Out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  menuText: {
    flex: 1,
    color: colors.foreground,
    fontSize: 16
  }
});
