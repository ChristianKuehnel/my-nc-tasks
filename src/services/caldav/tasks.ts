import { CalDAVError, webdavRequest } from './http';
import type { MutationDeps } from './mutations';
import type { CalDAVCalendar, CalDAVCredentials } from './types';
import {
  assertSingleTask,
  createVTodoResource,
  editBasicTask,
  parseVTodoResource,
  type BasicTaskChange,
  type VTodoResource,
} from './vtodo';
import { parseMultistatus } from './xml';

export interface DavTask {
  url: string;
  etag: string | null;
  resource: VTodoResource;
}

const TASK_QUERY = `<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO"/></C:comp-filter></C:filter>
</C:calendar-query>`;

function requireAccess(calendar: CalDAVCalendar, write = false): void {
  if (!calendar.isTaskList || !(write ? calendar.canWrite : calendar.canRead)) {
    throw new CalDAVError(
      'forbidden',
      write ? 'This list is not writable.' : 'This list is not readable.',
    );
  }
}

function taskUrl(calendar: CalDAVCalendar, href: string): string {
  const parent = new URL(calendar.url);
  const base = parent.pathname.replace(/\/?$/, '/');
  try {
    const url = new URL(href, new URL(base, parent));
    const name = decodeURIComponent(url.pathname.slice(base.length));
    if (
      url.origin === parent.origin &&
      url.pathname.startsWith(base) &&
      name !== '' &&
      name !== '.' &&
      name !== '..' &&
      !/[\\/]/.test(name) &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    // Unsafe or malformed href; never pass it to the authenticated client.
  }
  throw new CalDAVError('bad_request', 'Task URL must identify an item directly in this list.');
}

function strongEtag(etag: string | null): string {
  if (etag && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)) return etag;
  throw new CalDAVError('conflict', 'The server did not provide a strong task revision.');
}

function requireMutationStatus(status: number): void {
  if (![200, 201, 204].includes(status)) {
    throw new CalDAVError(
      'server_error',
      `The server did not confirm the task change (HTTP ${status}).`,
    );
  }
}

export async function readTask(
  credentials: CalDAVCredentials,
  calendar: CalDAVCalendar,
  href: string,
  deps: MutationDeps = {},
): Promise<DavTask> {
  requireAccess(calendar);
  const url = taskUrl(calendar, href);
  const response = await webdavRequest({ ...deps, credentials, method: 'GET', url });
  return { url, etag: response.headers.etag ?? null, resource: parseVTodoResource(response.body) };
}

/** REPORT finds VTODO URLs; GET obtains each original body and its matching ETag. */
export async function listTasks(
  credentials: CalDAVCredentials,
  calendar: CalDAVCalendar,
  deps: MutationDeps = {},
): Promise<DavTask[]> {
  requireAccess(calendar);
  const response = await webdavRequest({
    ...deps,
    credentials,
    method: 'REPORT',
    url: calendar.url,
    depth: '1',
    body: TASK_QUERY,
  });
  if (response.status !== 207)
    throw new CalDAVError('server_error', 'Expected a task multistatus.');
  const urls = new Set(parseMultistatus(response.body).map(({ href }) => taskUrl(calendar, href)));
  const tasks: DavTask[] = [];
  for (const url of urls) tasks.push(await readTask(credentials, calendar, url, deps));
  return tasks;
}

export async function createTask(
  credentials: CalDAVCredentials,
  calendar: CalDAVCalendar,
  uid: string,
  summary: string,
  at: Date,
  deps: MutationDeps = {},
): Promise<string> {
  requireAccess(calendar, true);
  // Caller supplies a unique UID; double encoding is not needed for the URL segment.
  const url = taskUrl(calendar, `./${encodeURIComponent(uid)}.ics`);
  const { status } = await webdavRequest({
    ...deps,
    credentials,
    method: 'PUT',
    url,
    headers: { 'If-None-Match': '*' },
    contentType: 'text/calendar; charset=utf-8',
    body: createVTodoResource(uid, summary, at).serialize(),
  });
  requireMutationStatus(status);
  return url;
}

export async function updateTask(
  credentials: CalDAVCredentials,
  calendar: CalDAVCalendar,
  task: DavTask,
  change: BasicTaskChange,
  deps: MutationDeps = {},
): Promise<void> {
  requireAccess(calendar, true);
  const { status } = await webdavRequest({
    ...deps,
    credentials,
    method: 'PUT',
    url: taskUrl(calendar, task.url),
    headers: { 'If-Match': strongEtag(task.etag) },
    contentType: 'text/calendar; charset=utf-8',
    body: editBasicTask(task.resource.serialize(), change),
  });
  requireMutationStatus(status);
}

export async function deleteTask(
  credentials: CalDAVCredentials,
  calendar: CalDAVCalendar,
  task: DavTask,
  deps: MutationDeps = {},
): Promise<void> {
  requireAccess(calendar, true);
  assertSingleTask(task.resource.serialize());
  const { status } = await webdavRequest({
    ...deps,
    credentials,
    method: 'DELETE',
    url: taskUrl(calendar, task.url),
    headers: { 'If-Match': strongEtag(task.etag) },
  });
  requireMutationStatus(status);
}
