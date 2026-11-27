import { fireEvent, render, screen } from '@testing-library/react-native';
import { TasksScreen } from '@/features/tasks/tasks-screen';
import * as service from '@/services/caldav';
import { parseVTodoResource } from '@/services/caldav/vtodo';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'mock-uid' }));
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
  const onBack = jest.fn();
  const onEditorRefresh = jest.fn();
  await render(
    <TasksScreen
      session={session}
      calendar={calendar}
      task={item}
      onBack={onBack}
      onEditorRefresh={onEditorRefresh}
    />,
  );
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
  expect(onEditorRefresh).toHaveBeenCalledTimes(1);
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(service.updateTask).toHaveBeenCalledTimes(1);
});

it('refreshes tasks from a compact, labeled icon', async () => {
  await render(<TasksScreen session={session} calendar={calendar} onBack={jest.fn()} />);
  await screen.findByRole('button', { name: 'Open Buy milk' });
  const refresh = screen.getByRole('button', { name: 'Refresh tasks' });
  expect(refresh).toHaveTextContent('↻');
  expect(refresh).toHaveStyle({ width: 44, height: 44 });
  expect(screen.queryByText('Refresh tasks')).toBeNull();
  await fireEvent.press(refresh);
  expect(service.listTasks).toHaveBeenCalledTimes(2);
});

it('opens a read-only list without offering writes', async () => {
  const onOpenTask = jest.fn();
  await render(
    <TasksScreen
      session={session}
      calendar={{ ...calendar, canWrite: false }}
      onBack={jest.fn()}
      onOpenTask={onOpenTask}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
  const open = await screen.findByRole('button', { name: 'Open Buy milk' });
  expect(screen.getByRole('checkbox', { name: 'Buy milk', checked: false })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Actions for Buy milk' })).toBeNull();
  await fireEvent.press(open);
  expect(onOpenTask).toHaveBeenCalledWith(item);
  await render(
    <TasksScreen
      session={session}
      calendar={{ ...calendar, canWrite: false }}
      task={item}
      onBack={jest.fn()}
    />,
  );
  expect(screen.getByText('Read-only task')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Save task' })).toBeNull();
});

it('shows completion in the row and lets the circle complete or reopen the task', async () => {
  const completedItem = {
    ...item,
    etag: '"2"',
    resource: parseVTodoResource(
      item.resource.serialize().replace('END:VTODO', 'STATUS:COMPLETED\r\nEND:VTODO'),
    ),
  };
  jest.mocked(service.updateTask).mockResolvedValue(undefined);
  jest
    .mocked(service.listTasks)
    .mockResolvedValueOnce([item])
    .mockResolvedValueOnce([completedItem]);
  await render(<TasksScreen session={session} calendar={calendar} onBack={jest.fn()} />);
  const circle = await screen.findByRole('checkbox', { name: 'Complete Buy milk', checked: false });
  expect(screen.getByText('Buy milk')).toHaveStyle({ textDecorationLine: 'none' });
  expect(screen.queryByText('Open')).toBeNull();
  await fireEvent.press(circle);
  expect(service.updateTask).toHaveBeenCalledWith(
    session,
    calendar,
    item,
    { completed: true, at: expect.any(Date) },
    undefined,
  );
  const separator = await screen.findByRole('button', {
    name: 'Completed tasks (1)',
    expanded: false,
  });
  expect(screen.queryByRole('checkbox', { name: 'Reopen Buy milk' })).toBeNull();
  await fireEvent.press(separator);
  const checkedCircle = screen.getByRole('checkbox', {
    name: 'Reopen Buy milk',
    checked: true,
  });
  expect(screen.getByText('Buy milk')).toHaveStyle({ textDecorationLine: 'line-through' });
  expect(
    screen.getByRole('button', { name: 'Completed tasks (1)', expanded: true }),
  ).toBeOnTheScreen();
  await fireEvent.press(checkedCircle);
  expect(service.updateTask).toHaveBeenLastCalledWith(
    session,
    calendar,
    completedItem,
    { completed: false, at: expect.any(Date) },
    undefined,
  );
  expect(
    await screen.findByRole('checkbox', { name: 'Complete Buy milk', checked: false }),
  ).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Completed tasks (1)' })).toBeNull();
});

it('starts with completed tasks collapsed and shows the chevron for the next action', async () => {
  const done = {
    ...item,
    url: `${calendar.url}done.ics`,
    resource: parseVTodoResource(
      item.resource
        .serialize()
        .replace('UID:item', 'UID:done')
        .replace('SUMMARY:Buy milk', 'SUMMARY:Buy bread\r\nSTATUS:COMPLETED'),
    ),
  };
  jest.mocked(service.listTasks).mockResolvedValue([done, item]);
  await render(<TasksScreen session={session} calendar={calendar} onBack={jest.fn()} />);

  const open = await screen.findByRole('button', { name: 'Open Buy milk' });
  const collapsed = screen.getByRole('button', { name: 'Completed tasks (1)', expanded: false });
  expect(collapsed).toHaveTextContent(/⌄$/);
  expect(screen.queryByRole('button', { name: 'Open Buy bread' })).toBeNull();
  await fireEvent.press(collapsed);
  const separator = screen.getByRole('button', { name: 'Completed tasks (1)', expanded: true });
  expect(separator).toHaveTextContent(/⌃$/);
  const completed = screen.getByRole('button', { name: 'Open Buy bread' });
  expect(screen.getAllByRole('button', { name: /^(Open Buy|Completed tasks)/ })).toEqual([
    open,
    separator,
    completed,
  ]);
  await fireEvent.press(separator);
  expect(screen.queryByRole('button', { name: 'Open Buy bread' })).toBeNull();
  expect(open).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Completed tasks (1)', expanded: false }),
  ).toHaveTextContent(/⌄$/);
  expect(service.listTasks).toHaveBeenCalledTimes(1);
});

it('keeps deletion out of the row until the actions menu is opened', async () => {
  await render(<TasksScreen session={session} calendar={calendar} onBack={jest.fn()} />);
  const menu = await screen.findByRole('button', { name: 'Actions for Buy milk', expanded: false });
  expect(screen.queryByRole('button', { name: 'Delete Buy milk' })).toBeNull();
  await fireEvent.press(menu);
  expect(screen.getByRole('button', { name: 'Delete Buy milk' })).toBeOnTheScreen();
});
