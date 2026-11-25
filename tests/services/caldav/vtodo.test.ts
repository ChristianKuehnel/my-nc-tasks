import { createVTodoResource, parseVTodoResource } from '@/services/caldav/vtodo';

const calendar = (...lines: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Example//Tasks//EN',
    ...lines,
    'END:VCALENDAR',
    '',
  ].join('\r\n');

const recurringTask = calendar(
  'X-CALENDAR-SETTING:example',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VTODO',
  'UID:reading@example.test',
  'DTSTAMP:20261020T080000Z',
  'DTSTART;TZID=Europe/Berlin:20261023T090000',
  'DUE;TZID=Europe/Berlin:20261023T100000',
  'RRULE:FREQ=DAILY;COUNT=5',
  'EXDATE;TZID=Europe/Berlin:20261024T090000',
  'SUMMARY:Check\\, notes\\; then',
  ' review',
  'RELATED-TO;RELTYPE=PARENT:parent@example.test',
  'X-CLIENT-FLAG;X-PARAM="opaque,value":keep me',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'END:VTODO',
  'BEGIN:VTODO',
  'UID:reading@example.test',
  'DTSTAMP:20261020T080000Z',
  'RECURRENCE-ID;TZID=Europe/Berlin:20261025T090000',
  'DTSTART:20261025T110000',
  'DUE:20261025T130000Z',
  'END:VTODO',
);

describe('VTODO resources', () => {
  it('reads a recurrence exception and preserves the entire original resource', () => {
    const parsed = parseVTodoResource(recurringTask);
    expect(parsed.occurrences).toEqual([
      {
        uid: 'reading@example.test',
        summary: 'Check, notes; thenreview',
        start: { kind: 'zoned', value: '2026-10-23T09:00:00', tzid: 'Europe/Berlin' },
        due: { kind: 'zoned', value: '2026-10-23T10:00:00', tzid: 'Europe/Berlin' },
        recurrenceId: null,
      },
      {
        uid: 'reading@example.test',
        summary: null,
        start: { kind: 'floating', value: '2026-10-25T11:00:00' },
        due: { kind: 'utc', value: '2026-10-25T13:00:00Z' },
        recurrenceId: { kind: 'zoned', value: '2026-10-25T09:00:00', tzid: 'Europe/Berlin' },
      },
    ]);
    expect(parsed.serialize()).toBe(recurringTask);
  });

  it('keeps all-day dates as dates and does not rewrite LF input', () => {
    const source = calendar(
      'BEGIN:VTODO',
      'UID:all-day',
      'DUE;VALUE=DATE:20261125',
      'END:VTODO',
    ).replaceAll('\r\n', '\n');
    const parsed = parseVTodoResource(source);
    expect(parsed.occurrences[0].due).toEqual({ kind: 'date', value: '2026-11-25' });
    expect(parsed.serialize()).toBe(source);
  });

  it.each([
    'not a calendar',
    calendar('BEGIN:VTODO', 'UID:first', 'END:VEVENT'),
    calendar('BEGIN:VTODO', 'UID:first'),
    calendar(),
    calendar('BEGIN:VTODO', 'SUMMARY:missing UID', 'END:VTODO'),
    calendar('BEGIN:VTODO', 'UID:first', 'UID:duplicate', 'END:VTODO'),
    calendar('BEGIN:VTODO', 'UID:first', 'END:VTODO', 'BEGIN:VTODO', 'UID:second', 'END:VTODO'),
    calendar('BEGIN:VTODO', 'UID:first', 'END:VTODO', 'BEGIN:VEVENT', 'UID:first', 'END:VEVENT'),
  ])('rejects a non-task or ambiguous resource (%#)', (source) => {
    expect(() => parseVTodoResource(source)).toThrow();
  });

  it('creates a task with CRLF, UTC timestamp, and escaped user text', () => {
    const summary = 'Prüfen, lesen; \\ notieren\r\nEND:VTODO';
    const created = createVTodoResource(
      'new@example.test',
      summary,
      new Date('2026-11-25T10:30:00.123Z'),
    );
    expect(created.serialize()).toContain('DTSTAMP:20261125T103000Z\r\n');
    expect(created.serialize()).toContain(
      'SUMMARY:Prüfen\\, lesen\\; \\\\ notieren\\nEND:VTODO\r\n',
    );
    expect(parseVTodoResource(created.serialize()).occurrences).toMatchObject([
      { uid: 'new@example.test', summary: summary.replace('\r\n', '\n') },
    ]);
  });

  it('rejects invalid creation fields', () => {
    const date = new Date('2026-11-25T10:30:00Z');
    expect(() => createVTodoResource(' ', 'title', date)).toThrow('UID');
    expect(() => createVTodoResource('uid\nbad', 'title', date)).toThrow('UID');
    expect(() => createVTodoResource('uid', 'bad\u0000', date)).toThrow('summary');
    expect(() => createVTodoResource('uid', 'title', new Date(NaN))).toThrow('date');
  });
});
