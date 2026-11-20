/**
 * CalDAV discovery for an authenticated Nextcloud server:
 *
 *   1. Locate the user principal:
 *      a. PROPFIND {server}/.well-known/carddav/ (RFC 6764) with redirect
 *         following — on platforms where the fetch layer does not swallow
 *         the redirect, this lands directly on the principal and returns
 *         the properties of interest in one response (HTTP 207).
 *      b. Otherwise PROPFIND {server}/remote.php/dav/ (the DAV collection
 *         root) for `current-user-principal`. This is session-based, so it
 *         works even when the user ID differs from the login name, and it
 *         does not depend on observing the .well-known redirect (React
 *         Native's fetch follows it transparently and exposes no Location).
 *   2. Obtain the `calendar-home-set` (from the same response, or with a
 *      PROPFIND on the principal if the root probe did not report it).
 *   3. PROPFIND the home set with Depth: 1 -> all calendars with display
 *      name, supported components (VTODO detection), owner, sharing
 *      addresses and the current user's privilege set (read / read-write).
 *
 * The whole flow is pure and injectable (fetch implementation), so it is
 * fully testable against XML fixtures without a live server.
 */

import { CalDAVError, webdavRequest } from './http';
import type { CalDAVCalendar, CalDAVCredentials, DiscoveredCalendars } from './types';
import { firstText, parseMultistatus, textList } from './xml';

export interface DiscoveryDeps {
  fetchImpl?: Parameters<typeof webdavRequest>[0]['fetchImpl'];
  timeoutMs?: number;
}

const WELL_KNOWN_PATH = '/.well-known/carddav/';
const DAV_ROOT_PATH = '/remote.php/dav/';

const PRINCIPAL_PROPFIND = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="http://calendarserver.org/ns/">
  <D:prop>
    <D:current-user-principal />
    <C:calendar-home-set />
  </D:prop>
</D:propfind>`;

const HOME_SET_PROPFIND = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="http://calendarserver.org/ns/">
  <D:prop>
    <D:displayname />
    <D:owner />
    <D:current-user-privilege-set />
    <C:supported-calendar-component-set />
    <C:calendar-user-address-set />
  </D:prop>
</D:propfind>`;

/** Normalize a DAV href for comparison: absolute, trailing slash canonical. */
function canonicalUrl(href: string, base: string): string {
  const url = new URL(href, base);
  if (url.pathname.length > 1 && !url.pathname.endsWith('/')) {
    url.pathname += '/';
  }
  return url.toString();
}

class CalDAVProtocolError extends Error {}

interface PrincipalProbe {
  principalUrl: string;
  /** Present when the probing response also reported the home set. */
  homeSetUrl: string | null;
}

function parsePrincipalProbe(
  body: string,
  base: string,
  expectedPrincipalHref?: string,
): PrincipalProbe {
  const [response] = parseMultistatus(body);
  const principalHref = firstText(response.properties['current-user-principal']);
  if (principalHref === null) {
    throw new CalDAVProtocolError('DAV response is missing current-user-principal');
  }
  const homeHref = firstText(response.properties['calendar-home-set']);
  return {
    principalUrl: canonicalUrl(expectedPrincipalHref ?? principalHref, base),
    homeSetUrl: homeHref !== null ? canonicalUrl(homeHref, base) : null,
  };
}

/** Step 1a: .well-known/carddav with redirect following. */
async function probeWellKnown(
  credentials: CalDAVCredentials,
  deps: DiscoveryDeps,
): Promise<PrincipalProbe | null> {
  const url = `${credentials.serverUrl}${WELL_KNOWN_PATH}`;
  try {
    const { status, finalUrl, body } = await webdavRequest({
      credentials,
      method: 'PROPFIND',
      url,
      depth: '0',
      body: PRINCIPAL_PROPFIND,
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
      followRedirects: true,
    });
    if (status !== 207) {
      // Not a multistatus (e.g. the platform fetch auto-followed the
      // redirect to a non-DAV response): fall through to the DAV root.
      return null;
    }
    return parsePrincipalProbe(body, credentials.serverUrl, finalUrl);
  } catch (err) {
    if (err instanceof CalDAVError && (err.code === 'unauthorized' || err.code === 'forbidden')) {
      throw err;
    }
    // 404/405/parse errors on the .well-known probe are not fatal: the DAV
    // root probe (step 1b) still locates the principal.
    return null;
  }
}

/** Step 1b: PROPFIND on the DAV collection root (session-based principal). */
async function probeDavRoot(
  credentials: CalDAVCredentials,
  deps: DiscoveryDeps,
): Promise<PrincipalProbe> {
  const url = `${credentials.serverUrl}${DAV_ROOT_PATH}`;
  const { body } = await webdavRequest({
    credentials,
    method: 'PROPFIND',
    url,
    depth: '0',
    body: PRINCIPAL_PROPFIND,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
  return parsePrincipalProbe(body, credentials.serverUrl);
}

/** Step 2: ensure we have a calendar home set URL. */
async function ensureHomeSet(
  credentials: CalDAVCredentials,
  deps: DiscoveryDeps,
  principalUrl: string,
  knownHomeSetUrl: string | null,
): Promise<string> {
  if (knownHomeSetUrl !== null) {
    return knownHomeSetUrl;
  }
  const { body } = await webdavRequest({
    credentials,
    method: 'PROPFIND',
    url: principalUrl,
    depth: '0',
    body: PRINCIPAL_PROPFIND,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
  const [response] = parseMultistatus(body);
  const homeHref = firstText(response.properties['calendar-home-set']);
  if (homeHref === null) {
    throw new CalDAVProtocolError('The principal does not report a calendar home set');
  }
  return canonicalUrl(homeHref, credentials.serverUrl);
}

/**
 * Parse a `DAV:current-user-privilege-set` into the privilege short names.
 *
 * SabreDAV (Nextcloud) reports one `DAV:privilege` element per granted
 * privilege containing a `DAV:privilege-uri` such as `DAV:read` or
 * `urn:ietf:params:xml:ns:caldav:read-free-busy`; only the last path
 * segment (`read`, `read-free-busy`, ...) is kept.
 */
/** Unwrap a repeating child element (`comp`, `addr`) of a DAV property,
 * returning the children as an array (single child -> one entry). */
function childList(value: unknown, child: string): unknown[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  const raw = (value as Record<string, unknown>)[child];
  if (raw === undefined || raw === null) {
    return [];
  }
  return Array.isArray(raw) ? raw : [raw];
}

function parsePrivileges(value: unknown): Set<string> {
  const privileges = new Set<string>();
  // The set element wraps one or more `DAV:privilege` children.
  let children: unknown = value;
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'privilege' in (value as Record<string, unknown>)
  ) {
    children = (value as Record<string, unknown>)['privilege'];
  }
  const entries: unknown[] =
    children === undefined || children === null
      ? []
      : Array.isArray(children)
        ? children
        : [children];
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const uri = firstText((entry as Record<string, unknown>)['privilege-uri']);
    if (uri === null) {
      continue;
    }
    const name = uri.split(':').pop() ?? '';
    if (name !== '') {
      privileges.add(name);
    }
  }
  return privileges;
}

function displayNameOf(url: string, propertyValue: unknown): string {
  const name = firstText(propertyValue);
  if (name !== null) {
    return name;
  }
  const lastSegment = new URL(url).pathname.split('/').filter(Boolean).pop();
  return lastSegment ?? 'Calendar';
}

/** Step 3: PROPFIND the home set (Depth: 1) and type the results. */
async function listCalendars(
  credentials: CalDAVCredentials,
  deps: DiscoveryDeps,
  homeSetUrl: string,
  ownPrincipalUrl: string,
): Promise<CalDAVCalendar[]> {
  const { body } = await webdavRequest({
    credentials,
    method: 'PROPFIND',
    url: homeSetUrl,
    depth: '1',
    body: HOME_SET_PROPFIND,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });

  const normalizedHome = canonicalUrl(homeSetUrl, credentials.serverUrl);
  return parseMultistatus(body)
    .filter((response) => canonicalUrl(response.href, credentials.serverUrl) !== normalizedHome)
    .map((response) => {
      const url = canonicalUrl(response.href, credentials.serverUrl);
      const properties = response.properties;

      const components = childList(properties['supported-calendar-component-set'], 'comp')
        .map((comp) => (comp as Record<string, unknown>)['@_name'])
        .filter((name): name is string => typeof name === 'string');

      const ownerHref = firstText(properties.owner);
      const ownerUrl = ownerHref !== null ? canonicalUrl(ownerHref, credentials.serverUrl) : null;
      const isOwned = ownerUrl !== null && ownerUrl === ownPrincipalUrl;
      const privileges = parsePrivileges(properties['current-user-privilege-set']);

      return {
        url,
        displayName: displayNameOf(url, properties.displayname),
        components,
        isTaskList: components.includes('VTODO'),
        ownerUrl,
        isOwned,
        isSharedWithMe: ownerUrl !== null && !isOwned,
        sharedAddresses: textList(childList(properties['calendar-user-address-set'], 'addr')),
        canRead: privileges.has('read') || privileges.has('read-free-busy'),
        canWrite: privileges.has('write'),
      };
    });
}

/**
 * Run the full discovery flow. Throws `CalDAVError` with a stable `code`
 * (network, timeout, unauthorized, forbidden, not_found, server_error) on
 * failure.
 */
export async function discoverCalendars(
  credentials: CalDAVCredentials,
  deps: DiscoveryDeps = {},
): Promise<DiscoveredCalendars> {
  const probe =
    (await probeWellKnown(credentials, deps)) ?? (await probeDavRoot(credentials, deps));
  const homeSetUrl = await ensureHomeSet(credentials, deps, probe.principalUrl, probe.homeSetUrl);
  const calendars = await listCalendars(credentials, deps, homeSetUrl, probe.principalUrl);
  return { principalUrl: probe.principalUrl, homeSetUrl, calendars };
}
