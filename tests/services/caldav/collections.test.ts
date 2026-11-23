import { buildMkCalendarBody, calendarSlug, createCalendar } from '@/services/caldav/collections';
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
    expect(body).toContain('<D:set>');
    expect(body).toContain('<D:prop>');
    expect(body).toContain('<D:displayname>Work</D:displayname>');
    expect(body).toContain('<cal:comp name="VTODO"/>');
    expect(body).toContain('mkcalendar');
  });

  it('uses the RFC 4791 CalDAV namespace (not the legacy Apple namespace)', () => {
    const body = buildMkCalendarBody('Work');
    expect(body).toContain('xmlns:cal="urn:ietf:params:xml:ns:caldav"');
    expect(body).toContain('<cal:mkcalendar ');
    expect(body).not.toContain('calendarserver.org');
  });

  it('escapes XML special characters in the display name', () => {
    const body = buildMkCalendarBody('A & B <draft>');
    expect(body).toContain('<D:displayname>A &amp; B &lt;draft&gt;</D:displayname>');
  });
});

describe('calendarSlug', () => {
  it('lowercases and keeps unicode letters and digits', () => {
    expect(calendarSlug('Work')).toBe('work');
    expect(calendarSlug('Übung & Test')).toBe('übung-test');
    expect(calendarSlug('Liste 2026')).toBe('liste-2026');
  });

  it('collapses non-word characters into single hyphens and trims edges', () => {
    expect(calendarSlug('My  List!')).toBe('my-list');
    expect(calendarSlug('  //draft//  ')).toBe('draft');
  });

  it('returns an empty string when no usable characters remain', () => {
    expect(calendarSlug('!!!')).toBe('');
    expect(calendarSlug('   ')).toBe('');
  });
});

describe('createCalendar', () => {
  it('sends MKCALENDAR to the new calendar URL and uses it as the result', async () => {
    const target = 'https://cloud.example.com/remote.php/dav/calendars/alice/work/';
    const fetchImpl: FetchLike = jest.fn(async (url, init) => {
      expect(url).toBe(target);
      expect(init?.method).toBe('MKCALENDAR');
      expect((init?.headers as Record<string, string>).Depth).toBe('0');
      expect(String(init?.body)).toContain('<D:displayname>Work</D:displayname>');
      // SabreDAV/Nextcloud answer 201 without a Location header.
      return res(201);
    });

    const result = await createCalendar(CREDENTIALS, HOME, 'Work', { fetchImpl });
    expect(result.url).toBe(target);
  });

  it('encodes a Unicode slug while preserving the display name', async () => {
    const target = `${HOME}%C3%BCbung-2026/`;
    const fetchImpl: FetchLike = jest.fn(async (url, init) => {
      expect(url).toBe(target);
      expect(init?.body).toContain('<D:displayname>Übung 2026!</D:displayname>');
      return res(201);
    });

    const result = await createCalendar(CREDENTIALS, HOME, 'Übung 2026!', { fetchImpl });
    expect(result.url).toBe(target);
  });

  it('lets a Location header win over the requested URL', async () => {
    const fetchImpl: FetchLike = jest.fn(async () => res(201, '', { Location: '../renamed/' }));
    const result = await createCalendar(CREDENTIALS, HOME, 'Work', { fetchImpl });
    expect(result.url).toBe('https://cloud.example.com/remote.php/dav/calendars/alice/renamed/');
  });

  it('accepts a home set URL without a trailing slash', async () => {
    const fetchImpl: FetchLike = jest.fn(async (url) => {
      expect(url).toBe('https://cloud.example.com/remote.php/dav/calendars/alice/work/');
      return res(201);
    });
    const homeNoSlash = HOME.replace(/\/$/, '');
    await createCalendar(CREDENTIALS, homeNoSlash, 'Work', { fetchImpl });
  });

  it('rejects an empty (or whitespace-only) display name without a request', async () => {
    const fetchImpl: FetchLike = jest.fn();
    await expect(createCalendar(CREDENTIALS, HOME, '   ', { fetchImpl })).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a name without usable URL characters without a request', async () => {
    const fetchImpl: FetchLike = jest.fn();
    await expect(createCalendar(CREDENTIALS, HOME, '!!!', { fetchImpl })).rejects.toMatchObject({
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

  it('does not treat an unexpected 2xx as calendar creation', async () => {
    const fetchImpl: FetchLike = jest.fn(async () => res(200));
    await expect(createCalendar(CREDENTIALS, HOME, 'Work', { fetchImpl })).rejects.toMatchObject({
      code: 'server_error',
    });
  });
});
