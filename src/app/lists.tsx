import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ListsScreen } from '@/features/lists/lists-screen';
import { useAuth } from '@/features/auth/use-auth';

/**
 * Task list route (Phase 1.3). Only reachable while authenticated; the
 * session is restored from SecureStore by the same `useAuth` hook the app
 * root uses, so the lists screen works independently of navigation state.
 */
export default function ListsRoute() {
  const auth = useAuth();

  if (auth.status !== 'authenticated' || auth.session === null) {
    return (
      <View style={styles.loading} accessibilityLiveRegion="polite">
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return <ListsScreen session={auth.session} />;
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
    color: '#555',
  },
});
