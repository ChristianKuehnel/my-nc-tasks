/**
 * HTTP plumbing for DAV requests: basic auth, per-request timeout, and
 * explicit redirect handling for discovery requests.
 *
 * Redirects are handled here (and not left to the platform fetch
 * implementation) because a PROPFIND redirected to a GET would silently
 * change semantics — the discovery flow needs the final Location URL.
 */

import type { CalDAVCredentials } from './types';

export type CalDAVErrorCode =
  | 'network'
  | 'timeout'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'server_error';

export class CalDAVError extends Error {
  readonly code: CalDAVErrorCode;

  constructor(code: CalDAVErrorCode, message: string) {
    super(message);
    this.name = 'CalDAVError';
    this.code = code;
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/** RFC 7617 basic auth header value for a DAV login name / app password. */
export function basicAuthHeader(credentials: CalDAVCredentials): string {
  return `Basic ${btoa(`${credentials.loginName}:${credentials.appPassword}`)}`;
}

interface WebDAVRequestOptions {
  credentials: CalDAVCredentials;
  method: string;
  url: string;
  /** DAV:depth for PROPFIND (0 or 1). */
  depth?: string;
  /** XML request body (propfind documents). */
  body?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Follow 3xx responses to the Location header (bounded). */
  followRedirects?: boolean;
}

interface WebDAVRequestResult {
  status: number;
  /** Final URL after redirect following (the request URL when none). */
  finalUrl: string;
  body: string;
  /** Response headers with lowercase names. */
  headers: Record<string, string>;
}

function mapHttpError(status: number): CalDAVError {
  switch (status) {
    case 400:
      return new CalDAVError('bad_request', 'The server rejected the request (HTTP 400).');
    case 401:
      return new CalDAVError('unauthorized', 'The server rejected the credentials (HTTP 401).');
    case 403:
      return new CalDAVError('forbidden', 'The server refused access (HTTP 403).');
    case 404:
      return new CalDAVError('not_found', 'The requested resource does not exist (HTTP 404).');
    default:
      return new CalDAVError('server_error', `Server responded with HTTP ${status}.`);
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new CalDAVError('timeout', `Request timed out after ${timeoutMs} ms.`);
    }
    throw new CalDAVError('network', describeNetworkError(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Perform a DAV request with basic auth and an optional bounded redirect
 * loop. Non-OK statuses (after following) are mapped to `CalDAVError`.
 */
export async function webdavRequest(options: WebDAVRequestOptions): Promise<WebDAVRequestResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const follow = options.followRedirects ?? false;
  const server = new URL(options.credentials.serverUrl);

  let url = options.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const requestUrl = new URL(url);
    if (requestUrl.origin !== server.origin || requestUrl.username || requestUrl.password) {
      throw new CalDAVError(
        'server_error',
        'DAV requests must stay on the configured server origin.',
      );
    }
    const headers: Record<string, string> = {
      Authorization: basicAuthHeader(options.credentials),
    };
    if (options.depth !== undefined) {
      headers.Depth = options.depth;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/xml; charset=utf-8';
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        url,
        {
          method: options.method,
          redirect: 'manual',
          headers,
          body: options.body,
        },
        timeoutMs,
      );
    } catch (err) {
      if (err instanceof CalDAVError) {
        throw err;
      }
      throw new CalDAVError('network', describeNetworkError(err));
    }

    if (response.status >= 300 && response.status < 400 && follow) {
      const location =
        response.headers.get?.('Location') ??
        (response.headers as unknown as Record<string, string>)['Location'];
      if (!location) {
        throw new CalDAVError('server_error', 'Redirect response without a Location header.');
      }
      const target = new URL(location, url);
      // Some servers (observed: Apache + Nextcloud) redirect
      // /.well-known/carddav to an http:// URL even when the site is served
      // over https. Following that verbatim would send basic-auth
      // credentials in cleartext, so re-upgrade same-host targets to https
      // when the original request used https.
      if (
        target.protocol === 'http:' &&
        server.protocol === 'https:' &&
        target.host === server.host
      ) {
        target.protocol = 'https:';
      }
      url = target.toString();
      continue;
    }

    const body = await response.text();
    if (!response.ok) {
      throw mapHttpError(response.status);
    }
    return {
      status: response.status,
      finalUrl: url,
      body,
      headers: collectHeaders(response.headers),
    };
  }

  throw new CalDAVError('server_error', 'Too many redirects while discovering the server.');
}

/** Normalize a fetch `Headers` object into lowercase-named plain records. */
function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach?.((value: string, key: string) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function describeNetworkError(err: unknown): string {
  if (err instanceof Error) {
    return `Network error: ${err.message}`;
  }
  return 'Unknown network error.';
}
