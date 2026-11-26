import ICAL from 'ical.js';

export type TaskTime =
  | { kind: 'date' | 'floating' | 'utc'; value: string }
  | { kind: 'zoned'; value: string; tzid: string };

export interface TaskOccurrence {
  readonly uid: string;
  readonly summary: string | null;
  readonly notes: string | null;
  readonly priority: number | null;
  readonly start: TaskTime | null;
  readonly due: TaskTime | null;
  readonly recurrenceId: TaskTime | null;
  readonly completed: boolean;
  /** UTC timestamp, if supplied by the server. */
  readonly completedAt: string | null;
  readonly relationships: readonly TaskRelationship[];
}

export interface TaskRelationship {
  readonly type: string;
  readonly uid: string;
}

function relationshipType(property: ICAL.Property): string {
  const type = property.getParameter('reltype');
  return type == null ? 'PARENT' : typeof type === 'string' ? type.toUpperCase() : '';
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
    const notes: unknown = todo.getFirstPropertyValue('description');
    const priority: unknown = todo.getFirstPropertyValue('priority');
    const completedAt = todo.hasProperty('completed') ? taskTime(todo, 'completed') : null;
    return {
      uid,
      summary: typeof summary === 'string' ? summary : null,
      notes: typeof notes === 'string' ? notes : null,
      priority:
        typeof priority === 'number' && Number.isInteger(priority) && priority >= 0 && priority <= 9
          ? priority
          : null,
      start: taskTime(todo, 'dtstart'),
      due: taskTime(todo, 'due'),
      recurrenceId: taskTime(todo, 'recurrence-id'),
      completed:
        todo.getFirstPropertyValue('status') === 'COMPLETED' || todo.hasProperty('completed'),
      completedAt: completedAt?.kind === 'utc' ? completedAt.value : null,
      relationships: todo.getAllProperties('related-to').map((property) => {
        const value: unknown = property.getFirstValue();
        return { type: relationshipType(property), uid: typeof value === 'string' ? value : '' };
      }),
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

export interface TaskMetadataChange {
  summary?: string;
  notes?: string | null;
  priority?: number | null;
  start?: TaskTime | null;
  due?: TaskTime | null;
}

export type BasicTaskChange = TaskMetadataChange &
  ({ completed?: never } | { completed: boolean; at: Date });

function validateTime(time: TaskTime): void {
  const pattern =
    time.kind === 'date'
      ? /^\d{4}-\d{2}-\d{2}$/
      : time.kind === 'utc'
        ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  // Validate the wall-clock fields in UTC, without resolving a zone or changing
  // the value. The ISO round-trip catches dates Date would silently normalize.
  const wall =
    time.kind === 'date'
      ? `${time.value}T00:00:00Z`
      : time.kind === 'utc'
        ? time.value
        : `${time.value}Z`;
  const date = new Date(wall);
  if (
    !pattern.test(time.value) ||
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.toISOString().replace('.000Z', 'Z') !== wall
  ) {
    throw new Error('Invalid VTODO date or time');
  }
}

function validateSchedule(
  calendar: ICAL.Component,
  todo: ICAL.Component,
  change: TaskMetadataChange,
): void {
  if (change.start === undefined && change.due === undefined) return;
  const oldStart = taskTime(todo, 'dtstart');
  const oldDue = taskTime(todo, 'due');
  const start = change.start === undefined ? oldStart : change.start;
  const due = change.due === undefined ? oldDue : change.due;
  if (todo.hasProperty('duration') && (!start || due)) {
    throw new Error('VTODO with a duration requires a start and cannot have an explicit due date');
  }
  for (const time of [change.start, change.due]) {
    if (!time) continue;
    validateTime(time);
    if (time.kind === 'zoned' && (!time.tzid.trim() || hasControlCharacters(time.tzid, false))) {
      throw new Error('Invalid VTODO time zone');
    }
    if (
      time.kind === 'zoned' &&
      ![oldStart, oldDue].some(
        (previous) => previous?.kind === 'zoned' && previous.tzid === time.tzid,
      ) &&
      !calendar
        .getAllSubcomponents('vtimezone')
        .some((zone) => zone.getFirstPropertyValue('tzid') === time.tzid)
    ) {
      throw new Error('Cannot introduce a time zone without a VTIMEZONE definition');
    }
  }
  if (!start || !due) return;
  validateTime(start);
  validateTime(due);
  if (
    start.kind !== due.kind ||
    (start.kind === 'zoned' && due.kind === 'zoned' && start.tzid !== due.tzid)
  ) {
    throw new Error('Start and due must use the same date or time kind and zone');
  }
  if (due.value <= start.value) throw new Error('Due must be after start');
}

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
  return editTaskProperties(source, change);
}

export function editTaskParent(source: string, parentUid: string | null): string {
  if (parentUid !== null && (!parentUid.trim() || hasControlCharacters(parentUid, false))) {
    throw new Error('Invalid VTODO parent UID');
  }
  return editTaskProperties(source, {}, parentUid);
}

function editTaskProperties(
  source: string,
  change: BasicTaskChange,
  parentUid?: string | null,
): string {
  assertSingleTask(source);
  const properties = new Map<string, string | TaskTime | null>();
  for (const [name, value] of [
    ['summary', change.summary],
    ['description', change.notes],
  ] as const) {
    if (value === undefined) continue;
    if (value !== null && hasControlCharacters(value, true))
      throw new Error(`Invalid VTODO ${name}`);
    properties.set(name, value?.replace(/\r\n?/g, '\n') ?? null);
  }
  if (change.priority !== undefined) {
    if (
      change.priority !== null &&
      (!Number.isInteger(change.priority) || change.priority < 0 || change.priority > 9)
    ) {
      throw new Error('Priority must be an integer from 0 to 9');
    }
    properties.set('priority', change.priority === null ? null : String(change.priority));
  }
  if (change.start !== undefined) properties.set('dtstart', change.start);
  if (change.due !== undefined) properties.set('due', change.due);
  if (change.completed !== undefined) {
    properties.set('status', change.completed ? 'COMPLETED' : 'NEEDS-ACTION');
    properties.set('percent-complete', change.completed ? '100' : '0');
    properties.set('completed', change.completed ? utcStamp(change.at) : null);
  }
  const calendar = new ICAL.Component(ICAL.parse(source));
  const todo = calendar.getFirstSubcomponent('vtodo');
  if (!todo) throw new Error('VCALENDAR does not contain a VTODO');
  if (parentUid !== undefined) {
    const parents = todo
      .getAllProperties('related-to')
      .filter((property) => relationshipType(property) === 'PARENT');
    if (parents.length > 1) throw new Error('Ambiguous VTODO parent');
    properties.set('related-to', parentUid);
  }
  if (change.start !== undefined || change.due !== undefined) {
    if (['dtstart', 'due', 'duration'].some((name) => todo.getAllProperties(name).length > 1)) {
      throw new Error('Ambiguous VTODO schedule');
    }
    validateSchedule(calendar, todo, change);
  }
  for (const name of properties.keys()) {
    if (name !== 'related-to' && todo.getAllProperties(name).length > 1)
      throw new Error(`Ambiguous VTODO ${name}`);
  }
  return replaceTaskProperties(source, properties);
}

function replaceTaskProperties(
  source: string,
  properties: Map<string, string | TaskTime | null>,
): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
  const groups: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && groups.length) groups[groups.length - 1] += line;
    else groups.push(line);
  }
  const stack: string[] = [];
  const output: string[] = [];
  function serialize(name: string, value: string | TaskTime, original?: string): string {
    if (name === 'rrule') return `RRULE:${value}${eol}`;
    const property = original ? ICAL.Property.fromString(original) : new ICAL.Property(name);
    if (name === 'related-to' && !original) property.setParameter('reltype', 'PARENT');
    if (typeof value !== 'string') {
      property.removeParameter('tzid');
      property.resetType(value.kind === 'date' ? 'date' : 'date-time');
      property.setValue(
        value.kind === 'date'
          ? ICAL.Time.fromDateString(value.value)
          : ICAL.Time.fromDateTimeString(value.value),
      );
      if (value.kind === 'zoned') property.setParameter('tzid', value.tzid);
      return `${ICAL.helpers.foldline(property.toICALString()).replace(/\r?\n/g, eol)}${eol}`;
    }
    const integer = name === 'percent-complete' || name === 'priority';
    const expectedType = name === 'completed' ? 'date-time' : integer ? 'integer' : 'text';
    if (property.type !== expectedType || (name === 'completed' && property.getParameter('tzid'))) {
      throw new Error(`Unsupported VTODO ${name} format`);
    }
    const typed =
      name === 'completed' ? ICAL.Time.fromDateTimeString(value) : integer ? Number(value) : value;
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
      if (
        properties.has(name) &&
        (name !== 'related-to' || relationshipType(ICAL.Property.fromString(line)) === 'PARENT')
      ) {
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

const frequencies = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export interface SimpleTaskRecurrence {
  frequency: (typeof frequencies)[number];
  interval: number;
}

export type TaskRecurrence =
  { kind: 'unavailable' | 'unsupported' | 'none' } | { kind: 'simple'; rule: SimpleTaskRecurrence };

function validRule(rule: SimpleTaskRecurrence): boolean {
  return (
    frequencies.includes(rule.frequency) &&
    Number.isInteger(rule.interval) &&
    rule.interval >= 1 &&
    rule.interval <= 999
  );
}

/** Read capability without expanding the series or rewriting its source. */
export function readTaskRecurrence(source: string): TaskRecurrence {
  const resource = parseVTodoResource(source);
  const calendar = new ICAL.Component(ICAL.parse(source));
  const todo = calendar.getFirstSubcomponent('vtodo');
  if (
    !todo ||
    resource.occurrences.length !== 1 ||
    ['recurrence-id', 'rdate', 'exdate', 'exrule'].some((name) => todo.hasProperty(name))
  ) {
    return { kind: 'unsupported' };
  }
  const rules = todo.getAllProperties('rrule');
  const start = resource.occurrences[0].start;
  if (!start || todo.getAllProperties('dtstart').length !== 1) {
    return { kind: rules.length ? 'unsupported' : 'unavailable' };
  }
  try {
    validateTime(start);
  } catch {
    return { kind: rules.length ? 'unsupported' : 'unavailable' };
  }
  if (!rules.length) return { kind: 'none' };
  // Inspect the source, not a normalized RRULE: a parser could discard fields
  // it does not understand. Only an unparameterized FREQ/INTERVAL is editable.
  const raw = source
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .filter((line) => /^RRULE[:;]/i.test(line));
  if (rules.length !== 1 || raw.length !== 1) return { kind: 'unsupported' };
  const match = /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=([0-9]{1,3}))?$/i.exec(
    raw[0],
  );
  if (!match) return { kind: 'unsupported' };
  const rule = {
    frequency: match[1].toUpperCase() as SimpleTaskRecurrence['frequency'],
    interval: Number(match[2] ?? 1),
  };
  return validRule(rule) ? { kind: 'simple', rule } : { kind: 'unsupported' };
}

export function editTaskRecurrence(source: string, rule: SimpleTaskRecurrence | null): string {
  const { kind } = readTaskRecurrence(source);
  if (kind === 'unavailable' || kind === 'unsupported') {
    throw new Error(
      'Recurrence editing requires a valid start and a task without advanced recurrence or exceptions.',
    );
  }
  if (rule !== null && !validRule(rule)) throw new Error('Invalid task recurrence rule.');
  return replaceTaskProperties(
    source,
    new Map([['rrule', rule === null ? null : `FREQ=${rule.frequency};INTERVAL=${rule.interval}`]]),
  );
}

function hasControlCharacters(value: string, allowWhitespace: boolean): boolean {
  return [...value].some((character) => {
    if (allowWhitespace && '\t\r\n'.includes(character)) return false;
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
