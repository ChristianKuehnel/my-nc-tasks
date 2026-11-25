import { fireEvent, render, screen } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';

import { LoginScreen } from '@/features/auth/login-screen';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.defineProperty(Object.create(actual), 'useColorScheme', { value: jest.fn() });
});

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.mocked(useColorScheme).mockReturnValue('light');
  });

  it.each([
    ['light', '#111827', '#f8fafc', '#475569', '#b91c1c', '#ffffff'],
    ['dark', '#f8fafc', '#1e293b', '#cbd5e1', '#fca5a5', '#0f172a'],
  ] as const)(
    'styles the login form in %s mode',
    async (scheme, text, surface, muted, error, actionText) => {
      jest.mocked(useColorScheme).mockReturnValue(scheme);
      await render(
        <LoginScreen
          status="unauthenticated"
          error="Invalid server address"
          onLogin={jest.fn()}
          onCancel={jest.fn()}
        />,
      );

      expect(screen.getByText('Connect to Nextcloud')).toHaveStyle({ color: text });
      expect(screen.getByText('Server')).toHaveStyle({ color: text });
      expect(screen.getByText(/Tip: enter only/)).toHaveStyle({ color: muted });
      const input = screen.getByLabelText('Server URL');
      expect(input).toHaveStyle({ color: text, backgroundColor: surface });
      expect(input).toHaveProp('placeholderTextColor', muted);
      expect(screen.getByText('Invalid server address')).toHaveStyle({ color: error });
      await fireEvent.changeText(input, 'cloud.example.com');
      expect(screen.getByText('Continue')).toHaveStyle({ color: actionText });
    },
  );

  it('renders the server input and ignores the continue button while empty', async () => {
    const onLogin = jest.fn();
    await render(
      <LoginScreen status="unauthenticated" error={null} onLogin={onLogin} onCancel={jest.fn()} />,
    );
    expect(screen.getByText('Connect to Nextcloud')).toBeDefined();
    expect(screen.getByLabelText('Server URL')).toBeDefined();
    // The button is disabled while the input is empty: pressing it is a no-op.
    await fireEvent.press(screen.getByLabelText('Continue to login'));
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('calls onLogin with the entered server URL', async () => {
    const onLogin = jest.fn();
    await render(
      <LoginScreen status="unauthenticated" error={null} onLogin={onLogin} onCancel={jest.fn()} />,
    );
    await fireEvent.changeText(screen.getByLabelText('Server URL'), 'cloud.example.com');
    await fireEvent.press(screen.getByLabelText('Continue to login'));
    expect(onLogin).toHaveBeenCalledWith('cloud.example.com');
  });

  it('shows the error message', async () => {
    await render(
      <LoginScreen
        status="unauthenticated"
        error="Only http:// and https:// servers are supported."
        onLogin={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText('Only http:// and https:// servers are supported.')).toBeDefined();
  });

  it('shows the waiting state with a cancel action while authenticating', async () => {
    jest.mocked(useColorScheme).mockReturnValue('dark');
    const onCancel = jest.fn();
    await render(
      <LoginScreen status="authenticating" error={null} onLogin={jest.fn()} onCancel={onCancel} />,
    );
    expect(screen.getByText('Waiting for the login to finish…')).toHaveStyle({ color: '#f8fafc' });
    expect(screen.getByText('Cancel')).toHaveStyle({ color: '#f8fafc' });
    expect(screen.queryByLabelText('Server URL')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Cancel login'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
