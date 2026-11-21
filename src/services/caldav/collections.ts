/**
 * Calendar collection operations on top of the DAV plumbing (Phase 1.3):
 *
 * - `createCalendar` issues an RFC 4791 `MKCALENDAR` request against the
 *   calendar home set to create a new VTODO-capable calendar (task list).
 *   Nextcloud/SabreDAV answers `201 Created` with a `Location` header
 *   pointing at the new calendar.
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

/** Build the RFC 4791 MKCALENDAR request body for a VTODO calendar. */
export function buildMkCalendarBody(displayName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="http://calendarserver.org/ns/">
  <C:calendar>
    <C:display-name>${escapeXmlText(displayName)}</C:display-name>
    <C:supported-calendar-component-set>
      <C:comp name="VTODO"/>
    </C:supported-calendar-component-set>
  </C:calendar>
</C:mkcalendar>`;
}

/**
 * Create a new task list (VTODO calendar) in the given home set.
 *
 * The display name is validated (non-empty after trimming) and XML-escaped.
 * The returned URL comes from the server's `Location` header; without it
 * the outcome is a `server_error` rather than a guessed URL.
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

  const { status, headers } = await webdavRequest({
    credentials,
    method: 'MKCALENDAR',
    url: homeSetUrl,
    depth: '0',
    body: buildMkCalendarBody(name),
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });

  const location = headers['location'];
  if (status === 201 && location !== undefined) {
    return { url: new URL(location, homeSetUrl).toString() };
  }

  // Some servers answer 200 (rare); without a Location header the new
  // calendar URL cannot be determined reliably.
  throw new CalDAVError('server_error', 'The server did not report the URL of the new calendar.');
}
