import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuthColors } from '@/features/auth/use-auth-colors';
import {
  readTaskRecurrence,
  type DavTask,
  type SimpleTaskRecurrence,
  type TaskMetadataChange,
  type TaskTime,
} from '@/services/caldav';
import { TaskButton, TaskField } from './task-controls';

function timeChange(value: string, original: TaskTime | null): TaskTime | null | undefined {
  const text = value.trim();
  if (text === (original?.value ?? '')) return undefined;
  if (text === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { kind: 'date', value: text };
  if (text.endsWith('Z')) return { kind: 'utc', value: text };
  return original?.kind === 'zoned'
    ? { ...original, value: text }
    : { kind: 'floating', value: text };
}

const frequencies = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;

export function TaskEditor({
  task,
  writable,
  busy,
  onClose,
  onSave,
  onRepeat,
}: {
  task: DavTask;
  writable: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (change: TaskMetadataChange) => void;
  onRepeat: (rule: SimpleTaskRecurrence | null) => void;
}) {
  const colors = useAuthColors();
  const entry =
    task.resource.occurrences.find(({ recurrenceId }) => recurrenceId === null) ??
    task.resource.occurrences[0];
  const recurrence = readTaskRecurrence(task.resource.serialize());
  const editable = writable && (recurrence.kind === 'none' || recurrence.kind === 'unavailable');
  const [summary, setSummary] = useState(entry.summary ?? '');
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [priority, setPriority] = useState(entry.priority?.toString() ?? '');
  const [start, setStart] = useState(entry.start?.value ?? '');
  const [due, setDue] = useState(entry.due?.value ?? '');
  const [interval, setInterval] = useState(
    recurrence.kind === 'simple' ? String(recurrence.rule.interval) : '1',
  );
  const [frequency, setFrequency] = useState<SimpleTaskRecurrence['frequency'] | null>(
    recurrence.kind === 'simple' ? recurrence.rule.frequency : null,
  );
  const [showRepeat, setShowRepeat] = useState(false);
  const change: TaskMetadataChange = {};
  if (summary !== (entry.summary ?? '')) change.summary = summary.trim();
  if (notes !== (entry.notes ?? '')) change.notes = notes || null;
  if (priority !== (entry.priority?.toString() ?? ''))
    change.priority = priority.trim() === '' ? null : Number(priority);
  const newStart = timeChange(start, entry.start);
  const newDue = timeChange(due, entry.due);
  if (newStart !== undefined) change.start = newStart;
  if (newDue !== undefined) change.due = newDue;
  const dirty = Object.keys(change).length > 0;

  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 24 }}>
        {editable ? 'Edit task' : entry.summary || 'Untitled task'}
      </Text>
      {editable ? (
        <>
          <TaskField label="Title" value={summary} onChangeText={setSummary} />
          <TaskField label="Notes" value={notes} onChangeText={setNotes} multiline />
          <TaskField
            label="Priority (1 high–9 low, 0 none)"
            value={priority}
            onChangeText={setPriority}
          />
          <TaskField label="Start" value={start} onChangeText={setStart} />
          <TaskField label="Due" value={due} onChangeText={setDue} />
          <Text style={{ color: colors.muted }}>
            Use YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss. Add Z for UTC. Existing time zones are kept for
            local date-times.
          </Text>
          <TaskButton
            label="Save task"
            disabled={busy || !summary.trim() || !dirty}
            onPress={() => onSave(change)}
          />
        </>
      ) : (
        <>
          <Text style={{ color: colors.muted }}>
            {!writable
              ? 'Read-only task'
              : recurrence.kind === 'unsupported'
                ? 'Advanced recurrence · read-only'
                : 'Recurring task · only its repeat rule can be edited'}
          </Text>
          {!!entry.notes && <Text style={{ color: colors.text }}>{entry.notes}</Text>}
          {entry.start && <Text style={{ color: colors.text }}>Start: {entry.start.value}</Text>}
          {entry.due && <Text style={{ color: colors.text }}>Due: {entry.due.value}</Text>}
        </>
      )}
      {writable && !dirty && (recurrence.kind === 'simple' || recurrence.kind === 'none') && (
        <>
          <TaskButton
            label={showRepeat ? 'Hide repeat options' : 'Repeat options'}
            disabled={busy}
            onPress={() => setShowRepeat(!showRepeat)}
          />
          {showRepeat && (
            <>
              <Text style={{ color: colors.text }}>Repeat: {frequency ?? 'None'}</Text>
              {frequencies.map((value) => (
                <TaskButton
                  key={value}
                  label={value.toLowerCase()}
                  disabled={busy}
                  onPress={() => setFrequency(value)}
                />
              ))}
              <TaskButton
                label="Do not repeat"
                disabled={busy}
                onPress={() => setFrequency(null)}
              />
              {frequency && (
                <TaskField label="Repeat interval" value={interval} onChangeText={setInterval} />
              )}
              <TaskButton
                label="Save repeat rule"
                disabled={busy}
                onPress={() =>
                  onRepeat(frequency ? { frequency, interval: Number(interval) } : null)
                }
              />
            </>
          )}
        </>
      )}
      <TaskButton label="Close task" disabled={busy} onPress={onClose} />
    </View>
  );
}
