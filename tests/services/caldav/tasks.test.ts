import { createTask, deleteTask, listTasks, readTask, updateTask } from '@/services/caldav/tasks';
import type { CalDAVCalendar } from '@/services/caldav/types';
import { parseVTodoResource } from '@/services/caldav/vtodo';

const credentials = {
  serverUrl: 'https://cloud.example.test',
  loginName: 'user',
  appPassword: 'mock',
};
const calendar: CalDAVCalendar = {
  url: `${credentials.serverUrl}/calendars/user/tasks/`,
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
const at = new Date('2026-11-25T10:30:00Z');
const url = `${calendar.url}task.ics`;
const alarm = 'BEGIN:VALARM\r\nDESCRIPTION:Alarm\r\nX-EXTENSION:opaque\r\nEND:VALARM\r\n';
const source = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:task\r\nSUMMARY;LANGUAGE=en:Old\r\nSTATUS:NEEDS-ACTION\r\nX-UNKNOWN:keep  \r\n${alarm}END:VTODO\r\nEND:VCALENDAR\r\n`;
const task = { url, etag: '"one"', resource: parseVTodoResource(source) };

describe('task CRUD', () => {
  it('queries VTODO and reads the original resource and revision', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/calendars/user/tasks/task.ics</d:href></d:response></d:multistatus>',
          { status: 207 },
        ),
      )
      .mockResolvedValueOnce(new Response(source, { headers: { ETag: '"one"' } }));
    const [item] = await listTasks(credentials, calendar, { fetchImpl });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      calendar.url,
      expect.objectContaining({
        method: 'REPORT',
        body: expect.stringContaining('name="VTODO"'),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(2, url, expect.objectContaining({ method: 'GET' }));
    expect(item.etag).toBe('"one"');
    expect(item.resource.serialize()).toBe(source);
  });

  it('creates with an if-absent precondition and calendar content type', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 201 }));
    expect(await createTask(credentials, calendar, 'task', 'Title', at, { fetchImpl })).toBe(url);
    expect(fetchImpl).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'If-None-Match': '*',
          'Content-Type': 'text/calendar; charset=utf-8',
        }),
        body: expect.stringContaining('SUMMARY:Title\r\n'),
      }),
    );
  });

  it('edits only the requested fields and uses the revision read with the resource', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await updateTask(credentials, calendar, task, { summary: 'New, summary' }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'If-Match': '"one"' }),
        body: source.replace('SUMMARY;LANGUAGE=en:Old', 'SUMMARY;LANGUAGE=en:New\\, summary'),
      }),
    );
  });

  it('completes and reopens without touching unknown fields or alarms', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await updateTask(credentials, calendar, task, { completed: true, at }, { fetchImpl });
    const completed = fetchImpl.mock.calls[0][1].body as string;
    expect(completed).toContain('COMPLETED:20261125T103000Z\r\n');
    expect(completed).toContain('PERCENT-COMPLETE:100\r\n');
    expect(parseVTodoResource(completed).occurrences[0].completed).toBe(true);
    await updateTask(
      credentials,
      calendar,
      { ...task, etag: '"two"', resource: parseVTodoResource(completed) },
      { completed: false, at },
      { fetchImpl },
    );
    const reopened = fetchImpl.mock.calls[1][1].body as string;
    expect(reopened).not.toContain('COMPLETED:');
    expect(reopened).toContain('PERCENT-COMPLETE:0\r\n');
    expect(reopened).toContain('X-UNKNOWN:keep  \r\n');
    expect(reopened).toContain(alarm);
    expect(parseVTodoResource(reopened).occurrences[0].completed).toBe(false);
  });

  it('does not retry a stale delete', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 412 }));
    await expect(deleteTask(credentials, calendar, task, { fetchImpl })).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ 'If-Match': '"one"' }),
      }),
    );
  });

  it('surfaces server-side write denial', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      updateTask(credentials, calendar, task, { summary: 'Change' }, { fetchImpl }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it.each(['https://elsewhere.example.test/task.ics', '../other/task.ics', 'nested%2Ftask.ics'])(
    'refuses out-of-list URL %s',
    async (href) => {
      const fetchImpl = jest.fn();
      await expect(readTask(credentials, calendar, href, { fetchImpl })).rejects.toMatchObject({
        code: 'bad_request',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('blocks read-only writes, weak or absent revisions, and recurrence mutations before making a request', async () => {
    const fetchImpl = jest.fn();
    const deps = { fetchImpl };
    await expect(
      createTask(credentials, { ...calendar, canWrite: false }, 'a', 'Title', at, deps),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      deleteTask(credentials, calendar, { ...task, etag: 'W/"weak"' }, deps),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      updateTask(credentials, calendar, { ...task, etag: null }, { summary: 'No' }, deps),
    ).rejects.toMatchObject({ code: 'conflict' });
    const recurring = {
      ...task,
      resource: parseVTodoResource(source.replace('STATUS:NEEDS-ACTION', 'RRULE:FREQ=DAILY')),
    };
    await expect(
      updateTask(credentials, calendar, recurring, { summary: 'No' }, deps),
    ).rejects.toThrow(/recurring/i);
    await expect(deleteTask(credentials, calendar, recurring, deps)).rejects.toThrow(/recurring/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
