import ICAL from 'ical.js';

export type TaskTime =
  | { kind: 'date' | 'floating' | 'utc'; value: string }
  | { kind: 'zoned'; value: string; tzid: string };

export interface TaskOccurrence {
  readonly uid: string;
  readonly summary: string | null;
  readonly start: TaskTime | null;
  readonly due: TaskTime | null;
  readonly recurrenceId: TaskTime | null;
}

/** Represents one CalDAV resource, which may contain several instances of a series. */
export interface VTodoResource {
  readonly occurrences: readonly TaskOccurrence[];
  /** Serialize the original resource without rewriting unmodeled data. */
  serialize(): string;
}

function taskTime(component: ICAL.Component, name: string): TaskTime | null {
  const property = component.getFirstProperty(name);
  if (!property) return null;
  // Read the iCalendar wall time without resolving it against device time or
  // consulting a global timezone registry.
  const [, , type, value]: unknown[] = property.toJSON();
  if (typeof value !== 'string') throw new Error(`Invalid VTODO ${name}`);
  if (type === 'date') return { kind: 'date', value };
  if (type !== 'date-time') throw new Error(`Invalid VTODO ${name} type`);
  const tzid = property.getParameter('tzid');
  if (typeof tzid === 'string' && tzid.length > 0) return { kind: 'zoned', value, tzid };
  return { kind: value.endsWith('Z') ? 'utc' : 'floating', value };
}

/** ical.js accepts mismatched END markers; reject those before exposing a task. */
function assertMatchingComponents(source: string): void {
  const stack: string[] = [];
  for (const line of source.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    const marker = /^(BEGIN|END):([A-Z0-9-]+)$/i.exec(line);
    if (!marker) continue;
    const name = marker[2].toLowerCase();
    if (marker[1].toLowerCase() === 'begin') {
      stack.push(name);
    } else if (stack.pop() !== name) {
      throw new Error('Mismatched iCalendar component markers');
    }
  }
  if (stack.length !== 0) throw new Error('Unclosed iCalendar component');
}

export function parseVTodoResource(source: string): VTodoResource {
  assertMatchingComponents(source);
  const parsed: unknown = ICAL.parse(source);
  if (!Array.isArray(parsed) || parsed[0] !== 'vcalendar') {
    throw new Error('Expected a single VCALENDAR resource');
  }
  const calendar = new ICAL.Component(parsed);
  const todos = calendar.getAllSubcomponents('vtodo');
  if (todos.length === 0) throw new Error('VCALENDAR does not contain a VTODO');
  if (calendar.getAllSubcomponents().some(({ name }) => name !== 'vtodo' && name !== 'vtimezone')) {
    throw new Error('Expected a VTODO-only calendar resource');
  }
  const occurrences = todos.map((todo): TaskOccurrence => {
    const uid: unknown = todo.getFirstPropertyValue('uid');
    if (typeof uid !== 'string' || uid.trim() === '' || todo.getAllProperties('uid').length !== 1) {
      throw new Error('VTODO must have one non-empty UID');
    }
    const summary: unknown = todo.getFirstPropertyValue('summary');
    return {
      uid,
      summary: typeof summary === 'string' ? summary : null,
      start: taskTime(todo, 'dtstart'),
      due: taskTime(todo, 'due'),
      recurrenceId: taskTime(todo, 'recurrence-id'),
    };
  });
  if (occurrences.some(({ uid }) => uid !== occurrences[0].uid)) {
    throw new Error('VTODO instances in one resource must share a UID');
  }
  return { occurrences, serialize: () => source };
}

/** Create a new minimal task. The caller provides its stable UID and UTC timestamp. */
export function createVTodoResource(uid: string, summary: string, stamp: Date): VTodoResource {
  if (uid.trim() === '' || hasControlCharacters(uid, false)) throw new Error('Invalid VTODO UID');
  if (hasControlCharacters(summary, true)) {
    throw new Error('Invalid VTODO summary');
  }
  const year = stamp.getUTCFullYear();
  if (!Number.isFinite(year) || year < 1 || year > 9999) throw new Error('Invalid VTODO date');
  const calendar = new ICAL.Component('vcalendar');
  calendar.addPropertyWithValue('version', '2.0');
  calendar.addPropertyWithValue('prodid', '-//my-nc-tasks//CalDAV//EN');
  const todo = new ICAL.Component('vtodo');
  todo.addPropertyWithValue('uid', uid);
  todo.addPropertyWithValue(
    'dtstamp',
    ICAL.Time.fromDateTimeString(stamp.toISOString().replace(/\.\d{3}Z$/, 'Z')),
  );
  todo.addPropertyWithValue('summary', summary.replace(/\r\n?/g, '\n'));
  calendar.addSubcomponent(todo);
  return parseVTodoResource(`${calendar.toString()}\r\n`);
}

function hasControlCharacters(value: string, allowWhitespace: boolean): boolean {
  return [...value].some((character) => {
    if (allowWhitespace && '\t\r\n'.includes(character)) return false;
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
