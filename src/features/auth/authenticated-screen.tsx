import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AuthSession } from '@/services/nextcloud/types';

interface AuthenticatedScreenProps {
  session: AuthSession;
  onLogout: () => void;
}

/**
 * Shown after a successful Login Flow v2: which server/user the app is
 * connected to, logout, and a link back to the Phase 0.5 Hello World screen.
 */
export function AuthenticatedScreen({ session, onLogout }: AuthenticatedScreenProps) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Connected
        </Text>
        <View style={styles.card}>
          <Text style={styles.serverLabel}>Server</Text>
          <Text style={styles.serverValue}>{session.serverUrl}</Text>
          <Text style={styles.userLabel}>User</Text>
          <Text style={styles.userValue}>{session.loginName}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log out"
          style={({ pressed }) => [styles.logoutButton, pressed ? styles.buttonPressed : null]}
          onPress={onLogout}
        >
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
        <Link href="/hello">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Hello World screen"
            style={({ pressed }) => [styles.linkButton, pressed ? styles.buttonPressed : null]}
          >
            <Text style={styles.linkText}>Hello World (Phase 0)</Text>
          </Pressable>
        </Link>
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
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  serverLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  serverValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  userLabel: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  userValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  logoutButton: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  linkButton: {
    borderRadius: 12,
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
  linkText: {
    fontSize: 14,
    color: '#2563eb',
  },
});
