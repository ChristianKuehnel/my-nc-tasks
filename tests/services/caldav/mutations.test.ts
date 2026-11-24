import {
  buildPropPatchBody,
  renameCalendar,
  deleteCalendar,
  unsubscribeCalendar,
  NO_TRASHBIN_HEADER,
} from '@/services/caldav/mutations';
import { CalDAVError } from '@/services/caldav/http';
import type { CalDAVCredentials } from '@/services/caldav/types';

const CREDENTIALS: CalDAVCredentials = {
  serverUrl: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'app__pw',
};

const CALENDAR_URL = 'https://cloud.example.com/remote.php/dav/calendars/alice/tasks/';

function res(status: number, body = '', headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name] ?? null,
      forEach: (cb: (value: string, key: string) => void) => {
        for (const [key, value] of Object.entries(headers)) {
          cb(value, key);
        }
      },
    },
    text: async () => body,
  } as unknown as Response;
}

function multistatus(propStatus: number, property = 'displayname'): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<D:multistatus xmlns:D="DAV:">` +
    `<D:response>` +
    `<D:href>/remote.php/dav/calendars/alice/tasks/</D:href>` +
    `<D:propstat>` +
    `<D:prop><D:${property}/></D:prop>` +
    `<D:status>HTTP/1.1 ${propStatus} OK</D:status>` +
    `</D:propstat>` +
    `</D:response>` +
    `</D:multistatus>`
  );
}

describe('buildPropPatchBody', () => {
  it('builds a PROPPATCH body setting displayname', () => {
    const body = buildPropPatchBody('My Tasks');
    expect(body).toContain('<D:displayname>My Tasks</D:displayname>');
    expect(body).toContain('<D:propertyupdate');
    expect(body).toContain('<D:set>');
  });

  it('escapes XML special characters in the name', () => {
    const body = buildPropPatchBody('A & B <C>');
    expect(body).toContain('A &amp; B &lt;C&gt;');
  });
});

describe('renameCalendar', () => {
  it('sends a PROPPATCH and accepts a 207 with a 200 propstat', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(207, multistatus(200)));
    await renameCalendar(CREDENTIALS, CALENDAR_URL, 'New Name', {
      fetchImpl: fetchMock as any,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CALENDAR_URL);
    expect(init.method).toBe('PROPPATCH');
    expect(init.body).toContain('<D:displayname>New Name</D:displayname>');
  });

  it('throws forbidden when the propstat reports 403', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(207, multistatus(403)));
    await expect(
      renameCalendar(CREDENTIALS, CALENDAR_URL, 'New Name', {
        fetchImpl: fetchMock as any,
      }),
    ).rejects.toThrow(CalDAVError);
  });

  it('throws not_found when the propstat reports 404', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(207, multistatus(404)));
    await expect(
      renameCalendar(CREDENTIALS, CALENDAR_URL, 'New Name', {
        fetchImpl: fetchMock as any,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('throws a CalDAVError with code bad_request for an empty name', async () => {
    await expect(renameCalendar(CREDENTIALS, CALENDAR_URL, '   ')).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('throws network error when the request fails', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      renameCalendar(CREDENTIALS, CALENDAR_URL, 'New Name', {
        fetchImpl: fetchMock as any,
      }),
    ).rejects.toMatchObject({ code: 'network' });
  });
});

describe('deleteCalendar', () => {
  it('sends a DELETE with the no-trashbin header', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(204));
    await deleteCalendar(CREDENTIALS, CALENDAR_URL, {
      fetchImpl: fetchMock as any,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CALENDAR_URL);
    expect(init.method).toBe('DELETE');
    expect(init.headers['X-NC-CalDAV-No-Trashbin']).toBe('1');
  });

  it('throws forbidden on 403', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(403));
    await expect(
      deleteCalendar(CREDENTIALS, CALENDAR_URL, { fetchImpl: fetchMock as any }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('throws network error when the request fails', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      deleteCalendar(CREDENTIALS, CALENDAR_URL, { fetchImpl: fetchMock as any }),
    ).rejects.toMatchObject({ code: 'network' });
  });
});

describe('unsubscribeCalendar', () => {
  it('sends a plain DELETE (no trashbin header)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(204));
    await unsubscribeCalendar(CREDENTIALS, CALENDAR_URL, {
      fetchImpl: fetchMock as any,
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('DELETE');
    // No trashbin header for unsubscribe — it should use the default unshare path.
    expect(init.headers['X-NC-CalDAV-No-Trashbin']).toBeUndefined();
  });

  it('throws forbidden on 403', async () => {
    const fetchMock = jest.fn().mockResolvedValue(res(403));
    await expect(
      unsubscribeCalendar(CREDENTIALS, CALENDAR_URL, {
        fetchImpl: fetchMock as any,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('NO_TRASHBIN_HEADER', () => {
  it('is the expected header value', () => {
    expect(NO_TRASHBIN_HEADER).toEqual({ 'X-NC-CalDAV-No-Trashbin': '1' });
  });
});
