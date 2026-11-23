/**
 * Calendar collection operations on top of the DAV plumbing (Phase 1.3):
 *
 * - `createCalendar` issues an RFC 4791 `MKCALENDAR` request to create a
 *   new VTODO-capable calendar (task list). Per the RFC, the request
 *   targets the URL of the calendar to be created (`{homeSet}{slug}/`),
 *   not the home set itself. Nextcloud/SabreDAV answers `201 Created`;
 *   it sends no `Location` header, so the requested URL is authoritative
 *   (a `Location` header, when present, still wins).
 */

import { CalDAVError, webdavRequest, type FetchLike } from './http';
import type { CalDAVCredentials } from './types';
import { escapeXmlText } from './xml';

export interface CreateCalendarDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface CreateCalendarResult {
  /** Absolute URL of the newly created calendar. */
  url: string;
}

/**
 * Build the RFC 4791 MKCALENDAR request body for a VTODO calendar.
 *
 * The CalDAV properties use the RFC 4791 namespace
 * (`urn:ietf:params:xml:ns:caldav`). Newer SabreDAV/Nextcloud servers
 * reject the legacy Apple `http://calendarserver.org/ns/` namespace with
 * `400 Expected {urn:ietf:params:xml:ns:caldav}mkcalendar`, so the RFC
 * namespace is required for compatibility.
 */
export function buildMkCalendarBody(displayName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cal:mkcalendar xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXmlText(displayName)}</D:displayname>
      <cal:supported-calendar-component-set>
        <cal:comp name="VTODO"/>
      </cal:supported-calendar-component-set>
    </D:prop>
  </D:set>
</cal:mkcalendar>`;
}

/**
 * Derive a DAV-safe URL segment for a new calendar from its display name.
 *
 * MKCALENDAR targets the URL of the calendar to be created, so the name
 * must become a path segment: lowercased, unicode letters/digits kept,
 * everything else collapsed to single hyphens.
 */
export function calendarSlug(displayName: string): string {
  return displayName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Create a new task list (VTODO calendar) in the given home set.
 *
 * The display name is validated (non-empty after trimming, and containing
 * at least one letter or digit for the URL segment) and XML-escaped in the
 * MKCALENDAR body. Per RFC 4791 the request targets the URL of the new
 * calendar (`{homeSet}{slug}/`), so on success the requested URL is
 * authoritative; a `Location` header, when the server sends one, wins.
 */
export async function createCalendar(
  credentials: CalDAVCredentials,
  homeSetUrl: string,
  displayName: string,
  deps: CreateCalendarDeps = {},
): Promise<CreateCalendarResult> {
  const name = displayName.trim();
  if (name === '') {
    throw new CalDAVError('bad_request', 'The list name must not be empty.');
  }
  const slug = calendarSlug(name);
  if (slug === '') {
    throw new CalDAVError(
      'bad_request',
      'The list name must contain at least one letter or digit.',
    );
  }

  const home = homeSetUrl.endsWith('/') ? homeSetUrl : `${homeSetUrl}/`;
  const targetUrl = `${home}${encodeURIComponent(slug)}/`;

  const { headers, status } = await webdavRequest({
    credentials,
    method: 'MKCALENDAR',
    url: targetUrl,
    depth: '0',
    body: buildMkCalendarBody(name),
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
  if (status !== 201) {
    throw new CalDAVError('server_error', `Calendar creation returned HTTP ${status}, not 201.`);
  }

  const location = headers['location'];
  const url = location !== undefined ? new URL(location, targetUrl).toString() : targetUrl;
  return { url };
}
