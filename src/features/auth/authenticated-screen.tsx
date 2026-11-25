import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AuthSession } from '@/services/nextcloud/types';

import { useAuthColors } from './use-auth-colors';

interface AuthenticatedScreenProps {
  session: AuthSession;
  onLogout: () => void;
}

/**
 * Shown after a successful Login Flow v2: which server/user the app is
 * connected to, a link to Task lists, and logout.
 */
export function AuthenticatedScreen({ session, onLogout }: AuthenticatedScreenProps) {
  const colors = useAuthColors();
  const text = { color: colors.text };
  const muted = { color: colors.muted };
  const outlined = { borderColor: colors.border, backgroundColor: colors.surface };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, text]} accessibilityRole="header">
          Connected
        </Text>
        <View style={[styles.card, outlined]}>
          <Text style={[styles.serverLabel, muted]}>Server</Text>
          <Text style={[styles.serverValue, text]}>{session.serverUrl}</Text>
          <Text style={[styles.userLabel, muted]}>User</Text>
          <Text style={[styles.userValue, text]}>{session.loginName}</Text>
        </View>
        <Link href="/lists" asChild>
          <Pressable
            accessibilityLabel="Open task lists"
            style={{ ...styles.listsButton, backgroundColor: colors.action }}
          >
            <Text style={[styles.listsText, { color: colors.actionText }]}>Task lists</Text>
          </Pressable>
        </Link>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log out"
          style={({ pressed }) => [
            styles.logoutButton,
            outlined,
            pressed ? styles.buttonPressed : null,
          ]}
          onPress={onLogout}
        >
          <Text style={[styles.logoutText, text]}>Log out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  card: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  serverLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  serverValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  userLabel: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
  },
  userValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  listsButton: {
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  listsText: {
    fontSize: 16,
    fontWeight: '600',
  },
  logoutButton: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
