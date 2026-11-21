import { buildMkCalendarBody, createCalendar } from '@/services/caldav/collections';
import type { FetchLike } from '@/services/caldav/http';
import type { CalDAVCredentials } from '@/services/caldav/types';

const CREDENTIALS: CalDAVCredentials = {
  serverUrl: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'app__pw',
};

const HOME = 'https://cloud.example.com/remote.php/dav/calendars/alice/';

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

describe('buildMkCalendarBody', () => {
  it('builds a VTODO mkcalendar document with the display name', () => {
    const body = buildMkCalendarBody('Work');
    expect(body).toContain('<C:display-name>Work</C:display-name>');
    expect(body).toContain('<C:comp name="VTODO"/>');
    expect(body).toContain('mkcalendar');
  });

  it('escapes XML special characters in the display name', () => {
    const body = buildMkCalendarBody('A & B <draft>');
    expect(body).toContain('<C:display-name>A &amp; B &lt;draft&gt;</C:display-name>');
  });
});

describe('createCalendar', () => {
  it('sends MKCALENDAR to the home set and resolves the URL from Location', async () => {
    const fetchImpl: FetchLike = jest.fn(async (url, init) => {
      expect(url).toBe(HOME);
      expect(init?.method).toBe('MKCALENDAR');
      expect((init?.headers as Record<string, string>).Depth).toBe('0');
      expect(String(init?.body)).toContain('<C:display-name>Work</C:display-name>');
      return res(201, '', { Location: '/remote.php/dav/calendars/alice/work/' });
    });

    const result = await createCalendar(CREDENTIALS, HOME, 'Work', { fetchImpl });
    expect(result.url).toBe('https://cloud.example.com/remote.php/dav/calendars/alice/work/');
  });

  it('resolves an absolute Location directly', async () => {
    const fetchImpl: FetchLike = jest.fn(async () =>
      res(201, '', {
        Location: 'https://cloud.example.com/remote.php/dav/calendars/alice/work/',
      }),
    );
    const result = await createCalendar(CREDENTIALS, HOME, 'Work', { fetchImpl });
    expect(result.url).toBe('https://cloud.example.com/remote.php/dav/calendars/alice/work/');
  });

  it('rejects an empty (or whitespace-only) display name without a request', async () => {
    const fetchImpl: FetchLike = jest.fn();
    await expect(createCalendar(CREDENTIALS, HOME, '   ', { fetchImpl })).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps HTTP 400 (e.g. duplicate name) to bad_request', async () => {
    const fetchImpl: FetchLike = jest.fn(async () => res(400, '<error/>'));
    await expect(createCalendar(CREDENTIALS, HOME, 'Work', { fetchImpl })).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('fails when the server answers 201 without a Location header', async () => {
    const fetchImpl: FetchLike = jest.fn(async () => res(201, ''));
    await expect(createCalendar(CREDENTIALS, HOME, 'Work', { fetchImpl })).rejects.toMatchObject({
      code: 'server_error',
    });
  });
});
