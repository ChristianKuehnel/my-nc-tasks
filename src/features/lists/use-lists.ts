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
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createCalendar, type CreateCalendarDeps } from '@/services/caldav/collections';
import { CalDAVError } from '@/services/caldav/http';
import { discoverCalendars } from '@/services/caldav/discovery';
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
  /** Re-run discovery (retry + refresh after changes). */
  refresh: () => void;
  /** Create a new VTODO list; the name is trimmed server-side by re-discovery. */
  createList: (name: string) => Promise<void>;
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
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const homeSetRef = useRef<string | null>(null);

  const applyDiscovery = useCallback((discovered: DiscoveredCalendars) => {
    homeSetRef.current = discovered.homeSetUrl;
    setCalendars(discovered.calendars.filter((calendar) => calendar.isTaskList));
    setStatus('ready');
  }, []);

  const applyDiscoveryError = useCallback((err: unknown) => {
    setError(describeError(err));
    setCalendars([]);
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

  const createList = useCallback(
    async (name: string) => {
      const homeSetUrl = homeSetRef.current;
      if (homeSetUrl === null || isCreating) {
        return;
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
      } catch (err) {
        setCreateError(describeError(err));
      } finally {
        setIsCreating(false);
      }
    },
    [serverUrl, loginName, appPassword, fetchImpl, timeoutMs, isCreating, discover, applyDiscovery],
  );

  const owned = calendars.filter((calendar) => calendar.isOwned);
  const shared = calendars.filter((calendar) => !calendar.isOwned);

  return { status, error, owned, shared, isCreating, createError, refresh, createList };
}
