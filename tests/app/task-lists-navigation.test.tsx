import { userEvent } from '@testing-library/react-native';
import { renderRouter, screen, testRouter } from 'expo-router/testing-library';

import RootScreen from '@/app/index';
import ListsRoute from '@/app/lists';
import TasksRoute from '@/app/tasks';
import TaskEditorRoute from '@/app/task-editor';
import RootLayout from '@/app/_layout';
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

it('puts each task view on the stack so Back reveals the correct previous screen', async () => {
  jest.mocked(listTasks).mockResolvedValue([
    {
      url: 'https://cloud.example.com/tasks/milk.ics',
      etag: '"1"',
      resource: parseVTodoResource(
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:milk\r\nSUMMARY:Milk\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
      ),
    },
  ]);
  await renderRouter({
    _layout: RootLayout,
    index: RootScreen,
    lists: ListsRoute,
    tasks: TasksRoute,
    'task-editor': TaskEditorRoute,
  });
  const user = userEvent.setup();
  await user.press(screen.getByRole('link', { name: 'Open task lists' }));
  await user.press(screen.getByRole('button', { name: 'Open list Groceries' }));
  expect(screen).toHavePathname('/tasks');
  await user.press(await screen.findByRole('button', { name: 'Open Milk' }));
  expect(screen.getByRole('header', { name: 'Edit task' })).toBeOnTheScreen();
  expect(screen).toHavePathname('/task-editor');

  await testRouter.back('/tasks');
  expect(screen.getByRole('button', { name: 'Open Milk' })).toBeOnTheScreen();
  await testRouter.back('/lists');
  expect(screen.getByRole('header', { name: 'Task lists' })).toBeOnTheScreen();
  await testRouter.back('/');
  expect(screen.getByRole('header', { name: 'Connected' })).toBeOnTheScreen();
});
