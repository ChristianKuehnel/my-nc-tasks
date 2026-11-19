import { fireEvent, render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/index';

describe('HomeScreen (Phase 0.5 Hello World)', () => {
  it('renders the greeting', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Hello from my-nc-tasks')).toBeDefined();
  });

  it('shows the initial counter state', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Not pressed yet')).toBeDefined();
  });

  it('increments the counter on button press', async () => {
    await render(<HomeScreen />);
    const button = screen.getByLabelText('Increment counter');
    await fireEvent.press(button);
    expect(screen.getByText('Pressed 1 time')).toBeDefined();
    await fireEvent.press(button);
    expect(screen.getByText('Pressed 2 times')).toBeDefined();
  });
});
