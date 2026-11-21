import { discoverCalendars } from '@/services/caldav/discovery';
import type { FetchLike } from '@/services/caldav/http';
import type { CalDAVCredentials } from '@/services/caldav/types';

const B = 'https://cloud.example.com';
const WELL_KNOWN = `${B}/.well-known/carddav/`;
const DAV_ROOT = `${B}/remote.php/dav/`;
const PRINCIPAL = `${B}/remote.php/dav/principals/users/alice/`;
const HOME = `${B}/remote.php/dav/calendars/alice/`;

const CREDENTIALS: CalDAVCredentials = {
  serverUrl: B,
  loginName: 'alice',
  appPassword: 'app__pw',
};

function res(status: number, body = '', headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => body,
  } as unknown as Response;
}

/** Build a DAV:multistatus document from response entry blocks. */
function ms(...entries: string[]): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="http://calendarserver.org/ns/">${entries.join(
    '',
  )}</d:multistatus>`;
}

function entry(href: string, prop: string): string {
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

const CUR = (uri: string) => `<d:cur uri="${uri}"/>`;
const DISPLAY = (name: string) => `<d:displayname>${name}</d:displayname>`;
const OWNER = (href: string) => `<d:owner><d:href>${href}</d:href></d:owner>`;
const PRIV = (uri: string, name: string) =>
  `<d:privilege><d:privilege-displayname>${name}</d:privilege-displayname><d:privilege-uri>${uri}</d:privilege-uri></d:privilege>`;
const PRIVSET = (uris: Array<[uri: string, name: string]>): string =>
  `<d:current-user-privilege-set>${uris.map(([u, n]) => PRIV(u, n)).join('')}</d:current-user-privilege-set>`;
const COMPS = (...names: string[]) =>
  `<c:supported-calendar-component-set>${names.map((n) => `<c:comp name="${n}"/>`).join('')}</c:supported-calendar-component-set>`;
const ADDRS = (...addrs: string[]) =>
  `<c:calendar-user-address-set>${addrs.map((a) => `<c:addr>${a}</c:addr>`).join('')}</c:calendar-user-address-set>`;

const OWNERED = OWNER('/remote.php/dav/principals/users/alice/');
const READ_WRITE = PRIVSET([
  ['DAV:read', 'Read'],
  ['DAV:write', 'Write'],
]);
const READ_ONLY = PRIVSET([
  ['DAV:read', 'Read'],
  ['urn:ietf:params:xml:ns:caldav:read-free-busy', 'Read Free/Busy'],
]);

/** Principal probe response (as returned by the .well-known target). */
const PRINCIPAL_PROBE_BODY = ms(
  entry(
    '/remote.php/dav/principals/users/alice/',
    `<d:current-user-principal>${CUR(PRINCIPAL)}</d:current-user-principal>` +
      `<c:calendar-home-set><d:href>/remote.php/dav/calendars/alice/</d:href></c:calendar-home-set>`,
  ),
);

/** Home set listing: home set + 2 owned calendars + 1 shared read-only list. */
const HOME_LISTING_BODY = ms(
  entry('/remote.php/dav/calendars/alice/', OWNERED),
  entry(
    '/remote.php/dav/calendars/alice/tasks/',
    DISPLAY('Tasks') + OWNERED + READ_WRITE + COMPS('VTODO'),
  ),
  entry(
    '/remote.php/dav/calendars/alice/events/',
    DISPLAY('Events') + OWNERED + READ_WRITE + COMPS('VEVENT'),
  ),
  entry(
    '/remote.php/dav/calendars/bob/shared/',
    DISPLAY("Bob's Tasks") +
      OWNER('/remote.php/dav/principals/users/bob/') +
      READ_ONLY +
      COMPS('VTODO') +
      ADDRS('mailto:alice@example.com', 'mailto:bob@example.com'),
  ),
);

/** Route map keyed by exact request URL; unexpected URLs fail the test. */
function router(routes: Record<string, Response>): FetchLike {
  const mock = jest.fn(async (url: string) => {
    const route = routes[url];
    if (!route) {
      throw new Error(`Unexpected request: ${url}`);
    }
    return route;
  });
  return mock as unknown as FetchLike;
}

describe('discoverCalendars', () => {
  it('discovers principal, home set and calendars via the .well-known redirect', async () => {
    const fetchImpl = router({
      [WELL_KNOWN]: res(302, '', { Location: '/remote.php/dav/principals/users/alice/' }),
      [PRINCIPAL]: res(207, PRINCIPAL_PROBE_BODY),
      [HOME]: res(207, HOME_LISTING_BODY),
    });

    const result = await discoverCalendars(CREDENTIALS, { fetchImpl });

    expect(result.principalUrl).toBe(PRINCIPAL);
    expect(result.homeSetUrl).toBe(HOME);
    expect(result.calendars).toHaveLength(3);

    const [tasks, events, shared] = result.calendars;
    expect(tasks.displayName).toBe('Tasks');
    expect(tasks.isTaskList).toBe(true);
    expect(tasks.isOwned).toBe(true);
    expect(tasks.isSharedWithMe).toBe(false);
    expect(tasks.canRead).toBe(true);
    expect(tasks.canWrite).toBe(true);

    expect(events.displayName).toBe('Events');
    expect(events.components).toEqual(['VEVENT']);
    expect(events.isTaskList).toBe(false);

    expect(shared.displayName).toBe("Bob's Tasks");
    expect(shared.isTaskList).toBe(true);
    expect(shared.isOwned).toBe(false);
    expect(shared.isSharedWithMe).toBe(true);
    expect(shared.ownerUrl).toBe(`${B}/remote.php/dav/principals/users/bob/`);
    expect(shared.canRead).toBe(true);
    expect(shared.canWrite).toBe(false);
    expect(shared.sharedAddresses).toEqual(['mailto:alice@example.com', 'mailto:bob@example.com']);
  });

  it('falls back to the DAV collection root when .well-known is unavailable', async () => {
    const fetchImpl = router({
      [WELL_KNOWN]: res(404),
      [DAV_ROOT]: res(207, PRINCIPAL_PROBE_BODY),
      [HOME]: res(207, HOME_LISTING_BODY),
    });

    const result = await discoverCalendars(CREDENTIALS, { fetchImpl });

    expect(result.principalUrl).toBe(PRINCIPAL);
    expect(result.calendars).toHaveLength(3);
  });

  it.each([
    ['unauthorized', 401],
    ['forbidden', 403],
  ])('aborts with %s when the .well-known probe returns HTTP %i', async (code, status) => {
    const fetchImpl = router({
      [WELL_KNOWN]: res(status),
    });

    await expect(discoverCalendars(CREDENTIALS, { fetchImpl })).rejects.toMatchObject({
      code,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails with not_found when neither .well-known nor the DAV root resolves', async () => {
    const fetchImpl = router({
      [WELL_KNOWN]: res(404),
      [DAV_ROOT]: res(404),
    });

    await expect(discoverCalendars(CREDENTIALS, { fetchImpl })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('fails on a malformed home set document', async () => {
    const fetchImpl = router({
      [WELL_KNOWN]: res(302, '', { Location: PRINCIPAL }),
      [PRINCIPAL]: res(207, PRINCIPAL_PROBE_BODY),
      [HOME]: res(207, 'this is not xml'),
    });

    await expect(discoverCalendars(CREDENTIALS, { fetchImpl })).rejects.toThrow(
      /DAV XML|multistatus/,
    );
  });

  it('probes the principal for the home set when the root probe omits it', async () => {
    const probeWithoutHome = ms(
      entry(
        '/remote.php/dav/',
        `<d:current-user-principal>${CUR(PRINCIPAL)}</d:current-user-principal>`,
      ),
    );
    const fetchImpl = router({
      [WELL_KNOWN]: res(404),
      [DAV_ROOT]: res(207, probeWithoutHome),
      [PRINCIPAL]: res(207, PRINCIPAL_PROBE_BODY),
      [HOME]: res(207, HOME_LISTING_BODY),
    });

    const result = await discoverCalendars(CREDENTIALS, { fetchImpl });
    expect(result.homeSetUrl).toBe(HOME);
    expect(fetchImpl).toHaveBeenCalledWith(PRINCIPAL, expect.anything());
  });
});
