/**
 * Session persistence for Nextcloud credentials.
 *
 * Security notes:
 * - Credentials live in `expo-secure-store` (device keychain / keystore)
 *   only. They are never written to the filesystem, SQLite, or logs.
 * - Keys are namespaced (`my.nctasks.v1.*`) so this app never reads or
 *   writes unrelated SecureStore/Keychain entries, and a future key-format
 *   change can be done by bumping the namespace instead of migrating.
 * - `appPassword` is an app-specific password issued by the server during
 *   Login Flow v2 — never a user password.
 */

import * as SecureStore from 'expo-secure-store';

import type { AuthSession } from './types';

const NAMESPACE = 'my.nctasks.v1';

/** The complete set of keys this app owns. Nothing else is ever touched. */
export const SESSION_STORAGE_KEYS = {
  serverUrl: `${NAMESPACE}.serverUrl`,
  loginName: `${NAMESPACE}.loginName`,
  appPassword: `${NAMESPACE}.appPassword`,
} as const;

export async function saveSession(session: AuthSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SESSION_STORAGE_KEYS.serverUrl, session.serverUrl),
    SecureStore.setItemAsync(SESSION_STORAGE_KEYS.loginName, session.loginName),
    SecureStore.setItemAsync(SESSION_STORAGE_KEYS.appPassword, session.appPassword),
  ]);
}

/**
 * Restore the stored session, or return `null` when it does not exist or is
 * incomplete (a partially written session is treated as absent rather than
 * trusted with missing fields).
 */
export async function loadSession(): Promise<AuthSession | null> {
  const [serverUrl, loginName, appPassword] = await Promise.all([
    SecureStore.getItemAsync(SESSION_STORAGE_KEYS.serverUrl),
    SecureStore.getItemAsync(SESSION_STORAGE_KEYS.loginName),
    SecureStore.getItemAsync(SESSION_STORAGE_KEYS.appPassword),
  ]);
  if (!serverUrl || !loginName || !appPassword) {
    return null;
  }
  return { serverUrl, loginName, appPassword };
}

/**
 * Remove exactly the session keys owned by this app. Unrelated SecureStore
 * entries are left untouched.
 */
export async function clearSession(): Promise<void> {
  await Promise.all(
    Object.values(SESSION_STORAGE_KEYS).map((key) => SecureStore.deleteItemAsync(key)),
  );
}
