import { useReducer } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { helloReducer, initialHelloState } from '@/features/hello/hello-reducer';

/**
 * Phase 0.5 Hello World screen (issue #4).
 *
 * A single screen with one interactive control: tapping the button
 * increments a counter. It was the root screen in Phase 0; since Phase 1.1
 * the root is the auth gate (see `src/app/index.tsx`) and this screen is
 * kept as a sub-route so the Phase 0 artifact and its tests stay reachable.
 */
export default function HelloScreen() {
  const [state, dispatch] = useReducer(helloReducer, initialHelloState);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Hello from my-nc-tasks
        </Text>
        <Text style={styles.subtitle}>Offline-first task app for Nextcloud</Text>
        <Text style={styles.counter} accessibilityLiveRegion="polite">
          {counterLabel(state.count)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increment counter"
          style={({ pressed }) => [styles.button, pressed ? styles.buttonPressed : null]}
          onPress={() => dispatch({ type: 'increment' })}
        >
          <Text style={styles.buttonText}>Tap to increment</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function counterLabel(count: number): string {
  if (count === 0) {
    return 'Not pressed yet';
  }
  return `Pressed ${count} ${count === 1 ? 'time' : 'times'}`;
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
  subtitle: {
    fontSize: 16,
    color: '#555',
    textAlign: 'center',
  },
  counter: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '600',
  },
  button: {
    marginTop: 8,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
