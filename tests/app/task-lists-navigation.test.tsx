import { userEvent } from '@testing-library/react-native';
import { renderRouter, screen, testRouter } from 'expo-router/testing-library';

import RootScreen from '@/app/index';
import ListsRoute from '@/app/lists';
import { listTasks } from '@/services/caldav';
import { parseVTodoResource } from '@/services/caldav/vtodo';

jest.mock('@/services/caldav', () => ({
  ...jest.requireActual('@/services/caldav'),
  listTasks: jest.fn(),
}));

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
    owned: [
      {
        url: 'https://cloud.example.com/tasks/',
        displayName: 'Groceries',
        canRead: true,
        canWrite: true,
      },
    ],
    shared: [],
    isCreating: false,
    getShares: () => [],
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

it('backs out of task details one level at a time without leaving the lists route', async () => {
  jest.mocked(listTasks).mockResolvedValue([
    {
      url: 'https://cloud.example.com/tasks/milk.ics',
      etag: '"1"',
      resource: parseVTodoResource(
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:milk\r\nSUMMARY:Milk\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
      ),
    },
  ]);
  await renderRouter({ index: RootScreen, lists: ListsRoute });
  const user = userEvent.setup();
  await user.press(screen.getByRole('link', { name: 'Open task lists' }));
  await user.press(screen.getByRole('button', { name: 'Open list Groceries' }));
  await user.press(await screen.findByRole('button', { name: 'Open Milk' }));
  expect(screen.getByRole('header', { name: 'Edit task' })).toBeOnTheScreen();

  await testRouter.back('/lists');
  expect(screen.getByRole('button', { name: 'Open Milk' })).toBeOnTheScreen();
  await testRouter.back('/lists');
  expect(screen.getByRole('header', { name: 'Task lists' })).toBeOnTheScreen();
  await testRouter.back('/');
  expect(screen.getByRole('header', { name: 'Connected' })).toBeOnTheScreen();
});
