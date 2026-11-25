import { discoverCalendars } from './discovery';
import { CalDAVError, webdavRequest } from './http';
import type { MutationDeps } from './mutations';
import type { CalDAVCredentials, DiscoveredCalendars } from './types';

/** Recheck support and ownership immediately before each server mutation. */
export async function changeListTrashState(
  credentials: CalDAVCredentials,
  url: string,
  operation: 'trash' | 'restore',
  deps: MutationDeps = {},
): Promise<DiscoveredCalendars> {
  const before = await discoverCalendars(credentials, deps);
  if (!before.trash) {
    throw new CalDAVError('bad_request', 'Calendar Trash is not enabled on this server.');
  }
  const source = operation === 'trash' ? before.calendars : before.trash.lists;
  const list = source.find((calendar) => calendar.url === url);
  if (!list) {
    throw new CalDAVError('not_found', 'The list is no longer available. Refresh and try again.');
  }
  const target = new URL(url);
  const home = new URL(before.homeSetUrl);
  const child = target.pathname.slice(home.pathname.length);
  if (
    !list.isOwned ||
    !list.isTaskList ||
    (operation === 'trash' && !list.canWrite) ||
    target.origin !== home.origin ||
    !target.pathname.startsWith(home.pathname) ||
    !/^[^/]+\/$/.test(child) ||
    target.search ||
    target.hash ||
    child.toLowerCase() === 'contact_birthdays/'
  ) {
    throw new CalDAVError('forbidden', 'Only eligible lists you own can be moved or restored.');
  }

  await webdavRequest({
    credentials,
    ...deps,
    method: operation === 'trash' ? 'DELETE' : 'MOVE',
    url,
    headers:
      operation === 'restore'
        ? { Destination: new URL('restore/file', before.trash.url).href }
        : undefined,
  });

  const after = await discoverCalendars(credentials, deps);
  const destination = operation === 'trash' ? after.trash?.lists : after.calendars;
  if (
    !destination?.some(
      (calendar) => calendar.url === url && calendar.isOwned && calendar.isTaskList,
    )
  ) {
    throw new CalDAVError(
      'server_error',
      'The server did not confirm the change. Refresh to check the list.',
    );
  }
  return after;
}
