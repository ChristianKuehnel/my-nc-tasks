import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('@/services/nextcloud/login-flow', () => ({
  initLoginFlow: jest.fn(),
  pollLoginFlow: jest.fn(),
  LoginFlowError: class LoginFlowError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = 'LoginFlowError';
      this.code = code;
    }
  },
}));

jest.mock('@/services/nextcloud/session-storage', () => ({
  loadSession: jest.fn(),
  saveSession: jest.fn(),
  clearSession: jest.fn(),
}));

import * as WebBrowser from 'expo-web-browser';

import {
  initLoginFlow as mockInit,
  LoginFlowError,
  pollLoginFlow as mockPoll,
} from '@/services/nextcloud/login-flow';
import {
  clearSession as mockClear,
  loadSession as mockLoad,
  saveSession as mockSave,
} from '@/services/nextcloud/session-storage';
import { useAuth } from '@/features/auth/use-auth';
import type { AuthSession } from '@/services/nextcloud/types';

const openAuth = WebBrowser.openAuthSessionAsync as unknown as jest.Mock;
const init = mockInit as unknown as jest.Mock;
const poll = mockPoll as unknown as jest.Mock;
const load = mockLoad as unknown as jest.Mock;
const save = mockSave as unknown as jest.Mock;
const clear = mockClear as unknown as jest.Mock;

const INIT = {
  poll: { token: 'poll-token', endpoint: 'https://cloud.example.com/login/v2/poll' },
  login: 'https://cloud.example.com/login/v2/flow/login-token',
};

const CREDENTIALS = {
  server: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'app__secret',
};

const STORED: AuthSession = {
  serverUrl: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'app__secret',
};

async function settledUnauthenticated(result: { current: ReturnType<typeof useAuth> }) {
  await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
}

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    load.mockResolvedValue(null);
    save.mockResolvedValue(undefined);
    clear.mockResolvedValue(undefined);
    openAuth.mockResolvedValue({ type: 'dismissed' });
  });

  it('starts in `restoring` and settles to `unauthenticated` without a stored session', async () => {
    // Deferred restore so the `restoring` state is observable (the async
    // renderHook flushes already-resolved promises before returning).
    let resolveLoad: (value: AuthSession | null) => void = () => undefined;
    load.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const { result } = await renderHook(() => useAuth());
    expect(result.current.status).toBe('restoring');

    await act(async () => {
      resolveLoad(null);
    });
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.session).toBeNull();
  });

  it('restores a stored session on mount', async () => {
    load.mockResolvedValue(STORED);
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(result.current.session).toEqual(STORED);
  });

  it('login: validates, opens the browser, polls, and saves the session', async () => {
    init.mockResolvedValue(INIT);
    poll.mockResolvedValue({ credentials: CREDENTIALS, attempts: 2 });

    const { result } = await renderHook(() => useAuth());
    await settledUnauthenticated(result);

    await act(async () => {
      await result.current.login('cloud.example.com');
    });

    expect(init).toHaveBeenCalledWith('https://cloud.example.com');
    expect(openAuth).toHaveBeenCalledWith(INIT.login);
    expect(poll).toHaveBeenCalledWith(
      INIT,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(save).toHaveBeenCalledWith({
      serverUrl: 'https://cloud.example.com',
      loginName: 'alice',
      appPassword: 'app__secret',
    });
    expect(result.current.status).toBe('authenticated');
    expect(result.current.session?.loginName).toBe('alice');
    expect(result.current.error).toBeNull();
  });

  it('login: rejects an invalid server URL without touching the network', async () => {
    const { result } = await renderHook(() => useAuth());
    await settledUnauthenticated(result);

    await act(async () => {
      await result.current.login('not a url');
    });

    expect(init).not.toHaveBeenCalled();
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.error).toMatch(/not a valid URL/i);
  });

  it('login: surfaces a timeout error and returns to unauthenticated', async () => {
    init.mockResolvedValue(INIT);
    poll.mockRejectedValue(
      new LoginFlowError('timeout', 'Login flow timed out before the login finished.'),
    );

    const { result } = await renderHook(() => useAuth());
    await settledUnauthenticated(result);

    await act(async () => {
      await result.current.login('cloud.example.com');
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.error).toBe('Login flow timed out before the login finished.');
    expect(save).not.toHaveBeenCalled();
  });

  it('login: cancellation does not report an error', async () => {
    init.mockResolvedValue(INIT);
    poll.mockImplementationOnce(
      (_init: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new LoginFlowError('cancelled', 'Login flow was cancelled.'));
          });
        }),
    );

    const { result } = await renderHook(() => useAuth());
    await settledUnauthenticated(result);

    let loginPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      loginPromise = result.current.login('cloud.example.com');
    });
    await waitFor(() => expect(result.current.status).toBe('authenticating'));

    // Abort and settle the login inside one awaited act so the resulting
    // state update is never applied outside of act.
    await act(async () => {
      result.current.cancel();
      await loginPromise;
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.error).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('logout: clears the stored session and returns to unauthenticated', async () => {
    load.mockResolvedValue(STORED);
    const { result } = await renderHook(() => useAuth());
    await waitFor(() => expect(result.current.status).toBe('authenticated'));

    await act(async () => {
      await result.current.logout();
    });

    expect(clear).toHaveBeenCalled();
    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.session).toBeNull();
  });
});
