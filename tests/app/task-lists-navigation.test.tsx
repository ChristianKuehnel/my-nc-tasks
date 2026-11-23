import { userEvent } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';

import HelloScreen from '@/app/hello';
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

it.each([
  ['Open task lists', '/lists', 'Task lists'],
  ['Open Hello World screen', '/hello', 'Hello from my-nc-tasks'],
])('navigates from the connected screen via %s', async (label, pathname, heading) => {
  const router = await renderRouter({ index: RootScreen, lists: ListsRoute, hello: HelloScreen });

  expect(router.getPathname()).toBe('/');
  await userEvent.setup().press(screen.getByLabelText(label));
  expect(router.getPathname()).toBe(pathname);
  expect(screen.getByRole('header', { name: heading })).toBeOnTheScreen();
});
