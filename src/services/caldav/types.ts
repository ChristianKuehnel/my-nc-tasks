/**
 * Shared types for the CalDAV/DAV protocol layer.
 *
 * The protocol layer speaks WebDAV XML and DAV endpoints only. It does not
 * know about React or SQLite. All URLs in results are absolute.
 */

/** Credentials for DAV basic auth (from a Login Flow v2 session). */
export interface CalDAVCredentials {
  /** Normalized server base URL (no trailing slash). */
  serverUrl: string;
  /** Login name used for WebDAV basic auth. */
  loginName: string;
  /** App-specific password issued by the server. */
  appPassword: string;
}

/** A single DAV:response entry of a multistatus document. */
export interface DAVResponse {
  /** The href of this response (as returned by the server). */
  href: string;
  /** Flattened property map: property name -> parsed value. */
  properties: Record<string, unknown>;
}

/** A discovered calendar with ownership and permission state. */
export interface CalDAVCalendar {
  /** Absolute URL of the calendar. */
  url: string;
  /** Human-readable name (falls back to the last URL segment). */
  displayName: string;
  /** Supported calendar component names, e.g. `["VEVENT", "VTODO"]`. */
  components: string[];
  /** True when the calendar supports VTODO (a task list). */
  isTaskList: boolean;
  /** Absolute URL of the owning principal, or null if not reported. */
  ownerUrl: string | null;
  /** True when the owner is the authenticated user's principal. */
  isOwned: boolean;
  /** True when the calendar exists but is owned by someone else. */
  isSharedWithMe: boolean;
  /** User addresses listed in calendar-user-address-set (if reported). */
  sharedAddresses: string[];
  /** Current user may read calendar contents (DAV:read or read-free-busy). */
  canRead: boolean;
  /** Current user may modify contents (DAV:write). */
  canWrite: boolean;
}

/**
 * Server capabilities detected from the DAV feature header (the `DAV:`
 * response header advertised by Nextcloud/SabreDAV).
 */
export interface CalDAVCapabilities {
  /**
   * The server supports resource sharing via the `oc-resource-sharing`
   * extension (this app's sharing protocol). When `false`, the sharing UI
   * must stay hidden — the server will reject share requests.
   */
  sharing: boolean;
}

/** Result of a full discovery run. */
export interface DiscoveredCalendars {
  /** Absolute principal URL of the authenticated user. */
  principalUrl: string;
  /** Absolute calendar home set URL. */
  homeSetUrl: string;
  /** Absolute DAV collection root URL (target of principal search). */
  davRootUrl: string;
  /** All calendars in the home set (owned and shared), in server order. */
  calendars: CalDAVCalendar[];
  /** Enabled Nextcloud calendar trash and its owned task lists, if discovered. */
  trash?: { url: string; lists: CalDAVCalendar[] };
  /** Capabilities detected from the server's DAV feature header. */
  capabilities: CalDAVCapabilities;
}
