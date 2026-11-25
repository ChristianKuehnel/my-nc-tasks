/**
 * Task list state for the lists screen (Phase 1.3).
 *
 * Wraps the discovery service (Phase 1.2) and the MKCALENDAR creation
 * (Phase 1.3) in a small state machine:
 *
 *   loading -> ready
 *     |        ^
 *     +-> error + (retry)
 *
 * `createList` runs creation first and re-discovers afterwards, so the
 * rendered state always reflects the server (no optimistic assumptions
 * about server-side name normalization or ordering).
 *
 * Phase 1.4 adds the list mutations — `renameList`, `deleteList`, and
 * `unsubscribeList` — which follow the same run-then-re-discover pattern and
 * surface a shared `mutationError` (the screen shows it in the open dialog).
 * Permission awareness (only owned lists can be renamed/deleted, only shared
 * lists unsubscribed) is enforced at the call sites; the server re-enforces
 * it and the resulting `CalDAVError` is surfaced.
 *
 * Phase 1.5 adds list sharing (Nextcloud `oc-resource-sharing`): a
 * capability flag (`sharingSupported`) so the UI only offers sharing when the
 * server supports it, per-calendar share state (`getShares` /
 * `refreshShares`), sharee search (`searchSharePrincipals`), and the share
 * mutations (`shareCalendar`, `updateShareAccess`, `revokeShare`). Share
 * mutations re-fetch just that calendar's shares (no full re-discovery).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createCalendar, type CreateCalendarDeps } from '@/services/caldav/collections';
import { CalDAVError } from '@/services/caldav/http';
import { discoverCalendars } from '@/services/caldav/discovery';
import { deleteCalendar, renameCalendar, unsubscribeCalendar } from '@/services/caldav/mutations';
import { changeListTrashState } from '@/services/caldav/trash';
import {
  listShares,
  searchPrincipals,
  updateShares,
  type CalendarShare,
  type ShareAccess,
  type SharePrincipal,
} from '@/services/caldav/sharing';
import type {
  CalDAVCalendar,
  CalDAVCredentials,
  DiscoveredCalendars,
} from '@/services/caldav/types';

export type ListsStatus = 'loading' | 'error' | 'ready';

export interface UseListsResult {
  status: ListsStatus;
  /** Human-readable discovery failure message, or `null`. */
  error: string | null;
  /** Task lists (VTODO-capable calendars) owned by the user. */
  owned: CalDAVCalendar[];
  /** Task lists shared with the user. */
  shared: CalDAVCalendar[];
  isCreating: boolean;
  /** Human-readable creation failure message, or `null`. Cleared per attempt. */
  createError: string | null;
  /** True while a rename/delete/unsubscribe mutation is in flight. */
  isMutating: boolean;
  /** Human-readable mutation failure message, or `null`. Cleared per attempt. */
  mutationError: string | null;
  /** True when the server advertises the `oc-resource-sharing` extension. */
  sharingSupported: boolean;
  /** True while a share search/mutation is in flight. */
  isSharing: boolean;
  /** Human-readable share failure message, or `null`. Cleared per attempt. */
  shareError: string | null;
  /** Current shares for a calendar URL, or `[]` when not yet loaded. */
  getShares: (calendarUrl: string) => CalendarShare[];
  /** (Re)load the current shares for a calendar. */
  refreshShares: (calendarUrl: string) => Promise<void>;
  /** Search shareable users and groups by display name. */
  searchSharePrincipals: (query: string) => Promise<SharePrincipal[]>;
  /** Share a calendar with a principal at the given access level. */
  shareCalendar: (calendarUrl: string, principal: string, access: ShareAccess) => Promise<boolean>;
  /** Update the access level of an existing share (same server call as share). */
  updateShareAccess: (
    calendarUrl: string,
    principal: string,
    access: ShareAccess,
  ) => Promise<boolean>;
  /** Revoke a share by the sharee's principal. */
  revokeShare: (calendarUrl: string, principal: string) => Promise<boolean>;
  /** Re-run discovery (retry + refresh after changes). */
  refresh: () => void;
  /**
   * Create a new VTODO list; the name is trimmed server-side by re-discovery.
   * Resolves `true` on success (dialog can close), `false` on failure.
   */
  createList: (name: string) => Promise<boolean>;
  /**
   * Rename a list (PROPPATCH displayname); the caller pre-validates the name.
   * Resolves `true` on success, `false` on failure.
   */
  renameList: (url: string, displayName: string) => Promise<boolean>;
  /** Permanently delete an owned list (DAV DELETE, no trashbin). */
  deleteList: (url: string) => Promise<boolean>;
  trashSupported: boolean;
  trashed: CalDAVCalendar[];
  trashList: (url: string) => Promise<boolean>;
  restoreList: (url: string) => Promise<boolean>;
  /** Unsubscribe from a shared list (removes the share, not the owner's data). */
  unsubscribeList: (url: string) => Promise<boolean>;
}

function describeError(err: unknown): string {
  if (err instanceof CalDAVError) {
    return err.message;
  }
  if (err instanceof Error && err.message !== '') {
    return err.message;
  }
  return 'Something went wrong.';
}

export function useLists(
  credentials: CalDAVCredentials,
  options: CreateCalendarDeps = {},
): UseListsResult {
  const { serverUrl, loginName, appPassword } = credentials;
  const { fetchImpl, timeoutMs } = options;
  const [status, setStatus] = useState<ListsStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<CalDAVCalendar[]>([]);
  const [trash, setTrash] = useState<DiscoveredCalendars['trash']>();
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [sharingSupported, setSharingSupported] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shares, setShares] = useState<Record<string, CalendarShare[]>>({});
  const homeSetRef = useRef<string | null>(null);
  const davRootRef = useRef<string | null>(null);

  const applyDiscovery = useCallback((discovered: DiscoveredCalendars) => {
    homeSetRef.current = discovered.homeSetUrl;
    davRootRef.current = discovered.davRootUrl;
    setSharingSupported(discovered.capabilities.sharing);
    setTrash(discovered.trash);
    // A fresh discovery invalidates any per-calendar share state (calendars
    // may have been added or removed server-side).
    setShares({});
    setCalendars(discovered.calendars.filter((calendar) => calendar.isTaskList));
    setStatus('ready');
  }, []);

  const applyDiscoveryError = useCallback((err: unknown) => {
    setError(describeError(err));
    setCalendars([]);
    setTrash(undefined);
    setStatus('error');
  }, []);

  const discover = useCallback(
    () => discoverCalendars({ serverUrl, loginName, appPassword }, { fetchImpl, timeoutMs }),
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs],
  );

  useEffect(() => {
    // The initial state is already `loading`; the setState calls happen inside
    // the promise callbacks, not synchronously in the effect body.
    discover().then(applyDiscovery).catch(applyDiscoveryError);
  }, [discover, applyDiscovery, applyDiscoveryError]);

  const refresh = useCallback(() => {
    setStatus('loading');
    setError(null);
    discover().then(applyDiscovery).catch(applyDiscoveryError);
  }, [discover, applyDiscovery, applyDiscoveryError]);

  /**
   * Run a list mutation (rename / delete / unsubscribe) and re-discover so
   * the rendered state always matches the server. Clears and reports
   * `mutationError` around the call. Guarded so only one mutation is in
   * flight at a time. Resolves `true` on success, `false` on failure or when
   * blocked (already mutating).
   */
  const runMutation = useCallback(
    async (mutate: () => Promise<void | DiscoveredCalendars>): Promise<boolean> => {
      if (isMutating) {
        return false;
      }
      setMutationError(null);
      setIsMutating(true);
      try {
        const result = await mutate();
        // Re-discover so the renamed / removed list reflects the server
        // (new name, ordering, permissions).
        applyDiscovery(result ?? (await discover()));
        return true;
      } catch (err) {
        setMutationError(describeError(err));
        return false;
      } finally {
        setIsMutating(false);
      }
    },
    [isMutating, applyDiscovery, discover],
  );

  const createList = useCallback(
    async (name: string): Promise<boolean> => {
      const homeSetUrl = homeSetRef.current;
      if (homeSetUrl === null || isCreating) {
        return false;
      }
      setCreateError(null);
      setIsCreating(true);
      try {
        await createCalendar({ serverUrl, loginName, appPassword }, homeSetUrl, name, {
          fetchImpl,
          timeoutMs,
        });
        // Re-discover so the new list appears exactly as the server reports
        // it (display name, order, permissions).
        applyDiscovery(await discover());
        return true;
      } catch (err) {
        setCreateError(describeError(err));
        return false;
      } finally {
        setIsCreating(false);
      }
    },
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs, isCreating, discover, applyDiscovery],
  );

  const renameList = useCallback(
    (url: string, displayName: string) =>
      runMutation(() =>
        renameCalendar({ serverUrl, loginName, appPassword }, url, displayName, {
          fetchImpl,
          timeoutMs,
        }),
      ),
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs, runMutation],
  );

  const deleteList = useCallback(
    (url: string) =>
      runMutation(() =>
        deleteCalendar({ serverUrl, loginName, appPassword }, url, {
          fetchImpl,
          timeoutMs,
        }),
      ),
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs, runMutation],
  );

  const unsubscribeList = useCallback(
    (url: string) =>
      runMutation(() =>
        unsubscribeCalendar({ serverUrl, loginName, appPassword }, url, {
          fetchImpl,
          timeoutMs,
        }),
      ),
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs, runMutation],
  );

  const changeTrash = useCallback(
    (url: string, operation: 'trash' | 'restore') =>
      runMutation(() =>
        changeListTrashState({ serverUrl, loginName, appPassword }, url, operation, {
          fetchImpl,
          timeoutMs,
        }),
      ),
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs, runMutation],
  );

  /**
   * Run a share mutation (add / change access / revoke) and re-fetch just that
   * calendar's shares so the dialog reflects the server. Clears and reports
   * `shareError` around the call. Guarded so only one share operation is in
   * flight at a time. Resolves `true` on success, `false` on failure or when
   * blocked (already sharing).
   */
  const runShareMutation = useCallback(
    async (calendarUrl: string, mutate: () => Promise<void>): Promise<boolean> => {
      if (isSharing) {
        return false;
      }
      setShareError(null);
      setIsSharing(true);
      try {
        await mutate();
        const current = await listShares({ serverUrl, loginName, appPassword }, calendarUrl, {
          fetchImpl,
          timeoutMs,
        });
        setShares((prev) => ({ ...prev, [calendarUrl]: current }));
        return true;
      } catch (err) {
        setShareError(describeError(err));
        return false;
      } finally {
        setIsSharing(false);
      }
    },
    [isSharing, serverUrl, loginName, appPassword, fetchImpl, timeoutMs],
  );

  const refreshShares = useCallback(
    async (calendarUrl: string) => {
      try {
        const current = await listShares({ serverUrl, loginName, appPassword }, calendarUrl, {
          fetchImpl,
          timeoutMs,
        });
        setShares((prev) => ({ ...prev, [calendarUrl]: current }));
      } catch (err) {
        setShareError(describeError(err));
      }
    },
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs],
  );

  const searchSharePrincipals = useCallback(
    async (query: string): Promise<SharePrincipal[]> => {
      const davRoot = davRootRef.current;
      if (davRoot === null) {
        return [];
      }
      try {
        return await searchPrincipals({ serverUrl, loginName, appPassword }, davRoot, query, {
          fetchImpl,
          timeoutMs,
        });
      } catch (err) {
        setShareError(describeError(err));
        return [];
      }
    },
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs],
  );

  const shareCalendar = useCallback(
    (calendarUrl: string, principal: string, access: ShareAccess) =>
      runShareMutation(calendarUrl, () =>
        updateShares(
          { serverUrl, loginName, appPassword },
          calendarUrl,
          [{ principal, access }],
          [],
          { fetchImpl, timeoutMs },
        ),
      ),
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs, runShareMutation],
  );

  const updateShareAccess = useCallback(
    (calendarUrl: string, principal: string, access: ShareAccess) =>
      runShareMutation(calendarUrl, () =>
        updateShares(
          { serverUrl, loginName, appPassword },
          calendarUrl,
          [{ principal, access }],
          [],
          { fetchImpl, timeoutMs },
        ),
      ),
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs, runShareMutation],
  );

  const revokeShare = useCallback(
    (calendarUrl: string, principal: string) =>
      runShareMutation(calendarUrl, () =>
        updateShares({ serverUrl, loginName, appPassword }, calendarUrl, [], [principal], {
          fetchImpl,
          timeoutMs,
        }),
      ),
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs, runShareMutation],
  );

  const getShares = useCallback((calendarUrl: string) => shares[calendarUrl] ?? [], [shares]);

  const owned = calendars.filter((calendar) => calendar.isOwned);
  const shared = calendars.filter((calendar) => !calendar.isOwned);

  return {
    status,
    error,
    owned,
    shared,
    isCreating,
    createError,
    isMutating,
    mutationError,
    sharingSupported,
    isSharing,
    shareError,
    getShares,
    refreshShares,
    searchSharePrincipals,
    shareCalendar,
    updateShareAccess,
    revokeShare,
    refresh,
    createList,
    renameList,
    deleteList,
    trashSupported: trash !== undefined,
    trashed: trash?.lists ?? [],
    trashList: (url) => changeTrash(url, 'trash'),
    restoreList: (url) => changeTrash(url, 'restore'),
    unsubscribeList,
  };
}
