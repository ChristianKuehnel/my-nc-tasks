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
  readonly completed: boolean;
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
      completed:
        todo.getFirstPropertyValue('status') === 'COMPLETED' || todo.hasProperty('completed'),
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
  const calendar = new ICAL.Component('vcalendar');
  calendar.addPropertyWithValue('version', '2.0');
  calendar.addPropertyWithValue('prodid', '-//my-nc-tasks//CalDAV//EN');
  const todo = new ICAL.Component('vtodo');
  todo.addPropertyWithValue('uid', uid);
  todo.addPropertyWithValue('dtstamp', ICAL.Time.fromDateTimeString(utcStamp(stamp)));
  todo.addPropertyWithValue('summary', summary.replace(/\r\n?/g, '\n'));
  calendar.addSubcomponent(todo);
  return parseVTodoResource(`${calendar.toString()}\r\n`);
}

function utcStamp(stamp: Date): string {
  const year = stamp.getUTCFullYear();
  if (!Number.isFinite(year) || year < 1 || year > 9999) throw new Error('Invalid VTODO date');
  return stamp.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export type BasicTaskChange = { summary: string } | { completed: boolean; at: Date };

/** Refuse to update or delete a recurrence with an operation for one task. */
export function assertSingleTask(source: string): void {
  const parsed = parseVTodoResource(source);
  const todo = new ICAL.Component(ICAL.parse(source)).getFirstSubcomponent('vtodo');
  if (
    parsed.occurrences.length !== 1 ||
    ['rrule', 'rdate', 'exdate', 'exrule', 'recurrence-id'].some((name) => todo?.hasProperty(name))
  ) {
    throw new Error('Recurring tasks cannot be changed with basic task operations.');
  }
}

/** Replace only the selected top-level VTODO properties; keep other lines intact. */
export function editBasicTask(source: string, change: BasicTaskChange): string {
  assertSingleTask(source);
  const properties = new Map<string, string | null>();
  if ('summary' in change) {
    if (hasControlCharacters(change.summary, true)) throw new Error('Invalid VTODO summary');
    properties.set('summary', change.summary.replace(/\r\n?/g, '\n'));
  } else {
    properties.set('status', change.completed ? 'COMPLETED' : 'NEEDS-ACTION');
    properties.set('percent-complete', change.completed ? '100' : '0');
    properties.set('completed', change.completed ? utcStamp(change.at) : null);
  }
  const todo = new ICAL.Component(ICAL.parse(source)).getFirstSubcomponent('vtodo');
  for (const name of properties.keys()) {
    if ((todo?.getAllProperties(name).length ?? 0) > 1) throw new Error(`Ambiguous VTODO ${name}`);
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
  const groups: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && groups.length) groups[groups.length - 1] += line;
    else groups.push(line);
  }
  const stack: string[] = [];
  const output: string[] = [];
  function serialize(name: string, value: string, original?: string): string {
    const property = original ? ICAL.Property.fromString(original) : new ICAL.Property(name);
    const expectedType =
      name === 'completed' ? 'date-time' : name === 'percent-complete' ? 'integer' : 'text';
    if (property.type !== expectedType || (name === 'completed' && property.getParameter('tzid'))) {
      throw new Error(`Unsupported VTODO ${name} format`);
    }
    const typed =
      name === 'completed'
        ? ICAL.Time.fromDateTimeString(value)
        : name === 'percent-complete'
          ? Number(value)
          : value;
    property.setValue(typed);
    const folded = ICAL.helpers.foldline(property.toICALString()).replace(/\r?\n/g, eol);
    return `${folded}${eol}`;
  }
  for (const group of groups) {
    const line = group.replace(/\r?\n[ \t]/g, '').replace(/\r?\n$/, '');
    const marker = /^(BEGIN|END):([A-Z0-9-]+)$/i.exec(line);
    if (marker) {
      if (marker[1].toUpperCase() === 'BEGIN') stack.push(marker[2].toLowerCase());
      else {
        if (stack.join('/') === 'vcalendar/vtodo') {
          for (const [name, value] of properties) {
            if (value !== null) output.push(serialize(name, value));
          }
        }
        stack.pop();
      }
    } else if (stack.join('/') === 'vcalendar/vtodo') {
      const name = line.split(/[;:]/, 1)[0].toLowerCase();
      if (properties.has(name)) {
        const value = properties.get(name);
        properties.delete(name);
        if (value !== null && value !== undefined) output.push(serialize(name, value, line));
        continue;
      }
    }
    output.push(group);
  }
  return output.join('');
}

function hasControlCharacters(value: string, allowWhitespace: boolean): boolean {
  return [...value].some((character) => {
    if (allowWhitespace && '\t\r\n'.includes(character)) return false;
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
