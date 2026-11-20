import type { ReactNode } from 'react';

import { fireEvent, render, screen } from '@testing-library/react-native';

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
  });

  it('shows a loading state while the session is being restored', async () => {
    mockUseAuth.mockReturnValue(authResult({ status: 'restoring' }));
    await render(<RootScreen />);
    expect(screen.getByText('Loading…')).toBeDefined();
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
    await fireEvent.press(screen.getByLabelText('Log out'));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
