import {
  basicAuthHeader,
  CalDAVError,
  webdavRequest,
  type FetchLike,
} from '@/services/caldav/http';
import type { CalDAVCredentials } from '@/services/caldav/types';

const CREDENTIALS: CalDAVCredentials = {
  serverUrl: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'app__pw',
};

function jsonResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => body,
  } as unknown as Response;
}

describe('basicAuthHeader', () => {
  it('encodes login name and app password as RFC 7617 basic auth', () => {
    expect(basicAuthHeader(CREDENTIALS)).toBe(
      `Basic ${Buffer.from('alice:app__pw').toString('base64')}`,
    );
  });
});

describe('webdavRequest', () => {
  it('sends auth, depth and body headers and returns status, final URL and body', async () => {
    const fetchImpl: FetchLike = jest.fn(async (url, init) => {
      expect(url).toBe('https://cloud.example.com/.well-known/carddav/');
      expect(init?.method).toBe('PROPFIND');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(basicAuthHeader(CREDENTIALS));
      expect(headers.Depth).toBe('0');
      expect(headers['Content-Type']).toBe('application/xml; charset=utf-8');
      return jsonResponse('<multistatus/>', 207);
    });

    const result = await webdavRequest({
      credentials: CREDENTIALS,
      method: 'PROPFIND',
      url: 'https://cloud.example.com/.well-known/carddav/',
      depth: '0',
      body: '<propfind/>',
      fetchImpl,
    });
    expect(result.status).toBe(207);
    expect(result.finalUrl).toBe('https://cloud.example.com/.well-known/carddav/');
    expect(result.body).toBe('<multistatus/>');
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'server_error'],
  ] as const)('maps HTTP %i to error code %s', async (status, code) => {
    const fetchImpl: FetchLike = jest.fn(async () => jsonResponse('nope', status));
    await expect(
      webdavRequest({
        credentials: CREDENTIALS,
        method: 'PROPFIND',
        url: 'https://cloud.example.com/x',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code, name: 'CalDAVError' });
  });

  it('maps a request timeout to the timeout code', async () => {
    const fetchImpl: FetchLike = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      webdavRequest({
        credentials: CREDENTIALS,
        method: 'PROPFIND',
        url: 'https://cloud.example.com/x',
        fetchImpl,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('maps network failures to the network code', async () => {
    const fetchImpl: FetchLike = jest.fn(async () => {
      throw new Error('fetch failed');
    });
    await expect(
      webdavRequest({
        credentials: CREDENTIALS,
        method: 'PROPFIND',
        url: 'https://cloud.example.com/x',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('follows a bounded redirect chain to the Location URL', async () => {
    const fetchImpl: FetchLike = jest.fn(async (url: string) => {
      if (url === 'https://cloud.example.com/.well-known/carddav/') {
        return jsonResponse('', 302, { Location: '/remote.php/dav/principals/users/alice/' });
      }
      return jsonResponse('<ok/>', 207);
    });
    const result = await webdavRequest({
      credentials: CREDENTIALS,
      method: 'PROPFIND',
      url: 'https://cloud.example.com/.well-known/carddav/',
      followRedirects: true,
      fetchImpl,
    });
    expect(result.finalUrl).toBe(
      'https://cloud.example.com/remote.php/dav/principals/users/alice/',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('re-upgrades a same-host http redirect target to https', async () => {
    const fetchImpl: FetchLike = jest.fn(async (url: string) => {
      if (url === 'https://cloud.example.com/.well-known/carddav/') {
        // Mirrors Apache + Nextcloud: 301 to a cleartext URL on the same host.
        return jsonResponse('', 301, {
          Location: 'http://cloud.example.com/remote.php/dav/',
        });
      }
      return jsonResponse('<ok/>', 207);
    });
    const result = await webdavRequest({
      credentials: CREDENTIALS,
      method: 'PROPFIND',
      url: 'https://cloud.example.com/.well-known/carddav/',
      followRedirects: true,
      fetchImpl,
    });
    expect(result.finalUrl).toBe('https://cloud.example.com/remote.php/dav/');
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://cloud.example.com/remote.php/dav/',
      expect.anything(),
    );
  });

  it('fails a redirect loop after too many hops', async () => {
    const fetchImpl: FetchLike = jest.fn(async (url: string) =>
      jsonResponse('', 302, { Location: url }),
    );
    await expect(
      webdavRequest({
        credentials: CREDENTIALS,
        method: 'PROPFIND',
        url: 'https://cloud.example.com/loop',
        followRedirects: true,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'server_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(6); // initial + 5 hops
  });

  it('does not send credentials to a different origin', async () => {
    const fetchImpl: FetchLike = jest.fn(async () =>
      jsonResponse('', 301, { Location: 'https://other.example.com/dav/' }),
    );
    await expect(
      webdavRequest({
        credentials: CREDENTIALS,
        method: 'PROPFIND',
        url: 'https://cloud.example.com/.well-known/carddav/',
        followRedirects: true,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'server_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        redirect: 'manual',
      }),
    );
  });

  it('rejects an unexpected redirect when not in follow mode', async () => {
    const fetchImpl: FetchLike = jest.fn(async () =>
      jsonResponse('', 302, { Location: '/elsewhere/' }),
    );
    await expect(
      webdavRequest({
        credentials: CREDENTIALS,
        method: 'PROPFIND',
        url: 'https://cloud.example.com/x',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'server_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
