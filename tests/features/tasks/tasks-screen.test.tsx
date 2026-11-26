import { fireEvent, render, screen } from '@testing-library/react-native';
import { TasksScreen } from '@/features/tasks/tasks-screen';
import * as service from '@/services/caldav';
import { parseVTodoResource } from '@/services/caldav/vtodo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uid' }));
jest.mock('expo-router', () => ({ usePreventRemove: jest.fn() }));
jest.mock('@/services/caldav', () => ({
  ...jest.requireActual('@/services/caldav'),
  listTasks: jest.fn(),
  createTask: jest.fn(),
  updateTask: jest.fn(),
  updateTaskRecurrence: jest.fn(),
}));

const session = { serverUrl: 'https://example.test', loginName: 'user', appPassword: 'mock' };
const calendar: service.CalDAVCalendar = {
  url: 'https://example.test/tasks/',
  displayName: 'Tasks',
  components: ['VTODO'],
  isTaskList: true,
  isOwned: true,
  isSharedWithMe: false,
  canRead: true,
  canWrite: true,
  ownerUrl: null,
  sharedAddresses: [],
};
const item = {
  url: `${calendar.url}item.ics`,
  etag: '"1"',
  resource: parseVTodoResource(
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:item\r\nSUMMARY:Buy milk\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
  ),
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(service.listTasks).mockResolvedValue([item]);
});

it('adds a task and reloads the list', async () => {
  jest.mocked(service.createTask).mockResolvedValue(item.url);
  await render(<TasksScreen session={session} calendar={calendar} onBack={jest.fn()} />);
  await screen.findByRole('button', { name: 'Open Buy milk' });
  await fireEvent.changeText(screen.getByLabelText('New task title'), '  New task  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Add task' }));
  expect(service.createTask).toHaveBeenCalledWith(
    session,
    calendar,
    'mock-uid',
    'New task',
    expect.any(Date),
    undefined,
  );
  expect(service.listTasks).toHaveBeenCalledTimes(2);
});

it('edits changed fields only and requires a refresh after a conflict', async () => {
  jest
    .mocked(service.updateTask)
    .mockRejectedValue(new service.CalDAVError('conflict', 'Refresh and try again.'));
  await render(<TasksScreen session={session} calendar={calendar} onBack={jest.fn()} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Open Buy milk' }));
  await fireEvent.changeText(screen.getByLabelText('Notes'), 'One carton');
  await fireEvent.press(screen.getByRole('button', { name: 'Save task' }));
  expect(service.updateTask).toHaveBeenCalledWith(
    session,
    calendar,
    item,
    { notes: 'One carton' },
    undefined,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh and try again.');
  expect(screen.queryByRole('button', { name: 'Save task' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Refresh tasks' }));
  expect(await screen.findByRole('button', { name: 'Open Buy milk' })).toBeOnTheScreen();
  expect(service.updateTask).toHaveBeenCalledTimes(1);
});

it('opens a read-only list without offering writes', async () => {
  await render(
    <TasksScreen
      session={session}
      calendar={{ ...calendar, canWrite: false }}
      onBack={jest.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
  await fireEvent.press(await screen.findByRole('button', { name: 'Open Buy milk' }));
  expect(screen.getByText('Read-only task')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Save task' })).toBeNull();
});

it('offers an accessible alternative to swiping for completion', async () => {
  jest.mocked(service.updateTask).mockResolvedValue(undefined);
  await render(<TasksScreen session={session} calendar={calendar} onBack={jest.fn()} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Actions for Buy milk' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Complete Buy milk' }));
  expect(service.updateTask).toHaveBeenCalledWith(
    session,
    calendar,
    item,
    { completed: true, at: expect.any(Date) },
    undefined,
  );
});
