import { fireEvent, render, screen } from '@testing-library/react-native';

import HelloScreen from '@/app/hello';

describe('HelloScreen (Phase 0.5, moved to /hello in Phase 1.1)', () => {
  it('renders the greeting', async () => {
    await render(<HelloScreen />);
    expect(screen.getByText('Hello from my-nc-tasks')).toBeDefined();
  });

  it('shows the initial counter state', async () => {
    await render(<HelloScreen />);
    expect(screen.getByText('Not pressed yet')).toBeDefined();
  });

  it('increments the counter on button press', async () => {
    await render(<HelloScreen />);
    const button = screen.getByLabelText('Increment counter');
    await fireEvent.press(button);
    expect(screen.getByText('Pressed 1 time')).toBeDefined();
    await fireEvent.press(button);
    expect(screen.getByText('Pressed 2 times')).toBeDefined();
  });
});
