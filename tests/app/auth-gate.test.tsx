import type { ReactNode } from 'react';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.defineProperty(Object.create(actual), 'useColorScheme', { value: jest.fn() });
});

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const mockUseAuth = jest.fn();
jest.mock('@/features/auth/use-auth', () => ({
  useAuth: () => mockUseAuth(),
}));

import RootScreen from '@/app/index';
import type { UseAuthResult } from '@/features/auth/use-auth';

function authResult(overrides: Partial<UseAuthResult>): UseAuthResult {
  return {
    status: 'unauthenticated',
    session: null,
    error: null,
    login: jest.fn(),
    cancel: jest.fn(),
    logout: jest.fn(),
    ...overrides,
  };
}

const SESSION = {
  serverUrl: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'secret',
};

describe('RootScreen (auth gate)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useColorScheme).mockReturnValue('light');
  });

  it.each([
    ['light', '#111827', '#475569', '#ffffff', '#2563eb'],
    ['dark', '#f8fafc', '#cbd5e1', '#0f172a', '#93c5fd'],
  ] as const)(
    'styles connected details and actions in %s mode',
    async (scheme, text, muted, actionText, action) => {
      jest.mocked(useColorScheme).mockReturnValue(scheme);
      mockUseAuth.mockReturnValue(authResult({ status: 'authenticated', session: SESSION }));
      await render(<RootScreen />);

      for (const label of ['Connected', SESSION.serverUrl, SESSION.loginName, 'Log out']) {
        expect(screen.getByText(label)).toHaveStyle({ color: text });
      }
      for (const label of ['Server', 'User']) {
        expect(screen.getByText(label)).toHaveStyle({ color: muted });
      }
      expect(screen.getByText('Task lists')).toHaveStyle({ color: actionText });
      expect(screen.getByLabelText('Open task lists')).toHaveStyle({ backgroundColor: action });
    },
  );

  it('shows a loading state while the session is being restored', async () => {
    jest.mocked(useColorScheme).mockReturnValue('dark');
    mockUseAuth.mockReturnValue(authResult({ status: 'restoring' }));
    await render(<RootScreen />);
    expect(screen.getByText('Loading…')).toHaveStyle({ color: '#cbd5e1' });
  });

  it('shows the login screen when unauthenticated, including errors', async () => {
    mockUseAuth.mockReturnValue(
      authResult({
        status: 'unauthenticated',
        error: 'Only http:// and https:// servers are supported.',
      }),
    );
    await render(<RootScreen />);
    expect(screen.getByText('Connect to Nextcloud')).toBeDefined();
    expect(screen.getByText('Only http:// and https:// servers are supported.')).toBeDefined();
  });

  it('shows the waiting state while authenticating and forwards cancellation', async () => {
    const cancel = jest.fn();
    mockUseAuth.mockReturnValue(authResult({ status: 'authenticating', cancel }));
    await render(<RootScreen />);
    expect(screen.getByText('Waiting for the login to finish…')).toBeDefined();
    await fireEvent.press(screen.getByLabelText('Cancel login'));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('shows the connected view and forwards logout', async () => {
    const logout = jest.fn();
    mockUseAuth.mockReturnValue(authResult({ status: 'authenticated', session: SESSION, logout }));
    await render(<RootScreen />);
    expect(screen.getByText('Connected')).toBeDefined();
    expect(screen.getByText(SESSION.serverUrl)).toBeDefined();
    expect(screen.getByText(SESSION.loginName)).toBeDefined();
    expect(screen.queryByText(/Hello World/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Log out'));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
