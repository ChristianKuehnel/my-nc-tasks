/**
 * Calendar mutation operations on top of the DAV plumbing (Phase 1.4):
 *
 * - `renameCalendar` issues a RFC 3744 `PROPPATCH` that sets
 *   `DAV:displayname` (the server-side name; the calendar URL/URI is
 *   unchanged). Nextcloud/SabreDAV answers `207 Multistatus`; a successful
 *   set carries a `200` propstat for the property, a refusal a `403`/`404`
 *   propstat *within* the same 207, so the per-property status is checked.
 * - `deleteCalendar` issues a DAV `DELETE` with the Nextcloud extension
 *   header `X-NC-CalDAV-No-Trashbin: 1`.
 *
 *   Why the header: Nextcloud 30+ moved calendar deletion to a calendar
 *   trashbin — a plain `DELETE` only marks the calendar as deleted, and on
 *   the reference deployment (Nextcloud 35) it is observed as a silent
 *   no-op for VTODO calendars (the calendar stays listed, nothing is
 *   marked). The trashbin plugin treats the header as "delete immediately",
 *   which is the destructive behaviour a confirmed delete in this app
 *   means. On Nextcloud versions without the trashbin the header is unknown
 *   and ignored, and `DELETE` was already permanent there, so the header is
 *   safe across versions.
 * - `unsubscribeCalendar` issues a plain DAV `DELETE` on the shared
 *   calendar's copy in the user's home set. Nextcloud routes the delete of a
 *   shared (non-owned) calendar to `unshare()`, which removes the share from
 *   the user's account without touching the owner's calendar or its tasks.
 *
 * HTTP-level failures (401/403/404/network/timeout) surface as `CalDAVError`
 * from the request plumbing; only the protocol-level outcome (the 201/207/
 * 204 body) is interpreted here.
 */

import { CalDAVError, webdavRequest, type FetchLike } from './http';
import type { CalDAVCredentials } from './types';
import { escapeXmlText, parsePropPatchPropStats } from './xml';

export interface MutationDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Nextcloud extension header that bypasses the calendar trashbin (Nextcloud
 * 30+). Unknown servers ignore it; older Nextcloud versions already deleted
 * permanently without it.
 */
export const NO_TRASHBIN_HEADER = { 'X-NC-CalDAV-No-Trashbin': '1' };

/**
 * Build a RFC 3744 `PROPPATCH` body that sets `DAV:displayname`.
 * The name is validated by the caller and XML-escaped here.
 */
export function buildPropPatchBody(displayName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXmlText(displayName)}</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>`;
}

/** Validate a rename target name (non-empty after trimming). */
function assertValidName(displayName: string): string {
  const name = displayName.trim();
  if (name === '') {
    throw new CalDAVError('bad_request', 'The list name must not be empty.');
  }
  return name;
}

/** Map a per-property HTTP status to the matching `CalDAVError`. */
function propStatError(code: number): CalDAVError {
  switch (code) {
    case 400:
      return new CalDAVError('bad_request', 'The server rejected the rename (HTTP 400).');
    case 401:
      return new CalDAVError('unauthorized', 'The server rejected the rename (HTTP 401).');
    case 403:
      return new CalDAVError('forbidden', 'The server refused to rename the list (HTTP 403).');
    case 404:
      return new CalDAVError('not_found', 'The list to rename was not found (HTTP 404).');
    default:
      return new CalDAVError('server_error', `The server rejected the rename (HTTP ${code}).`);
  }
}

/**
 * Verify a `PROPPATCH` 207 body actually applied `displayname`. The overall
 * HTTP 207 is success at the protocol level, so a per-property refusal
 * (a 4xx/5xx propstat for `displayname`) is the only failure signal left.
 * A 207 without a `displayname` propstat, or with a non-multistatus body, is
 * accepted — the status code already signals acceptance.
 */
function assertPropPatchSucceeded(status: number, body: string): void {
  if (status !== 207 || body.trim() === '') {
    return;
  }
  const displayname = parsePropPatchPropStats(body).filter(
    (entry) => entry.property.toLowerCase() === 'displayname',
  );
  const failed = displayname.find((entry) => entry.status >= 400);
  if (failed !== undefined) {
    throw propStatError(failed.status);
  }
}

/**
 * Rename a calendar by updating its `DAV:displayname` property (RFC 3744
 * `PROPPATCH`). The calendar's URL is unchanged; the display name is what
 * the app shows.
 *
 * The name must be non-empty after trimming. On success the server has
 * persisted the new name (re-discovery reflects it).
 */
export async function renameCalendar(
  credentials: CalDAVCredentials,
  calendarUrl: string,
  displayName: string,
  deps: MutationDeps = {},
): Promise<void> {
  const name = assertValidName(displayName);

  const { status, body } = await webdavRequest({
    credentials,
    method: 'PROPPATCH',
    url: calendarUrl,
    body: buildPropPatchBody(name),
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
  assertPropPatchSucceeded(status, body);
}

/**
 * Permanently delete a calendar and all of its contents (DAV `DELETE` with
 * the Nextcloud no-trashbin header, see the file header for rationale).
 *
 * Only intended for calendars owned by the authenticated user; the caller
 * enforces ownership/permissions (the server enforces them too: 403/404 map
 * to `CalDAVError`).
 */
export async function deleteCalendar(
  credentials: CalDAVCredentials,
  calendarUrl: string,
  deps: MutationDeps = {},
): Promise<void> {
  await webdavRequest({
    credentials,
    method: 'DELETE',
    url: calendarUrl,
    headers: NO_TRASHBIN_HEADER,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
}

/**
 * Unsubscribe from a shared calendar: remove the shared copy from the
 * authenticated user's home set (plain DAV `DELETE`). Nextcloud routes the
 * delete of a shared (non-owned) calendar to `unshare()`, so the owner's
 * calendar and its tasks are untouched.
 *
 * Only intended for calendars shared with the authenticated user; the caller
 * enforces that (the server enforces ownership too).
 */
export async function unsubscribeCalendar(
  credentials: CalDAVCredentials,
  calendarUrl: string,
  deps: MutationDeps = {},
): Promise<void> {
  await webdavRequest({
    credentials,
    method: 'DELETE',
    url: calendarUrl,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
}
