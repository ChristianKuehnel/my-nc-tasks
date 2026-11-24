/**
 * List (calendar) sharing on top of the DAV plumbing (Phase 1.5).
 *
 * Nextcloud does **not** implement the generic CalDAV sharing extensions
 * (`DAV:invite` / the `cs:share` and `D:share-resource` POSTs both return
 * 501 on the reference deployment). Instead it uses its own
 * **`oc-resource-sharing`** protocol (feature token advertised in the `DAV:`
 * header), defined in `apps/dav/lib/DAV/Sharing/` on the server. Every
 * sharing element lives in the `http://owncloud.org/ns` namespace — *not*
 * `DAV:` and *not* `http://nextcloud.com/ns` — even though the product was
 * rebranded from ownCloud.
 *
 * - Reading shares: `PROPFIND` the calendar (Depth 0) for `oc:invite`.
 * - Creating / updating / revoking shares: `POST` the calendar with an
 *   `oc:share` document containing `oc:set` (add or change access) and/or
 *   `oc:remove` (revoke) entries. A set entry's access level is encoded by
 *   the *presence* of `<oc:read-write/>` (absent = read-only). The server
 *   answers `200` + `X-Sabre-Status: everything-went-well`.
 * - Searching for sharees: `REPORT` `DAV:principal-property-search` against
 *   the DAV collection root with `apply-to-principal-collection-set`.
 *
 * Sharee identifiers use the `principal:` URI form, e.g.
 * `principal:principals/users/john` or `principal:principals/groups/team`.
 * The server's share handler resolves sharees through `findByUri`, which
 * understands only `principal:` and `mailto:` URIs — a raw DAV path resolves
 * to nothing and the sharee is **silently skipped**. `oc:invite` reports the
 * `principal:` form, but the sharee search reports DAV paths in its
 * `principal-URL`; `toPrincipalUri` normalizes both sources to the
 * `principal:` form so every share request carries a resolvable href.
 *
 * The server enforces permissions (`write-acl`) and skips self-shares
 * (sharing a calendar with its owner is a no-op). HTTP-level failures
 * (400/401/403/404/network/timeout) surface as `CalDAVError` from the
 * request plumbing; callers gate the UI on the `sharing` capability first.
 */

import { CalDAVError, webdavRequest, type FetchLike } from './http';
import type { CalDAVCredentials } from './types';
import { escapeXmlText, firstText, parseMultistatus } from './xml';

export interface SharingDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Access level granted to a sharee. */
export type ShareAccess = 'read' | 'read-write';

/** A single share on a calendar, as reported by `oc:invite`. */
export interface CalendarShare {
  /** Sharee principal URI, e.g. `principal:principals/users/john`. */
  principal: string;
  /** Human-readable display name, or `null` when not reported. */
  displayName: string | null;
  /** Access level the sharee has. */
  access: ShareAccess;
}

/** The kind of principal a sharee is. */
export type PrincipalKind = 'user' | 'group' | 'room' | 'resource' | 'other';

/** A principal returned by the sharee search, ready to be shared with. */
export interface SharePrincipal {
  /** Principal URI usable directly in share requests. */
  principal: string;
  /** Human-readable display name. */
  displayName: string;
  /** The principal collection the sharee belongs to. */
  kind: PrincipalKind;
}

/** A sharee to add or update in a share mutation. */
export interface ShareSetEntry {
  /** Sharee principal URI (`principal:principals/...`). */
  principal: string;
  /** Display name to store alongside the share (optional). */
  displayName?: string;
  /** Access level to grant. */
  access: ShareAccess;
}

/** Maximum number of `oc:set` + `oc:remove` entries the server accepts. */
const MAX_SHARE_OPERATIONS = 10;

const LIST_SHARES_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:prop>
    <oc:invite/>
  </d:prop>
</d:propfind>`;

function principalSearchXml(query: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<D:principal-property-search xmlns:D="DAV:">
  <D:property-search>
    <D:prop><D:displayname/></D:prop>
    <D:match>${escapeXmlText(query)}</D:match>
  </D:property-search>
  <D:prop>
    <D:displayname/>
    <D:principal-URL/>
    <D:principal-collection-set/>
  </D:prop>
  <D:apply-to-principal-collection-set/>
</D:principal-property-search>`;
}

/**
 * Build the `oc:share` request body for a share mutation. Set entries
 * (add/update) are emitted before remove entries (revoke).
 */
export function buildShareRequestXml(sets: ShareSetEntry[], removes: string[]): string {
  const setXml = sets
    .map((set) => {
      const displayName =
        set.displayName !== undefined && set.displayName.trim() !== ''
          ? `<oc:common-name>${escapeXmlText(set.displayName)}</oc:common-name>`
          : '';
      const access = set.access === 'read-write' ? '<oc:read-write/>' : '';
      return `<oc:set><D:href>${escapeXmlText(set.principal)}</D:href>${displayName}${access}</oc:set>`;
    })
    .join('');
  const removeXml = removes
    .map((principal) => `<oc:remove><D:href>${escapeXmlText(principal)}</D:href></oc:remove>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<oc:share xmlns:oc="http://owncloud.org/ns" xmlns:D="DAV:">${setXml}${removeXml}</oc:share>`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/** Parse a single `oc:user` element of an `oc:invite` property. */
function parseShareEntry(entry: unknown): CalendarShare {
  const record = asRecord(entry) ?? {};
  const accessRecord = asRecord(record['access']) ?? {};
  return {
    principal: firstText(record['href']) ?? '',
    displayName: firstText(record['common-name']),
    access: 'read-write' in accessRecord ? 'read-write' : 'read',
  };
}

/**
 * List the current shares on a calendar (`PROPFIND` `oc:invite`). Returns an
 * empty list when the calendar has no shares (the server reports an empty
 * `oc:invite` container in that case).
 */
export async function listShares(
  credentials: CalDAVCredentials,
  calendarUrl: string,
  deps: SharingDeps = {},
): Promise<CalendarShare[]> {
  const { body } = await webdavRequest({
    credentials,
    method: 'PROPFIND',
    url: calendarUrl,
    depth: '0',
    body: LIST_SHARES_PROPFIND,
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
  const [response] = parseMultistatus(body);
  const invite = response ? response.properties['invite'] : undefined;
  const users = invite === undefined ? [] : asArray(asRecord(invite)?.['user']);
  return users.map((entry) => parseShareEntry(entry));
}

/**
 * Add, update, or revoke shares on a calendar (Nextcloud `oc:share` POST).
 *
 * `sets` adds or changes a sharee's access level (a set with the same
 * principal as an existing share updates it); `removes` revokes shares. The
 * server answers `200` on success. Throws `CalDAVError` for HTTP-level
 * failures (e.g. `forbidden` without `write-acl`, `bad_request` on a
 * malformed/oversized request).
 */
export async function updateShares(
  credentials: CalDAVCredentials,
  calendarUrl: string,
  sets: ShareSetEntry[],
  removes: string[],
  deps: SharingDeps = {},
): Promise<void> {
  const operations = sets.length + removes.length;
  if (operations === 0) {
    throw new CalDAVError(
      'bad_request',
      'Nothing to change: provide at least one share to add or remove.',
    );
  }
  if (operations > MAX_SHARE_OPERATIONS) {
    throw new CalDAVError(
      'bad_request',
      `Too many share changes in one request (at most ${MAX_SHARE_OPERATIONS}).`,
    );
  }
  // Normalize every sharee to the canonical `principal:` URI form. The server
  // silently drops sharees whose href it cannot resolve (a raw DAV path), so
  // this is the last line of defense before the request hits the wire.
  const normalizedSets = sets.map((set) => ({ ...set, principal: toPrincipalUri(set.principal) }));
  const normalizedRemoves = removes.map((remove) => toPrincipalUri(remove));
  await webdavRequest({
    credentials,
    method: 'POST',
    url: calendarUrl,
    body: buildShareRequestXml(normalizedSets, normalizedRemoves),
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
}

/**
 * Normalize a sharee identifier to the canonical `principal:principals/...`
 * URI form that the server's share handler resolves via `findByUri`. That
 * method only understands `principal:` and `mailto:` URIs — it returns no
 * result for a raw DAV path — so a share request carrying a DAV path is
 * **silently dropped**. The sharee search returns DAV paths in its
 * `principal-URL` property; `oc:invite` already reports the `principal:`
 * form. Normalizing to one form means both sources round-trip without
 * transformation. Already-canonical `principal:` (and `mailto:`) values are
 * returned unchanged, so this is idempotent.
 */
function toPrincipalUri(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('principal:') || trimmed.startsWith('mailto:')) {
    return trimmed;
  }
  const segments = trimmed.split('/').filter((segment) => segment !== '');
  const index = segments.indexOf('principals');
  if (index >= 0) {
    return `principal:${segments.slice(index).join('/')}`;
  }
  return trimmed;
}

/** Derive a sharee kind from a (normalized) principal URI. */
function principalKind(principal: string): PrincipalKind {
  const normalized = principal.replace(/^principal:/, '');
  const segments = normalized.split('/').filter((segment) => segment !== '');
  const index = segments.indexOf('principals');
  const bucket = index >= 0 ? segments[index + 1] : undefined;
  switch (bucket) {
    case 'users':
      return 'user';
    case 'groups':
      return 'group';
    case 'calendar-rooms':
      return 'room';
    case 'calendar-resources':
      return 'resource';
    default:
      return 'other';
  }
}

/**
 * Search for shareable users and groups by display name
 * (`DAV:principal-property-search` against the DAV collection root).
 * Returns an empty list for a blank query. Server-side enumeration settings
 * may limit the results; that is by design.
 */
export async function searchPrincipals(
  credentials: CalDAVCredentials,
  davRootUrl: string,
  query: string,
  deps: SharingDeps = {},
): Promise<SharePrincipal[]> {
  const trimmed = query.trim();
  if (trimmed === '') {
    return [];
  }
  const { body } = await webdavRequest({
    credentials,
    method: 'REPORT',
    url: davRootUrl,
    depth: '0',
    body: principalSearchXml(trimmed),
    fetchImpl: deps.fetchImpl,
    timeoutMs: deps.timeoutMs,
  });
  return parseMultistatus(body)
    .map((response) => {
      const rawPrincipal = firstText(response.properties['principal-URL']) ?? '';
      const displayName = firstText(response.properties['displayname']);
      if (rawPrincipal === '' || displayName === null) {
        return null;
      }
      // The search reports DAV paths; normalize to the `principal:` URI form
      // the share request must carry (see toPrincipalUri).
      const principal = toPrincipalUri(rawPrincipal);
      return { principal, displayName, kind: principalKind(principal) };
    })
    .filter((entry): entry is SharePrincipal => entry !== null);
}
