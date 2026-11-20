import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type LoginScreenStatus = 'unauthenticated' | 'authenticating';

interface LoginScreenProps {
  status: LoginScreenStatus;
  error: string | null;
  onLogin: (serverUrlInput: string) => void;
  onCancel: () => void;
}

/**
 * Phase 1.1 login screen: server URL entry, then a browser-based Login Flow
 * v2 with a waiting/cancel state while the app polls for the credentials.
 */
export function LoginScreen({ status, error, onLogin, onCancel }: LoginScreenProps) {
  const [serverInput, setServerInput] = useState('');
  const authenticating = status === 'authenticating';

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={styles.title} accessibilityRole="header">
            Connect to Nextcloud
          </Text>
          <Text style={styles.subtitle}>
            Sign in with your Nextcloud account. The login happens in your browser, including
            two-factor authentication.
          </Text>

          {authenticating ? (
            <View style={styles.waiting} accessibilityLiveRegion="polite">
              <ActivityIndicator size="large" />
              <Text style={styles.waitingText}>Waiting for the login to finish…</Text>
              <Text style={styles.hint}>
                Complete the sign-in in the opened browser. You can come back here any time — the
                app is polling for the result.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel login"
                style={({ pressed }) => [
                  styles.cancelButton,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={onCancel}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.label}>Server</Text>
              <TextInput
                accessibilityLabel="Server URL"
                style={styles.input}
                placeholder="https://cloud.example.com"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={serverInput}
                onChangeText={setServerInput}
                returnKeyType="go"
                onSubmitEditing={() => onLogin(serverInput)}
              />
              {error ? (
                <Text style={styles.error} accessibilityLiveRegion="assertive">
                  {error}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue to login"
                style={({ pressed }) => [
                  styles.button,
                  pressed ? styles.buttonPressed : null,
                  serverInput.trim().length === 0 ? styles.buttonDisabled : null,
                ]}
                disabled={serverInput.trim().length === 0}
                onPress={() => onLogin(serverInput)}
              >
                <Text style={styles.buttonText}>Continue</Text>
              </Pressable>
              <Text style={styles.hint}>
                Tip: enter only the server address — no path to a page, e.g.
                https://cloud.example.com
              </Text>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
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
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
  },
  label: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: 'transparent',
  },
  error: {
    color: '#b91c1c',
    fontSize: 14,
  },
  button: {
    marginTop: 8,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  waiting: {
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  waitingText: {
    fontSize: 17,
    fontWeight: '600',
  },
  hint: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
  },
  cancelButton: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
