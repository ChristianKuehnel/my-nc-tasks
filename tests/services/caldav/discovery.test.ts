import { discoverCalendars, parseDavFeatures, davRootUrl } from '@/services/caldav/discovery';
import type { FetchLike } from '@/services/caldav/http';
import type { CalDAVCredentials } from '@/services/caldav/types';
import { changeListTrashState } from '@/services/caldav/trash';

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

/** Build a DAV:multistatus document from response entry blocks. */
function ms(...entries: string[]): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:nc="http://nextcloud.com/ns">${entries.join(
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
    ['nc-calendar-trashbin', '2592000', true],
    ['nc-calendar-trashbin', '0', false],
    ['nc-calendar-trashbin', '', false],
    ['1', '2592000', false],
  ])('gates Trash by DAV feature %s and retention %s', async (dav, seconds, supported) => {
    const deleted = '<d:resourcetype><d:collection/><nc:deleted-calendar/></d:resourcetype>';
    const fetchImpl = router({
      [WELL_KNOWN]: res(207, PRINCIPAL_PROBE_BODY),
      [HOME]: res(
        207,
        ms(
          entry(
            `${HOME}trashbin/`,
            '<d:resourcetype><nc:trash-bin/></d:resourcetype>' +
              `<nc:trash-bin-retention-duration>${seconds}</nc:trash-bin-retention-duration>`,
          ),
          entry(`${HOME}old/`, OWNERED + deleted + COMPS('VTODO')),
          entry(`${HOME}shared/`, OWNER('/principals/users/bob/') + deleted + COMPS('VTODO')),
          entry(`${HOME}events/`, OWNERED + deleted + COMPS('VEVENT')),
          entry(`${HOME}active/`, OWNERED + COMPS('VTODO')),
        ),
        { DAV: dav },
      ),
    });

    const result = await discoverCalendars(CREDENTIALS, { fetchImpl });
    expect(result.calendars.map(({ url }) => url)).toEqual([`${HOME}active/`]);
    expect(result.trash?.lists.map(({ url }) => url)).toEqual(
      supported ? [`${HOME}old/`] : undefined,
    );
  });

  it('omits trashed owned and shared calendars but keeps an active read-only share', async () => {
    const trashed =
      '<d:resourcetype><d:collection/><nc:deleted-calendar/></d:resourcetype>' +
      COMPS('VEVENT', 'VTODO', 'VJOURNAL');
    const otherOwner = OWNER('/remote.php/dav/principals/users/bob/');
    const fetchImpl = router({
      [WELL_KNOWN]: res(207, PRINCIPAL_PROBE_BODY),
      [HOME]: res(
        207,
        ms(
          entry('/remote.php/dav/calendars/alice/', OWNERED),
          entry(`${HOME}trashed/`, OWNERED + READ_WRITE + trashed),
          entry(`${HOME}trashed_shared_by_bob/`, otherOwner + READ_ONLY + trashed),
          entry(
            `${HOME}test-list_shared_by_bob/`,
            '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>' +
              DISPLAY('Test list (Bob)') +
              otherOwner +
              '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege>' +
              '<d:privilege><d:write-properties/></d:privilege></d:current-user-privilege-set>' +
              COMPS('VTODO'),
          ),
        ),
      ),
    });

    const { calendars } = await discoverCalendars(CREDENTIALS, { fetchImpl });

    expect(calendars).toMatchObject([
      {
        url: `${HOME}test-list_shared_by_bob/`,
        displayName: 'Test list (Bob)',
        isTaskList: true,
        isOwned: false,
        isSharedWithMe: true,
        canRead: true,
        canWrite: false,
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      HOME,
      expect.objectContaining({ body: expect.stringContaining('<D:resourcetype') }),
    );
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

  describe('server compatibility fallbacks', () => {
    // Mirrors the behavior of newer SabreDAV/Nextcloud deployments:
    // `current-user-principal` is a relative DAV href and neither the
    // root nor the principal reports a `calendar-home-set`.
    const REL_PRINCIPAL_HREF = '/remote.php/dav/principals/users/alice/';
    const probeNoHomeSet = ms(
      entry(
        '/remote.php/dav/',
        `<d:current-user-principal><d:href>${REL_PRINCIPAL_HREF}</d:href></d:current-user-principal>`,
      ),
    );

    it('derives the home set from the principal when calendar-home-set is absent', async () => {
      // HOME_LISTING_BODY doubles as the ownership-verification response
      // (Depth: 0) and the listing (Depth: 1): its home-set entry carries
      // the owner, and the listing filters that entry out.
      const fetchImpl = router({
        [WELL_KNOWN]: res(404),
        [DAV_ROOT]: res(207, probeNoHomeSet),
        [PRINCIPAL]: res(207, probeNoHomeSet),
        [HOME]: res(207, HOME_LISTING_BODY),
      });

      const result = await discoverCalendars(CREDENTIALS, { fetchImpl });
      expect(result.principalUrl).toBe(PRINCIPAL);
      expect(result.homeSetUrl).toBe(HOME);
      expect(result.calendars).toHaveLength(3);
    });

    it('rejects a derived home set that is not owned by the current user', async () => {
      const foreignOwner = ms(
        entry('/remote.php/dav/calendars/alice/', OWNER('/remote.php/dav/principals/users/eve/')),
      );
      const fetchImpl = router({
        [WELL_KNOWN]: res(404),
        [DAV_ROOT]: res(207, probeNoHomeSet),
        [PRINCIPAL]: res(207, probeNoHomeSet),
        [HOME]: res(207, foreignOwner),
      });

      await expect(discoverCalendars(CREDENTIALS, { fetchImpl })).rejects.toThrow(
        /not owned by the current user/,
      );
    });

    it('maps a principal:// URI from the root probe onto the DAV root', async () => {
      const probePrincipalUri = ms(
        entry(
          '/remote.php/dav/',
          `<d:current-user-principal><d:href>principal://cloud.example.com/#principals/users/alice</d:href></d:current-user-principal>`,
        ),
      );
      const fetchImpl = router({
        [WELL_KNOWN]: res(404),
        [DAV_ROOT]: res(207, probePrincipalUri),
        [PRINCIPAL]: res(207, PRINCIPAL_PROBE_BODY),
        [HOME]: res(207, HOME_LISTING_BODY),
      });

      const result = await discoverCalendars(CREDENTIALS, { fetchImpl });
      expect(result.principalUrl).toBe(PRINCIPAL);
      expect(result.homeSetUrl).toBe(HOME);
      expect(result.calendars).toHaveLength(3);
    });

    it('parses privileges in the child-element flavor (no privilege-uri)', async () => {
      // Newer SabreDAV/Nextcloud: <privilege><write/></privilege> instead
      // of <privilege><privilege-uri>DAV:write</privilege-uri></privilege>.
      const childPriv = (names: string[]) =>
        `<d:current-user-privilege-set>${names.map((n) => `<d:privilege><${n}/></d:privilege>`).join('')}</d:current-user-privilege-set>`;
      const listing = ms(
        entry('/remote.php/dav/calendars/alice/', OWNERED),
        entry(
          '/remote.php/dav/calendars/alice/%c3%bcbung/',
          DISPLAY('Tasks') +
            OWNERED +
            childPriv(['read', 'write', 'write-content']) +
            COMPS('VTODO'),
        ),
        entry(
          '/remote.php/dav/calendars/bob/shared/',
          DISPLAY("Bob's Tasks") +
            OWNER('/remote.php/dav/principals/users/bob/') +
            childPriv(['read', 'read-free-busy']) +
            COMPS('VTODO'),
        ),
      );
      const fetchImpl = router({
        [WELL_KNOWN]: res(404),
        [DAV_ROOT]: res(207, PRINCIPAL_PROBE_BODY),
        [HOME]: res(207, listing),
      });

      const result = await discoverCalendars(CREDENTIALS, { fetchImpl });
      const [tasks, shared] = result.calendars;
      expect(tasks.url).toBe(`${HOME}%C3%BCbung/`);
      expect(tasks.canRead).toBe(true);
      expect(tasks.canWrite).toBe(true);
      expect(shared.canRead).toBe(true);
      expect(shared.canWrite).toBe(false);
    });

    it('sends CalDAV properties in the RFC 4791 namespace, not the legacy Apple one', async () => {
      const bodies: string[] = [];
      const fetchImpl: FetchLike = jest.fn(async (url: string, init?: RequestInit) => {
        if (typeof init?.body === 'string') {
          bodies.push(init.body);
        }
        if (url === WELL_KNOWN) {
          return res(404);
        }
        if (url === DAV_ROOT) {
          return res(207, PRINCIPAL_PROBE_BODY);
        }
        return res(207, HOME_LISTING_BODY);
      });

      await discoverCalendars(CREDENTIALS, { fetchImpl });
      expect(bodies.length).toBeGreaterThanOrEqual(2);
      for (const body of bodies) {
        expect(body).not.toContain('calendarserver.org');
      }
      expect(bodies.some((body) => body.includes('urn:ietf:params:xml:ns:caldav'))).toBe(true);
    });
  });
});

describe('task list trash lifecycle', () => {
  const url = `${HOME}tasks/`;
  const trashbin = entry(
    `${HOME}trashbin/`,
    '<d:resourcetype><nc:trash-bin/></d:resourcetype>' +
      '<nc:trash-bin-retention-duration>2592000</nc:trash-bin-retention-duration>',
  );
  const calendar = (deleted: boolean) =>
    entry(
      url,
      OWNERED +
        READ_WRITE +
        COMPS('VTODO') +
        (deleted ? '<d:resourcetype><nc:deleted-calendar/></d:resourcetype>' : ''),
    );
  function server(
    initiallyDeleted: boolean,
    finallyDeleted: boolean,
    status = 204,
    enabled = true,
  ) {
    const listing = (deleted: boolean) =>
      res(207, ms(trashbin, calendar(deleted)), { DAV: enabled ? 'nc-calendar-trashbin' : '1' });
    const fetchImpl = jest
      .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
      .mockResolvedValueOnce(res(207, PRINCIPAL_PROBE_BODY))
      .mockResolvedValueOnce(listing(initiallyDeleted))
      .mockResolvedValueOnce(res(status))
      .mockResolvedValueOnce(res(207, PRINCIPAL_PROBE_BODY))
      .mockResolvedValueOnce(listing(finallyDeleted));
    return fetchImpl;
  }

  it('moves an owned list to Trash without bypassing retention', async () => {
    const fetchImpl = server(false, true);
    const result = await changeListTrashState(CREDENTIALS, url, 'trash', { fetchImpl });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      url,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(Object.keys(fetchImpl.mock.calls[2][1]?.headers ?? {})).not.toContain(
      'X-NC-CalDAV-No-Trashbin',
    );
    expect(result.calendars).toEqual([]);
    expect(result.trash?.lists.map((list) => list.url)).toEqual([url]);
  });

  it('restores through the Nextcloud restore target and refreshes active lists', async () => {
    const fetchImpl = server(true, false);
    const result = await changeListTrashState(CREDENTIALS, url, 'restore', { fetchImpl });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      url,
      expect.objectContaining({
        method: 'MOVE',
        headers: expect.objectContaining({ Destination: `${HOME}trashbin/restore/file` }),
      }),
    );
    expect(result.calendars.map((list) => list.url)).toEqual([url]);
    expect(result.trash?.lists).toEqual([]);
  });

  it('does not send DELETE on an unsupported server', async () => {
    const fetchImpl = server(false, false, 204, false);
    await expect(
      changeListTrashState(CREDENTIALS, url, 'trash', { fetchImpl }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not send MOVE if the trashed list has expired', async () => {
    const fetchImpl = server(false, false);
    await expect(
      changeListTrashState(CREDENTIALS, url, 'restore', { fetchImpl }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('surfaces a denied mutation without retrying or deleting permanently', async () => {
    const fetchImpl = server(false, false, 403);
    await expect(
      changeListTrashState(CREDENTIALS, url, 'trash', { fetchImpl }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not report success if the server ignored the move', async () => {
    const fetchImpl = server(false, false);
    await expect(
      changeListTrashState(CREDENTIALS, url, 'trash', { fetchImpl }),
    ).rejects.toMatchObject({ code: 'server_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });
});

describe('parseDavFeatures', () => {
  it('detects sharing from the oc-resource-sharing token', () => {
    expect(parseDavFeatures('1, 3, oc-resource-sharing, 2').sharing).toBe(true);
  });

  it('detects sharing from the calendarserver-sharing token', () => {
    expect(parseDavFeatures('1, calendarserver-sharing').sharing).toBe(true);
  });

  it('is case- and whitespace-tolerant', () => {
    expect(parseDavFeatures('  OC-RESOURCE-SHARING , 2 ').sharing).toBe(true);
  });

  it('reports no sharing when only version tokens are present', () => {
    expect(parseDavFeatures('1, 2, extended-mkcol').sharing).toBe(false);
  });

  it('reports no sharing for a missing or empty header', () => {
    expect(parseDavFeatures(null).sharing).toBe(false);
    expect(parseDavFeatures('').sharing).toBe(false);
  });
});

describe('davRootUrl', () => {
  it('appends the DAV collection root path to the server base', () => {
    expect(davRootUrl('https://cloud.example.com')).toBe(
      'https://cloud.example.com/remote.php/dav/',
    );
  });
});

describe('discoverCalendars capability detection', () => {
  const SHARING_DAV_HEADER = '1, 3, oc-resource-sharing, 2';

  it('exposes sharing capability and the DAV root from the home-set response header', async () => {
    const fetchImpl = router({
      [WELL_KNOWN]: res(302, '', { Location: '/remote.php/dav/principals/users/alice/' }),
      [PRINCIPAL]: res(207, PRINCIPAL_PROBE_BODY),
      [HOME]: res(207, HOME_LISTING_BODY, { DAV: SHARING_DAV_HEADER }),
    });

    const result = await discoverCalendars(CREDENTIALS, { fetchImpl });

    expect(result.capabilities.sharing).toBe(true);
    expect(result.davRootUrl).toBe(DAV_ROOT);
  });

  it('reports no sharing capability when the DAV header is absent', async () => {
    const fetchImpl = router({
      [WELL_KNOWN]: res(302, '', { Location: '/remote.php/dav/principals/users/alice/' }),
      [PRINCIPAL]: res(207, PRINCIPAL_PROBE_BODY),
      [HOME]: res(207, HOME_LISTING_BODY),
    });

    const result = await discoverCalendars(CREDENTIALS, { fetchImpl });

    expect(result.capabilities.sharing).toBe(false);
    expect(result.davRootUrl).toBe(DAV_ROOT);
  });
});
