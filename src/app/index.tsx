import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Baseline screen (Phase 0.2).
 *
 * Replaced by the interactive Hello World screen in Phase 0.5 (issue #4),
 * which proves the full dev -> CI -> device workflow on a physical iPhone.
 */
export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>my-nc-tasks</Text>
        <Text style={styles.subtitle}>Offline-first task app for Nextcloud</Text>
        <Text style={styles.status}>Phase 0 baseline — tooling and CI setup</Text>
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
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
  },
  status: {
    marginTop: 24,
    fontSize: 13,
    color: '#888',
  },
});
