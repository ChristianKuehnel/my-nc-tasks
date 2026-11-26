export { CalDAVError, webdavRequest } from './http';
export type { CalDAVErrorCode, FetchLike } from './http';
export { discoverCalendars, parseDavFeatures, davRootUrl } from './discovery';
export type { DiscoveryDeps } from './discovery';
export { buildMkCalendarBody, calendarSlug, createCalendar } from './collections';
export type { CreateCalendarDeps, CreateCalendarResult } from './collections';
export {
  listTasks,
  readTask,
  createTask,
  updateTask,
  updateTaskRecurrence,
  deleteTask,
  setTaskParent,
  moveTask,
} from './tasks';
export { readTaskRecurrence } from './vtodo';
export type { DavTask } from './tasks';
export type {
  BasicTaskChange,
  SimpleTaskRecurrence,
  TaskRecurrence,
  TaskMetadataChange,
  TaskOccurrence,
  TaskRelationship,
  TaskTime,
  VTodoResource,
} from './vtodo';
export { buildShareRequestXml, listShares, updateShares, searchPrincipals } from './sharing';
export type {
  SharingDeps,
  ShareAccess,
  CalendarShare,
  SharePrincipal,
  PrincipalKind,
  ShareSetEntry,
} from './sharing';
export { parseMultistatus, firstText, textList, escapeXmlText } from './xml';
export type {
  CalDAVCredentials,
  CalDAVCalendar,
  DiscoveredCalendars,
  DAVResponse,
  CalDAVCapabilities,
} from './types';
