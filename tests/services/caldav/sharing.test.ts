import {
  buildShareRequestXml,
  listShares,
  searchPrincipals,
  updateShares,
} from '@/services/caldav/sharing';
import { CalDAVError } from '@/services/caldav/http';
import type { CalDAVCredentials } from '@/services/caldav/types';

const B = 'https://cloud.example.com';
const DAV_ROOT = `${B}/remote.php/dav/`;
const CALENDAR_URL = `${B}/remote.php/dav/calendars/alice/tasks/`;

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

/** A fetch stub that records every request and answers from a route map. */
function makeFetch(routes: Record<string, Response>): {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) {
      throw new Error(`Unexpected request: ${url}`);
    }
    return route;
  };
  return { fetch: fetch as (url: string, init?: RequestInit) => Promise<Response>, calls };
}

describe('buildShareRequestXml', () => {
  it('emits a read-write set with the owncloud namespace and DAV href', () => {
    const xml = buildShareRequestXml(
      [{ principal: 'principal:principals/users/bob', access: 'read-write' }],
      [],
    );
    expect(xml).toContain('xmlns:oc="http://owncloud.org/ns"');
    expect(xml).toContain('<oc:share');
    expect(xml).toContain('<oc:set>');
    expect(xml).toContain('<D:href>principal:principals/users/bob</D:href>');
    expect(xml).toContain('<oc:read-write/>');
  });

  it('omits the read-write element for a read-only share', () => {
    const xml = buildShareRequestXml(
      [{ principal: 'principal:principals/users/bob', access: 'read' }],
      [],
    );
    expect(xml).not.toContain('<oc:read-write/>');
  });

  it('includes common-name when a display name is provided and omits it otherwise', () => {
    const withName = buildShareRequestXml(
      [{ principal: 'p1', displayName: 'Bob <Builder>', access: 'read' }],
      [],
    );
    expect(withName).toContain('<oc:common-name>Bob &lt;Builder&gt;</oc:common-name>');

    const withoutName = buildShareRequestXml([{ principal: 'p1', access: 'read' }], []);
    expect(withoutName).not.toContain('<oc:common-name>');
  });

  it('emits remove elements and escapes special characters', () => {
    const xml = buildShareRequestXml(
      [{ principal: 'principal:principals/users/b&c', access: 'read' }],
      ['principal:principals/users/old'],
    );
    expect(xml).toContain('<oc:set><D:href>principal:principals/users/b&amp;c</D:href>');
    expect(xml).toContain('<oc:remove><D:href>principal:principals/users/old</D:href></oc:remove>');
  });
});

describe('listShares', () => {
  const invite = (users: string): string =>
    `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/calendars/alice/tasks/</d:href>
    <d:propstat>
      <d:prop><oc:invite>${users}</oc:invite></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

  const user = (href: string, access: string, commonName?: string): string =>
    `<oc:user><d:href>${href}</d:href>${
      commonName ? `<oc:common-name>${commonName}</oc:common-name>` : ''
    }<oc:invite-accepted/><oc:access><${access}/></oc:access></oc:user>`;

  it('parses read and read-write shares with and without a display name', async () => {
    const body = invite(
      user('principal:principals/users/bob', 'read-write', 'Bob Builder') +
        user('principal:principals/groups/team', 'read'),
    );
    const { fetch } = makeFetch({ [CALENDAR_URL]: res(207, body) });

    const shares = await listShares(CREDENTIALS, CALENDAR_URL, { fetchImpl: fetch });

    expect(shares).toEqual([
      {
        principal: 'principal:principals/users/bob',
        displayName: 'Bob Builder',
        access: 'read-write',
      },
      { principal: 'principal:principals/groups/team', displayName: null, access: 'read' },
    ]);
  });

  it('returns an empty list when no shares exist', async () => {
    const { fetch } = makeFetch({ [CALENDAR_URL]: res(207, invite('')) });
    const shares = await listShares(CREDENTIALS, CALENDAR_URL, { fetchImpl: fetch });
    expect(shares).toEqual([]);
  });

  it('returns an empty list when the invite property is absent', async () => {
    const body = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${CALENDAR_URL}</d:href><d:propstat><d:prop></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
    const { fetch } = makeFetch({ [CALENDAR_URL]: res(207, body) });
    const shares = await listShares(CREDENTIALS, CALENDAR_URL, { fetchImpl: fetch });
    expect(shares).toEqual([]);
  });

  it('maps a 403 to a forbidden CalDAVError', async () => {
    const { fetch } = makeFetch({ [CALENDAR_URL]: res(403) });
    await expect(listShares(CREDENTIALS, CALENDAR_URL, { fetchImpl: fetch })).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
  });

  it('maps a 501 (unsupported) to a CalDAVError', async () => {
    const { fetch } = makeFetch({ [CALENDAR_URL]: res(501) });
    await expect(
      listShares(CREDENTIALS, CALENDAR_URL, { fetchImpl: fetch }),
    ).rejects.toBeInstanceOf(CalDAVError);
  });
});

describe('updateShares', () => {
  it('POSTs an oc:share document to the calendar and resolves on 200', async () => {
    const { fetch, calls } = makeFetch({
      [CALENDAR_URL]: res(200, '', { 'X-Sabre-Status': 'everything-went-well' }),
    });

    await updateShares(
      CREDENTIALS,
      CALENDAR_URL,
      [{ principal: 'principal:principals/users/bob', access: 'read-write' }],
      [],
      { fetchImpl: fetch },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(CALENDAR_URL);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toContain('<oc:read-write/>');
  });

  it('sends a remove document when revoking a share', async () => {
    const { fetch, calls } = makeFetch({ [CALENDAR_URL]: res(200) });

    await updateShares(CREDENTIALS, CALENDAR_URL, [], ['principal:principals/users/bob'], {
      fetchImpl: fetch,
    });

    expect(calls[0].init?.body).toContain('<oc:remove>');
    expect(calls[0].init?.body).not.toContain('<oc:set>');
  });

  it('normalizes a DAV-path sharee to the principal: URI form on the wire', async () => {
    const { fetch, calls } = makeFetch({ [CALENDAR_URL]: res(200) });

    // A DAV path (as returned by the sharee search) must be sent as the
    // `principal:` URI form, otherwise the server silently drops it.
    await updateShares(
      CREDENTIALS,
      CALENDAR_URL,
      [{ principal: '/remote.php/dav/principals/users/bob/', access: 'read' }],
      ['/remote.php/dav/principals/groups/team/'],
      { fetchImpl: fetch },
    );

    expect(calls[0].init?.body).toContain('<D:href>principal:principals/users/bob</D:href>');
    expect(calls[0].init?.body).toContain(
      '<oc:remove><D:href>principal:principals/groups/team</D:href></oc:remove>',
    );
    expect(calls[0].init?.body).not.toContain('/remote.php/dav/');
  });

  it('rejects before sending when there is nothing to change', async () => {
    const { fetch, calls } = makeFetch({ [CALENDAR_URL]: res(200) });
    await expect(
      updateShares(CREDENTIALS, CALENDAR_URL, [], [], { fetchImpl: fetch }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });

  it('rejects oversized batches (more than ten operations) without sending', async () => {
    const sets = Array.from({ length: 6 }, (_, i) => ({
      principal: `p${i}`,
      access: 'read' as const,
    }));
    const removes = Array.from({ length: 5 }, (_, i) => `r${i}`);
    const { fetch, calls } = makeFetch({ [CALENDAR_URL]: res(200) });
    await expect(
      updateShares(CREDENTIALS, CALENDAR_URL, sets, removes, { fetchImpl: fetch }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });

  it('maps a 403 to a forbidden CalDAVError', async () => {
    const { fetch } = makeFetch({ [CALENDAR_URL]: res(403) });
    await expect(
      updateShares(CREDENTIALS, CALENDAR_URL, [{ principal: 'p', access: 'read' }], [], {
        fetchImpl: fetch,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('maps a 501 (unsupported) to a CalDAVError', async () => {
    const { fetch } = makeFetch({ [CALENDAR_URL]: res(501) });
    await expect(
      updateShares(CREDENTIALS, CALENDAR_URL, [{ principal: 'p', access: 'read' }], [], {
        fetchImpl: fetch,
      }),
    ).rejects.toBeInstanceOf(CalDAVError);
  });
});

describe('searchPrincipals', () => {
  const principalResponse = (href: string, name: string, collection: string): string =>
    `<d:response>
      <d:href>${href}</d:href>
      <d:propstat>
        <d:prop>
          <d:displayname>${name}</d:displayname>
          <d:principal-URL><d:href>${href}</d:href></d:principal-URL>
          <d:principal-collection-set><d:href>${collection}</d:href></d:principal-collection-set>
        </d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>`;

  const multistatus = (entries: string): string =>
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries}</d:multistatus>`;

  it('searches the DAV root and maps results to principals and kinds', async () => {
    const body = multistatus(
      principalResponse(
        '/remote.php/dav/principals/users/bob/',
        'Bob Builder',
        '/remote.php/dav/principals/users/',
      ) +
        principalResponse(
          '/remote.php/dav/principals/groups/team/',
          'Team',
          '/remote.php/dav/principals/groups/',
        ),
    );
    const { fetch, calls } = makeFetch({ [DAV_ROOT]: res(207, body) });

    const results = await searchPrincipals(CREDENTIALS, DAV_ROOT, 'bo', { fetchImpl: fetch });

    expect(calls[0].url).toBe(DAV_ROOT);
    expect(calls[0].init?.method).toBe('REPORT');
    expect(calls[0].init?.body).toContain('principal-property-search');
    expect(calls[0].init?.body).toContain('>bo<');
    expect(results).toEqual([
      {
        principal: 'principal:principals/users/bob',
        displayName: 'Bob Builder',
        kind: 'user',
      },
      { principal: 'principal:principals/groups/team', displayName: 'Team', kind: 'group' },
    ]);
  });

  it('returns an empty list for a blank query without sending a request', async () => {
    const { fetch, calls } = makeFetch({ [DAV_ROOT]: res(207) });
    const results = await searchPrincipals(CREDENTIALS, DAV_ROOT, '   ', { fetchImpl: fetch });
    expect(results).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('returns an empty list when the server reports no matches', async () => {
    const { fetch } = makeFetch({ [DAV_ROOT]: res(207, multistatus('')) });
    const results = await searchPrincipals(CREDENTIALS, DAV_ROOT, 'zzz', { fetchImpl: fetch });
    expect(results).toEqual([]);
  });

  it('maps a 403 to a forbidden CalDAVError', async () => {
    const { fetch } = makeFetch({ [DAV_ROOT]: res(403) });
    await expect(
      searchPrincipals(CREDENTIALS, DAV_ROOT, 'bob', { fetchImpl: fetch }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
