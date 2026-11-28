import { selectSmartTasks, type ListedTask } from '@/features/tasks/smart-views';
import { parseVTodoResource } from '@/services/caldav/vtodo';

function item(title: string, ...properties: string[]): ListedTask {
  const url = 'https://example.test/lists/test/';
  return {
    calendar: {
      url,
      displayName: 'Test',
      components: ['VTODO'],
      isTaskList: true,
      ownerUrl: null,
      isOwned: true,
      isSharedWithMe: false,
      sharedAddresses: [],
      canRead: true,
      canWrite: true,
    },
    task: {
      url: `${url}${title}.ics`,
      etag: '"1"',
      resource: parseVTodoResource(
        [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'BEGIN:VTODO',
          `UID:${title}`,
          `SUMMARY:${title}`,
          ...properties,
          'END:VTODO',
          'END:VCALENDAR',
          '',
        ].join('\r\n'),
      ),
    },
  };
}

const now = new Date(2026, 10, 27, 12);
const overdue = item('Overdue', 'DUE;VALUE=DATE:20261126');
const starts = item('Starts', 'DTSTART;TZID=Europe/Berlin:20261127T091500');
const later = item('Later', 'DUE:20261128T123000', 'PRIORITY:2');
const flagged = item('Flagged', 'PRIORITY:4');
const unset = item('Unset', 'PRIORITY:0');
const done = item('Done', 'STATUS:COMPLETED', 'DUE;VALUE=DATE:20261127', 'PRIORITY:1');
const tasks = [done, later, flagged, overdue, unset, starts];

it('shows overdue and starting-today tasks, without completed tasks', () => {
  expect(selectSmartTasks(tasks, 'Today', 'Date', now)).toEqual([overdue, starts]);
});

it('shows dated open tasks in Scheduled and priorities 1–4 in Important', () => {
  expect(selectSmartTasks(tasks, 'Scheduled', 'Date', now)).toEqual([overdue, starts, later]);
  expect(selectSmartTasks(tasks, 'Important', 'Priority', now)).toEqual([later, flagged]);
});

it('sorts All without mutating its input and puts completed tasks last', () => {
  expect(selectSmartTasks(tasks, 'All', 'Title', now)).toEqual([
    flagged,
    later,
    overdue,
    starts,
    unset,
    done,
  ]);
  expect(tasks[0]).toBe(done);
});

it('uses the device calendar day for UTC dates', () => {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('.000', '');
  const utc = item('UTC', `DTSTART:${stamp}`);
  expect(selectSmartTasks([utc], 'Today', 'Date', now)).toEqual([utc]);
});
