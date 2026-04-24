import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/lib/auth-context';
import { colors } from '@/lib/colors';
import { useSelectedProject } from '@/lib/selected-project-context';

interface SidebarDrawerProps {
  visible: boolean;
  onClose: () => void;
}

export function SidebarDrawer({ visible, onClose }: SidebarDrawerProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { projects } = useSelectedProject();

  const userLabel = useMemo(() => {
    if (!user) return 'Not signed in';
    const name = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'User';
    return name;
  }, [user]);

  const userEmail = user?.email ?? '';

  function navigate(path: string) {
    onClose();
    router.push(path as never);
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.drawer} edges={['top', 'left', 'bottom']}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Workspace switcher */}
            <Pressable style={styles.workspaceCard} onPress={onClose}>
              <View style={styles.workspaceIcon}>
                <Ionicons name="globe-outline" size={20} color={colors.primaryForeground} />
              </View>
              <View style={styles.workspaceTextWrap}>
                <Text style={styles.workspaceName}>All Teams</Text>
                <Text style={styles.workspaceSub}>All workspaces</Text>
              </View>
              <Ionicons name="chevron-expand-outline" size={16} color={colors.mutedForeground} />
            </Pressable>

            {/* Workspace nav */}
            <Text style={styles.groupLabel}>Workspace</Text>
            <DrawerItem
              icon="newspaper-outline"
              label="Feed"
              onPress={() => navigate('/(tabs)/feed')}
            />
            <DrawerItem
              icon="list-outline"
              label="My Tickets"
              onPress={() => navigate('/(tabs)/tickets')}
            />
            <DrawerItem
              icon="shield-outline"
              label="Admin"
              onPress={() => navigate('/(tabs)/account')}
            />

            {/* Projects */}
            <View style={styles.groupHeader}>
              <Text style={styles.groupLabel}>Projects</Text>
              <Pressable hitSlop={8} onPress={onClose}>
                <Ionicons name="add" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {projects.length === 0 ? (
              <Text style={styles.emptyHint}>No projects yet</Text>
            ) : (
              projects.map(project => (
                <Pressable
                  key={project.id}
                  style={({ pressed }) => [styles.projectRow, pressed && styles.pressed]}
                  onPress={() => navigate(`/(tabs)/tickets?projectId=${project.id}`)}
                >
                  <View
                    style={[
                      styles.projectDot,
                      { backgroundColor: project.color || colors.primary }
                    ]}
                  />
                  <Text style={styles.projectName} numberOfLines={1}>
                    {project.name}
                  </Text>
                  <Pressable hitSlop={8} style={styles.projectMore} onPress={onClose}>
                    <Ionicons name="ellipsis-horizontal" size={16} color={colors.mutedForeground} />
                  </Pressable>
                </Pressable>
              ))
            )}

            {/* Footer nav */}
            <View style={styles.footerNav}>
              <DrawerItem icon="chatbox-ellipses-outline" label="Feedback" onPress={onClose} />
              <DrawerItem icon="book-outline" label="Take Tutorial" onPress={onClose} />
              <DrawerItem
                icon="settings-outline"
                label="Settings"
                onPress={() => navigate('/(tabs)/account')}
              />
            </View>
          </ScrollView>

          {/* User profile row */}
          <Pressable
            style={styles.userRow}
            onPress={() => {
              onClose();
              void signOut().catch(() => undefined);
            }}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{userLabel.slice(0, 1).toUpperCase()}</Text>
            </View>
            <View style={styles.userTextWrap}>
              <Text style={styles.userName} numberOfLines={1}>
                {userLabel}
              </Text>
              {userEmail ? (
                <Text style={styles.userEmail} numberOfLines={1}>
                  {userEmail}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-expand-outline" size={16} color={colors.mutedForeground} />
          </Pressable>
        </SafeAreaView>

        {/* Scrim */}
        <Pressable style={styles.scrim} onPress={onClose} />
      </View>
    </Modal>
  );
}

function DrawerItem({
  icon,
  label,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.navRow, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={18} color={colors.secondaryForeground} />
      <Text style={styles.navLabel}>{label}</Text>
    </Pressable>
  );
}

const DRAWER_WIDTH = 288;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)'
  },
  drawer: {
    width: DRAWER_WIDTH,
    backgroundColor: colors.background,
    borderRightWidth: 1,
    borderRightColor: colors.border
  },
  scrim: {
    flex: 1
  },
  scroll: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 12
  },
  workspaceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16
  },
  workspaceIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  workspaceTextWrap: {
    flex: 1,
    minWidth: 0
  },
  workspaceName: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600'
  },
  workspaceSub: {
    color: colors.mutedForeground,
    fontSize: 12,
    marginTop: 1
  },
  groupLabel: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 8,
    marginTop: 4,
    marginBottom: 6
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingRight: 8,
    marginBottom: 6
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8
  },
  navLabel: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '500'
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 8
  },
  projectRowSelected: {
    backgroundColor: colors.secondary
  },
  projectDot: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  projectName: {
    flex: 1,
    color: colors.secondaryForeground,
    fontSize: 14
  },
  projectNameSelected: {
    color: colors.foreground,
    fontWeight: '600'
  },
  projectMore: {
    paddingHorizontal: 4,
    paddingVertical: 4
  },
  pressed: {
    opacity: 0.7
  },
  emptyHint: {
    color: colors.mutedForeground,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  footerNav: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarText: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: '700'
  },
  userTextWrap: {
    flex: 1,
    minWidth: 0
  },
  userName: {
    color: colors.foreground,
    fontSize: 14,
    fontWeight: '600'
  },
  userEmail: {
    color: colors.mutedForeground,
    fontSize: 12,
    marginTop: 1
  }
});
