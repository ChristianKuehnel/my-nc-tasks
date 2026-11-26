import { updateTaskRecurrence } from '@/services/caldav/tasks';
import type { CalDAVCalendar } from '@/services/caldav/types';
import {
  editTaskRecurrence,
  parseVTodoResource,
  readTaskRecurrence,
} from '@/services/caldav/vtodo';

function task(...lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VTODO',
    'UID:task',
    'DTSTART;VALUE=DATE:20261126',
    ...lines,
    'X-EXTENSION;X-FLAG=YES: keep this',
    'END:VTODO',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

describe('task recurrence', () => {
  it('adds, updates, and clears only the recurrence rule', () => {
    const original = task();
    expect(readTaskRecurrence(original)).toEqual({ kind: 'none' });
    const weekly = editTaskRecurrence(original, { frequency: 'WEEKLY', interval: 2 });
    expect(readTaskRecurrence(weekly)).toEqual({
      kind: 'simple',
      rule: { frequency: 'WEEKLY', interval: 2 },
    });
    const daily = editTaskRecurrence(weekly, { frequency: 'DAILY', interval: 1 });
    expect(daily).toBe(weekly.replace('FREQ=WEEKLY;INTERVAL=2', 'FREQ=DAILY;INTERVAL=1'));
    expect(editTaskRecurrence(daily, null)).toBe(original);
  });

  it('reads a folded rule and defaults its interval to one', () => {
    expect(readTaskRecurrence(task('RRULE:FREQ=YEAR\r\n LY'))).toEqual({
      kind: 'simple',
      rule: { frequency: 'YEARLY', interval: 1 },
    });
  });

  it.each([
    ['RRULE:FREQ=WEEKLY;BYDAY=MO,FR'],
    ['RRULE:FREQ=DAILY;COUNT=4'],
    ['RRULE:FREQ=DAILY;INTERVAL=0'],
    ['RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY'],
    ['RRULE:FREQ=DAILY', 'EXDATE;VALUE=DATE:20261127'],
    ['RECURRENCE-ID;VALUE=DATE:20261126'],
  ])('preserves an unsupported rule or exception: %s', (...lines) => {
    const source = task(...lines);
    expect(readTaskRecurrence(source)).toEqual({ kind: 'unsupported' });
    expect(() => editTaskRecurrence(source, null)).toThrow(/recurrence/i);
    expect(parseVTodoResource(source).serialize()).toBe(source);
  });

  it('rejects an invalid interval and recurrence without a start', () => {
    expect(() => editTaskRecurrence(task(), { frequency: 'MONTHLY', interval: 0 })).toThrow(
      /invalid/i,
    );
    const source = task().replace('DTSTART;VALUE=DATE:20261126\r\n', '');
    expect(readTaskRecurrence(source)).toEqual({ kind: 'unavailable' });
    expect(() => editTaskRecurrence(source, { frequency: 'MONTHLY', interval: 1 })).toThrow(
      /start/i,
    );
  });

  it('uses the captured revision and never retries a conflict', async () => {
    const credentials = {
      serverUrl: 'https://cloud.example.test',
      loginName: 'test',
      appPassword: 'mock',
    };
    const calendar: CalDAVCalendar = {
      url: `${credentials.serverUrl}/calendars/test/list/`,
      isTaskList: true,
      isOwned: true,
      isSharedWithMe: false,
      canRead: true,
      canWrite: true,
      components: ['VTODO'],
      displayName: 'Tasks',
      ownerUrl: null,
      sharedAddresses: [],
    };
    const item = {
      url: `${calendar.url}task.ics`,
      etag: '"one"',
      resource: parseVTodoResource(task()),
    };
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 412 }));
    const rule = { frequency: 'MONTHLY', interval: 1 } as const;
    await expect(
      updateTaskRecurrence(credentials, calendar, item, rule, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      item.url,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'If-Match': '"one"' }),
        body: expect.stringContaining('RRULE:FREQ=MONTHLY;INTERVAL=1'),
      }),
    );
    const advanced = { ...item, resource: parseVTodoResource(task('RRULE:FREQ=DAILY;COUNT=4')) };
    await expect(
      updateTaskRecurrence(credentials, calendar, advanced, rule, { fetchImpl }),
    ).rejects.toThrow(/advanced/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
