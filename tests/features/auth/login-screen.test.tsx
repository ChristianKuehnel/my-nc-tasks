import { fireEvent, render, screen } from '@testing-library/react-native';

import { LoginScreen } from '@/features/auth/login-screen';

describe('LoginScreen', () => {
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
    const onCancel = jest.fn();
    await render(
      <LoginScreen status="authenticating" error={null} onLogin={jest.fn()} onCancel={onCancel} />,
    );
    expect(screen.getByText('Waiting for the login to finish…')).toBeDefined();
    expect(screen.queryByLabelText('Server URL')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Cancel login'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
