export { CalDAVError, webdavRequest } from './http';
export type { CalDAVErrorCode, FetchLike } from './http';
export { discoverCalendars } from './discovery';
export type { DiscoveryDeps } from './discovery';
export { buildMkCalendarBody, createCalendar } from './collections';
export type { CreateCalendarDeps, CreateCalendarResult } from './collections';
export { parseMultistatus, firstText, textList, escapeXmlText } from './xml';
export type { CalDAVCredentials, CalDAVCalendar, DiscoveredCalendars, DAVResponse } from './types';
