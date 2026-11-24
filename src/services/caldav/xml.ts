/**
 * Minimal, namespace-tolerant parsing of DAV XML documents.
 *
 * DAV servers may declare any prefix for the `DAV:` and
 * `http://calendarserver.org/ns/` namespaces (e.g. `<D:multistatus
 * xmlns:D="DAV:">`, `<d:multistatus xmlns:d="DAV:">`, or no prefix at all
 * with a default namespace). Prefixes are therefore stripped before
 * matching, which makes the parsing independent of the server's choice.
 */

import { XMLParser } from 'fast-xml-parser';

import type { DAVResponse } from './types';

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  cdataPropName: '__cdata',
});

export const ATTR_PREFIX = '@_';

/** Read a flat `@_<name>` attribute (fast-xml-parser stores attributes
 * inline with the configured prefix, not nested under a parent key). */
function attr(record: Record<string, unknown>, name: string): string | null {
  const value = record[`${ATTR_PREFIX}${name}`];
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return null;
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

/** A text node value, or null when absent. Tolerates `{ href: ... }` wrappers. */
export function firstText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.trim() !== '' ? value.trim() : null;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const record = asRecord(value);
  if (record) {
    for (const key of ['href', 'cur', 'addr', 'text']) {
      if (key in record) {
        const nested = firstText(record[key]);
        if (nested !== null) {
          return nested;
        }
      }
    }
    // `DAV:cur/@uri` style attribute wrappers (current-user-principal and
    // calendar-home-set as reported by SabreDAV).
    for (const name of ['uri', 'href', 'address']) {
      const value = attr(record, name);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

/** All text values of a property that may repeat (single value -> one entry). */
export function textList(value: unknown): string[] {
  return asArray(value)
    .map((entry) => firstText(entry))
    .filter((entry): entry is string => entry !== null);
}

/** Escape a string for inclusion as XML character data. */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Parse a `DAV:multistatus` document into response entries with a flattened
 * property map. Properties from all `propstat` blocks are merged; a 404
 * propstat is recorded but its (empty) prop is ignored.
 */
export function parseMultistatus(xml: string): DAVResponse[] {
  let root: unknown;
  try {
    root = parser.parse(xml);
  } catch {
    throw new Error('Invalid DAV XML document');
  }

  const multistatus = asRecord(asRecord(root)?.multistatus);
  if (!multistatus) {
    throw new Error('DAV document is not a multistatus response');
  }

  return asArray(multistatus.response).map((entry) => {
    const record = asRecord(entry);
    if (!record) {
      throw new Error('DAV response entry is malformed');
    }
    const href = firstText(record.href);
    if (href === null) {
      throw new Error('DAV response entry is missing its href');
    }

    const properties: Record<string, unknown> = {};
    for (const propstat of asArray(record.propstat)) {
      const propstatRecord = asRecord(propstat);
      if (!propstatRecord) {
        continue;
      }
      const status = firstText(propstatRecord.status) ?? '';
      const notFound = /40[0-9]/.test(status);
      const prop = asRecord(propstatRecord.prop);
      if (notFound || !prop) {
        continue;
      }
      Object.assign(properties, prop);
    }

    return { href, properties };
  });
}

/** One property entry of a RFC 3744 `PROPPATCH` response. */
export interface PropStatEntry {
  /** Property name (namespace prefix stripped), e.g. `displayname`. */
  property: string;
  /** HTTP status code reported for the property (`0` when unparsable). */
  status: number;
}

/**
 * Parse a RFC 3744 `PROPPATCH` multistatus into the per-property HTTP status
 * codes reported by the server.
 *
 * Unlike `parseMultistatus`, this keeps the `propstat` boundaries and their
 * statuses. A PROPPATCH is reported with an overall HTTP 207 even when the
 * server *refused* a property (a `403`/`404` propstat for the rejected
 * property), so a caller must inspect the per-property status to know whether
 * a specific property — e.g. `displayname` — was actually applied.
 *
 * A single property can appear in several propstat blocks; every reported
 * status is returned, in document order. Returns `[]` when the document is
 * not a parseable multistatus.
 */
export function parsePropPatchPropStats(xml: string): PropStatEntry[] {
  let root: unknown;
  try {
    root = parser.parse(xml);
  } catch {
    return [];
  }
  const multistatus = asRecord(asRecord(root)?.multistatus);
  if (!multistatus) {
    return [];
  }

  const entries: PropStatEntry[] = [];
  for (const response of asArray(multistatus.response)) {
    const record = asRecord(response);
    if (!record) {
      continue;
    }
    for (const propstat of asArray(record.propstat)) {
      const propstatRecord = asRecord(propstat);
      if (!propstatRecord) {
        continue;
      }
      const statusText = firstText(propstatRecord.status) ?? '';
      const match = /HTTP\/[\d.]+\s+(\d{3})/.exec(statusText);
      const status = match ? Number(match[1]) : 0;
      const prop = asRecord(propstatRecord.prop);
      if (!prop) {
        continue;
      }
      for (const name of Object.keys(prop)) {
        if (name.startsWith(ATTR_PREFIX)) {
          continue;
        }
        entries.push({ property: name, status });
      }
    }
  }
  return entries;
}
