import { render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/index';

describe('HomeScreen (Phase 0 baseline)', () => {
  it('renders the project name', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('my-nc-tasks')).toBeDefined();
  });

  it('renders the project tagline', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Offline-first task app for Nextcloud')).toBeDefined();
  });

  it('shows that this is the Phase 0 baseline', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Phase 0 baseline — tooling and CI setup')).toBeDefined();
  });
});
