import { userEvent } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';

import RootScreen from '@/app/index';
import ListsRoute from '@/app/lists';

jest.mock('@/features/auth/use-auth', () => ({
  useAuth: () => ({
    status: 'authenticated',
    session: {
      serverUrl: 'https://cloud.example.com',
      loginName: 'alice',
      appPassword: 'unused-test-value',
    },
  }),
}));

jest.mock('@/features/lists/use-lists', () => ({
  useLists: () => ({
    status: 'ready',
    owned: [],
    shared: [],
    isCreating: false,
  }),
}));

it('opens Task lists from the connected screen', async () => {
  const router = await renderRouter({ index: RootScreen, lists: ListsRoute });

  expect(router.getPathname()).toBe('/');
  const taskListsLink = screen.getByRole('link', { name: 'Open task lists' });
  expect(taskListsLink).toHaveStyle({ backgroundColor: '#2563eb' });
  expect(screen.getByText('Task lists')).toHaveStyle({ color: '#ffffff' });
  await userEvent.setup().press(taskListsLink);
  expect(router.getPathname()).toBe('/lists');
  expect(screen.getByRole('header', { name: 'Task lists' })).toBeOnTheScreen();
});
