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

import { useAuthColors } from './use-auth-colors';

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
  const colors = useAuthColors();
  const authenticating = status === 'authenticating';
  const canContinue = serverInput.trim().length > 0;
  const text = { color: colors.text };
  const muted = { color: colors.muted };
  const outlined = { borderColor: colors.border, backgroundColor: colors.surface };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <Text style={[styles.title, text]} accessibilityRole="header">
            Connect to Nextcloud
          </Text>
          <Text style={[styles.subtitle, muted]}>
            Sign in with your Nextcloud account. The login happens in your browser, including
            two-factor authentication.
          </Text>

          {authenticating ? (
            <View style={styles.waiting} accessibilityLiveRegion="polite">
              <ActivityIndicator size="large" color={colors.action} />
              <Text style={[styles.waitingText, text]}>Waiting for the login to finish…</Text>
              <Text style={[styles.hint, muted]}>
                Complete the sign-in in the opened browser. You can come back here any time — the
                app is polling for the result.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel login"
                style={({ pressed }) => [
                  styles.cancelButton,
                  outlined,
                  pressed ? styles.buttonPressed : null,
                ]}
                onPress={onCancel}
              >
                <Text style={[styles.cancelText, text]}>Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[styles.label, text]}>Server</Text>
              <TextInput
                accessibilityLabel="Server URL"
                style={[styles.input, outlined, text]}
                placeholder="https://cloud.example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={serverInput}
                onChangeText={setServerInput}
                returnKeyType="go"
                onSubmitEditing={() => onLogin(serverInput)}
              />
              {error ? (
                <Text
                  style={[styles.error, { color: colors.error }]}
                  accessibilityLiveRegion="assertive"
                >
                  {error}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue to login"
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: canContinue ? colors.action : colors.disabledAction },
                  pressed ? styles.buttonPressed : null,
                ]}
                disabled={!canContinue}
                onPress={() => onLogin(serverInput)}
              >
                <Text
                  style={[
                    styles.buttonText,
                    { color: canContinue ? colors.actionText : colors.disabledActionText },
                  ]}
                >
                  Continue
                </Text>
              </Pressable>
              <Text style={[styles.hint, muted]}>
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
    textAlign: 'center',
  },
  label: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: {
    fontSize: 14,
  },
  button: {
    marginTop: 8,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
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
    textAlign: 'center',
  },
  cancelButton: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
