import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AuthenticatedScreen } from '@/features/auth/authenticated-screen';
import { LoginScreen } from '@/features/auth/login-screen';
import { useAuthColors } from '@/features/auth/use-auth-colors';
import { useAuth } from '@/features/auth/use-auth';

/**
 * App root (Phase 1.1): an auth gate.
 *
 * - `restoring`            -> brief loading state (SecureStore read)
 * - `unauthenticated`      -> login screen (server URL entry)
 * - `authenticating`       -> login screen in waiting state (browser login + polling)
 * - `authenticated`        -> connected view (server/user, logout)
 */
export default function RootScreen() {
  const auth = useAuth();
  const colors = useAuthColors();

  if (auth.status === 'restoring') {
    return (
      <View
        style={[styles.loading, { backgroundColor: colors.background }]}
        accessibilityLiveRegion="polite"
      >
        <ActivityIndicator size="large" color={colors.action} />
        <Text style={[styles.loadingText, { color: colors.muted }]}>Loading…</Text>
      </View>
    );
  }

  if (auth.status === 'authenticated' && auth.session) {
    return <AuthenticatedScreen session={auth.session} onLogout={() => void auth.logout()} />;
  }

  return (
    <LoginScreen
      status={auth.status === 'authenticating' ? 'authenticating' : 'unauthenticated'}
      error={auth.error}
      onLogin={(serverUrlInput) => void auth.login(serverUrlInput)}
      onCancel={auth.cancel}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
  },
});
