import { fireEvent, render, screen } from '@testing-library/react-native';
import { SmartTasksScreen } from '@/features/tasks/smart-tasks-screen';
import { discoverCalendars, listTasks, type CalDAVCalendar } from '@/services/caldav';
import { parseVTodoResource } from '@/services/caldav/vtodo';

jest.mock('@/services/caldav', () => ({
  discoverCalendars: jest.fn(),
  listTasks: jest.fn(),
}));

it('shows results from readable lists and retains the source when another list fails', async () => {
  const session = { serverUrl: 'https://example.test', loginName: 'user', appPassword: 'mock' };
  const calendar: CalDAVCalendar = {
    url: 'https://example.test/tasks/',
    displayName: 'Shared list',
    components: ['VTODO'],
    isTaskList: true,
    isOwned: false,
    isSharedWithMe: true,
    canRead: true,
    canWrite: false,
    ownerUrl: null,
    sharedAddresses: [],
  };
  const unavailable = { ...calendar, url: `${calendar.url}unavailable/` };
  const unreadable = { ...calendar, url: `${calendar.url}unreadable/`, canRead: false };
  const task = {
    url: `${calendar.url}task.ics`,
    etag: '"1"',
    resource: parseVTodoResource(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:task\r\nSUMMARY:Buy milk\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
    ),
  };
  jest.mocked(discoverCalendars).mockResolvedValue({
    homeSetUrl: session.serverUrl,
    davRootUrl: session.serverUrl,
    principalUrl: session.serverUrl,
    calendars: [calendar, unavailable, unreadable],
    capabilities: { sharing: false },
  });
  jest
    .mocked(listTasks)
    .mockResolvedValueOnce([task])
    .mockRejectedValueOnce(new Error('Unavailable'));

  const onOpen = jest.fn();
  await render(
    <SmartTasksScreen session={session} view="All" onBack={jest.fn()} onOpen={onOpen} />,
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Open Buy milk from Shared list' }),
  );

  expect(onOpen).toHaveBeenCalledWith({ task, calendar });
  expect(screen.getByRole('alert')).toHaveTextContent(/Some lists could not be loaded/);
  expect(listTasks).toHaveBeenCalledTimes(2);
  expect(listTasks).not.toHaveBeenCalledWith(session, unreadable);
});
