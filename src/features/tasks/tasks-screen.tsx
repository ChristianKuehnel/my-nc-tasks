import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthColors } from '@/features/auth/use-auth-colors';
import {
  createTask,
  deleteTask,
  listTasks,
  readTaskRecurrence,
  updateTask,
  updateTaskRecurrence,
  type CalDAVCalendar,
  type DavTask,
  type FetchLike,
} from '@/services/caldav';
import type { AuthSession } from '@/services/nextcloud/types';
import { TaskButton, TaskField } from './task-controls';
import { TaskEditor } from './task-editor';

function TaskRow({
  name,
  due,
  busy,
  completed,
  onOpen,
  onToggle,
  onDelete,
}: {
  name: string;
  due?: string;
  busy: boolean;
  completed: boolean;
  onOpen: () => void;
  onToggle?: () => void;
  onDelete?: () => void;
}) {
  const colors = useAuthColors();
  const [expanded, setExpanded] = useState(false);
  const canDelete = !!onDelete;
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, { dx, dy }) =>
      canDelete && !busy && Math.abs(dx) > 24 && Math.abs(dx) > 2 * Math.abs(dy),
    onPanResponderRelease: (_, { dx }) => {
      if (dx < -44) setExpanded(true);
      if (dx > 44) setExpanded(false);
    },
  });
  return (
    <View {...swipe.panHandlers} style={[rowStyles.container, { borderTopColor: colors.border }]}>
      <View style={rowStyles.row}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={onToggle ? `${completed ? 'Reopen' : 'Complete'} ${name}` : name}
          accessibilityState={{ checked: completed, disabled: busy || !onToggle }}
          disabled={busy || !onToggle}
          onPress={onToggle}
          style={rowStyles.iconTarget}
        >
          <View
            accessible={false}
            style={[
              rowStyles.circle,
              {
                borderColor: completed ? colors.action : colors.border,
                backgroundColor: completed ? colors.action : undefined,
              },
            ]}
          >
            {completed && <Text style={{ color: colors.actionText, fontWeight: '700' }}>✓</Text>}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${name}`}
          accessibilityHint={due ? `Due ${due}` : undefined}
          disabled={busy}
          onPress={onOpen}
          style={rowStyles.titleTarget}
        >
          <Text
            style={{
              color: completed ? colors.muted : colors.text,
              fontSize: 17,
              textDecorationLine: completed ? 'line-through' : 'none',
            }}
          >
            {name}
          </Text>
          {due && <Text style={{ color: colors.muted, fontSize: 13 }}>Due {due}</Text>}
        </Pressable>
        {canDelete && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? 'Hide actions for' : 'Actions for'} ${name}`}
            accessibilityState={{ expanded }}
            disabled={busy}
            onPress={() => setExpanded(!expanded)}
            style={rowStyles.iconTarget}
          >
            <Text style={{ color: colors.text, fontSize: 22 }}>⋯</Text>
          </Pressable>
        )}
      </View>
      {canDelete && expanded && (
        <View style={rowStyles.actions}>
          <TaskButton label={`Delete ${name}`} disabled={busy} onPress={onDelete} />
        </View>
      )}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  container: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconTarget: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleTarget: { flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 6 },
  actions: { alignItems: 'flex-end', paddingBottom: 8 },
});

const headerStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 28, fontWeight: '700' },
  refresh: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

const sectionStyles = StyleSheet.create({
  separator: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});

export function TasksScreen({
  session,
  calendar,
  onBack,
  options,
  task: selected,
  onOpenTask,
  onEditorRefresh,
}: {
  session: AuthSession;
  calendar: CalDAVCalendar;
  onBack: () => void;
  options?: { fetchImpl?: FetchLike; timeoutMs?: number };
  task?: DavTask;
  onOpenTask?: (task: DavTask) => void;
  onEditorRefresh?: () => void;
}) {
  const colors = useAuthColors();
  const [tasks, setTasks] = useState<DavTask[] | null>(null);
  const [completedExpanded, setCompletedExpanded] = useState(true);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(!selected);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(!selected);
  const pending = useRef(false);
  const load = useCallback(
    () => listTasks(session, calendar, options),
    [session, calendar, options],
  );
  const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');

  useEffect(() => {
    if (selected) return;
    let active = true;
    load()
      .then((items) => {
        if (active) {
          setTasks(items);
          setStale(false);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(message(err));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [load, selected]);

  const back = () => {
    if (pending.current) return;
    onBack();
  };

  async function run(write?: () => Promise<unknown>, afterWrite?: () => void) {
    if (pending.current || busy || (write && (stale || !calendar.canWrite))) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let saved = false;
    try {
      if (write) {
        await write();
        saved = true;
        afterWrite?.();
      }
      if (selected) {
        onEditorRefresh?.();
        onBack();
      } else {
        setTasks(await load());
        setStale(false);
      }
    } catch (err) {
      setStale(true);
      setError(saved ? `Change saved, but refresh failed: ${message(err)}` : message(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const canWrite = calendar.canWrite && !stale;
  const add = () => {
    const summary = title.trim();
    if (summary)
      void run(
        () => createTask(session, calendar, randomUUID(), summary, new Date(), options),
        () => setTitle(''),
      );
  };
  const disabled = busy || !canWrite;
  const openRows: ReactElement[] = [];
  const completedRows: ReactElement[] = [];
  for (const item of tasks ?? []) {
    const entry =
      item.resource.occurrences.find(({ recurrenceId }) => recurrenceId === null) ??
      item.resource.occurrences[0];
    const name = entry.summary || 'Untitled task';
    const recurrence = readTaskRecurrence(item.resource.serialize());
    const basic =
      canWrite &&
      !!item.etag &&
      !item.etag.startsWith('W/') &&
      (recurrence.kind === 'none' || recurrence.kind === 'unavailable');
    const rows = entry.completed ? completedRows : openRows;
    rows.push(
      <TaskRow
        key={item.url}
        name={name}
        busy={busy}
        completed={entry.completed}
        onOpen={() => onOpenTask?.(item)}
        due={entry.due?.value}
        onToggle={
          basic
            ? () =>
                void run(() =>
                  updateTask(
                    session,
                    calendar,
                    item,
                    { completed: !entry.completed, at: new Date() },
                    options,
                  ),
                )
            : undefined
        }
        onDelete={
          basic
            ? () =>
                Alert.alert('Delete task?', `Remove “${name}” from this list?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => void run(() => deleteTask(session, calendar, item, options)),
                  },
                ])
            : undefined
        }
      />,
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          <TaskButton
            label={selected ? 'Back to tasks' : 'Back to lists'}
            disabled={busy}
            onPress={back}
          />
          <View style={headerStyles.row}>
            <Text accessibilityRole="header" style={[headerStyles.title, { color: colors.text }]}>
              {calendar.displayName}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh tasks"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void run()}
              style={headerStyles.refresh}
            >
              <Text style={{ color: busy ? colors.muted : colors.action, fontSize: 24 }}>↻</Text>
            </Pressable>
          </View>
          {!calendar.canWrite && <Text style={{ color: colors.muted }}>Read-only list</Text>}
          {error && (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {error}
            </Text>
          )}
          {busy && (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>
              Working…
            </Text>
          )}
          {selected ? (
            <TaskEditor
              key={selected.url}
              task={selected}
              writable={canWrite && !!selected.etag && !selected.etag.startsWith('W/')}
              busy={busy}
              onClose={back}
              onSave={(change) =>
                void run(() => updateTask(session, calendar, selected, change, options))
              }
              onRepeat={(rule) =>
                void run(() => updateTaskRecurrence(session, calendar, selected, rule, options))
              }
            />
          ) : (
            <>
              {calendar.canWrite && (
                <>
                  <TaskField label="New task title" value={title} onChangeText={setTitle} />
                  <TaskButton label="Add task" disabled={disabled || !title.trim()} onPress={add} />
                </>
              )}
              {tasks?.length === 0 && <Text style={{ color: colors.muted }}>No tasks yet.</Text>}
              <View>{openRows}</View>
              {completedRows.length > 0 && (
                <>
                  {openRows.length === 0 && (
                    <Text style={{ color: colors.muted }}>No open tasks.</Text>
                  )}
                  <View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Completed tasks (${completedRows.length})`}
                      accessibilityState={{ expanded: completedExpanded }}
                      onPress={() => setCompletedExpanded((expanded) => !expanded)}
                      style={[
                        sectionStyles.separator,
                        { backgroundColor: colors.surface, borderTopColor: colors.border },
                      ]}
                    >
                      <Text style={{ color: colors.text, fontWeight: '600' }}>
                        Completed ({completedRows.length})
                      </Text>
                      <Text style={{ color: colors.muted }}>{completedExpanded ? '▾' : '▸'}</Text>
                    </Pressable>
                    {completedExpanded && completedRows}
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
