import type { CalDAVCalendar, DavTask, TaskTime } from '@/services/caldav';

export const smartViews = ['Today', 'Scheduled', 'All', 'Important'] as const;
export type SmartView = (typeof smartViews)[number];
export type SmartSort = 'Date' | 'Title' | 'Priority';
export type ListedTask = { task: DavTask; calendar: CalDAVCalendar };

export function taskEntry({ resource }: DavTask) {
  return (
    resource.occurrences.find(({ recurrenceId }) => recurrenceId === null) ??
    resource.occurrences[0]
  );
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function day(time: TaskTime | null): string | null {
  if (!time) return null;
  // All-day, floating and TZID dates retain their calendar day; we don't
  // resolve embedded VTIMEZONE definitions here. UTC uses the device day.
  if (time.kind !== 'utc') return time.value.slice(0, 10);
  const date = new Date(time.value);
  return Number.isFinite(date.getTime()) ? localDay(date) : null;
}

export function selectSmartTasks(
  tasks: readonly ListedTask[],
  view: SmartView,
  sort: SmartSort,
  now: Date,
): ListedTask[] {
  const today = localDay(now);
  return tasks
    .map((item) => {
      const entry = taskEntry(item.task);
      const due = day(entry.due);
      const start = day(entry.start);
      return {
        item,
        entry,
        due,
        start,
        date: due ?? start ?? '\uffff',
        priority: entry.priority || Infinity,
        title: entry.summary ?? 'Untitled task',
      };
    })
    .filter(
      ({ entry, due, start, priority }) =>
        view === 'All' ||
        (!entry.completed &&
          (view === 'Today'
            ? (due !== null && due <= today) || start === today
            : view === 'Scheduled'
              ? due !== null || start !== null
              : priority <= 4)),
    )
    .sort(
      (a, b) =>
        Number(a.entry.completed) - Number(b.entry.completed) ||
        (sort === 'Date'
          ? a.date.localeCompare(b.date)
          : sort === 'Priority'
            ? a.priority === b.priority
              ? 0
              : a.priority - b.priority
            : a.title.localeCompare(b.title)) ||
        a.title.localeCompare(b.title) ||
        a.item.task.url.localeCompare(b.item.task.url),
    )
    .map(({ item }) => item);
}
