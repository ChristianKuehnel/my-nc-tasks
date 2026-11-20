/**
 * Authentication state machine for the app root (Phase 1.1).
 *
 *   restoring -> unauthenticated -> authenticating -> authenticated
 *                      ^                    |            |
 *                      +--------------------+ (cancel / failure)
 *                      +--------------------+ (logout)
 *
 * The hook owns the whole Login Flow v2 lifecycle (browser session, polling,
 * timeout, cancellation) and persists the resulting session to SecureStore.
 */

import { openAuthSessionAsync } from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';

import { initLoginFlow, LoginFlowError, pollLoginFlow } from '@/services/nextcloud/login-flow';
import { InvalidServerUrlError, normalizeServerUrl } from '@/services/nextcloud/server-url';
import { clearSession, loadSession, saveSession } from '@/services/nextcloud/session-storage';
import type { AuthSession } from '@/services/nextcloud/types';

export type AuthStatus = 'restoring' | 'unauthenticated' | 'authenticating' | 'authenticated';

export interface UseAuthResult {
  status: AuthStatus;
  /** Present when `status === 'authenticated'`. */
  session: AuthSession | null;
  /** Human-readable failure message, or `null`. Cleared on the next attempt. */
  error: string | null;
  /** Start a Login Flow v2 login against the given (user-entered) server. */
  login: (serverUrlInput: string) => Promise<void>;
  /** Cancel an in-flight login (stops polling; no error is reported). */
  cancel: () => void;
  /** Clear the stored session and return to the login screen. */
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    loadSession().then((stored) => {
      if (!active) return;
      if (stored) {
        setSession(stored);
        setStatus('authenticated');
      } else {
        setStatus('unauthenticated');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const login = useCallback(async (serverUrlInput: string) => {
    setError(null);

    let serverUrl: string;
    try {
      serverUrl = normalizeServerUrl(serverUrlInput);
    } catch (err) {
      if (err instanceof InvalidServerUrlError) {
        setError(err.message);
      } else {
        setError('The server URL is not valid.');
      }
      return;
    }

    setStatus('authenticating');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const init = await initLoginFlow(serverUrl);

      // Open the in-app browser; the user completes the login (including any
      // MFA) there. The result of the browser session is intentionally not
      // awaited: the source of truth is the poll endpoint. Polling continues
      // even if the browser is dismissed early.
      void openAuthSessionAsync(init.login).catch(() => {
        // Non-fatal: the poll endpoint decides whether the login succeeded.
      });

      const { credentials } = await pollLoginFlow(init, { signal: controller.signal });

      const newSession: AuthSession = {
        serverUrl: normalizeServerUrl(credentials.server),
        loginName: credentials.loginName,
        appPassword: credentials.appPassword,
      };
      await saveSession(newSession);
      setSession(newSession);
      setStatus('authenticated');
    } catch (err) {
      if (err instanceof LoginFlowError && err.code === 'cancelled') {
        // Intentional cancellation — not an error.
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed.');
      }
      setStatus('unauthenticated');
    } finally {
      abortRef.current = null;
    }
  }, []);

  const logout = useCallback(async () => {
    abortRef.current?.abort();
    await clearSession();
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  return { status, session, error, login, cancel, logout };
}
