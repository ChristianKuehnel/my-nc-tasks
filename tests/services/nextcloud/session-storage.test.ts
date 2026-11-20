import {
  clearSession,
  loadSession,
  saveSession,
  SESSION_STORAGE_KEYS,
} from '@/services/nextcloud/session-storage';
import type { AuthSession } from '@/services/nextcloud/types';

/** In-memory stand-in for expo-secure-store (no keychain in the test env). */
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

const SESSION: AuthSession = {
  serverUrl: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'app__secret',
};

describe('session storage', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('saves and restores a session', async () => {
    await saveSession(SESSION);
    await expect(loadSession()).resolves.toEqual(SESSION);
  });

  it('returns null when nothing is stored', async () => {
    await expect(loadSession()).resolves.toBeNull();
  });

  it('treats a partially stored session as absent', async () => {
    await saveSession(SESSION);
    mockStore.delete(SESSION_STORAGE_KEYS.appPassword);
    await expect(loadSession()).resolves.toBeNull();
  });

  it('clears exactly the owned keys and leaves unrelated entries untouched', async () => {
    const unrelatedKey = 'some.other.app.key';
    mockStore.set(unrelatedKey, 'keep-me');
    await saveSession(SESSION);

    await clearSession();

    for (const key of Object.values(SESSION_STORAGE_KEYS)) {
      expect(mockStore.has(key)).toBe(false);
    }
    expect(mockStore.get(unrelatedKey)).toBe('keep-me');
  });

  it('uses namespaced keys that never collide with generic names', () => {
    for (const key of Object.values(SESSION_STORAGE_KEYS)) {
      expect(key.startsWith('my.nctasks.v1.')).toBe(true);
    }
  });
});
