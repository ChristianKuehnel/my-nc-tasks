import { randomUUID } from 'expo-crypto';
import { usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
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

export function TasksScreen({
  session,
  calendar,
  onBack,
  options,
}: {
  session: AuthSession;
  calendar: CalDAVCalendar;
  onBack: () => void;
  options?: { fetchImpl?: FetchLike; timeoutMs?: number };
}) {
  const colors = useAuthColors();
  const [tasks, setTasks] = useState<DavTask[] | null>(null);
  const [selected, setSelected] = useState<DavTask | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(true);
  const pending = useRef(false);
  const load = useCallback(
    () => listTasks(session, calendar, options),
    [session, calendar, options],
  );
  const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');

  useEffect(() => {
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
  }, [load]);

  const back = () => {
    if (pending.current) return;
    if (selected) setSelected(null);
    else onBack();
  };
  // Both task views live inside /lists. Handle a native edge swipe as one
  // step in that local flow, rather than letting it dismiss the whole route.
  usePreventRemove(true, back);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => subscription.remove();
  });

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
      const next = await load();
      setTasks(next);
      setSelected(null);
      setStale(false);
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
          <Text
            accessibilityRole="header"
            style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}
          >
            {calendar.displayName}
          </Text>
          {!calendar.canWrite && <Text style={{ color: colors.muted }}>Read-only list</Text>}
          {error && (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {error}
            </Text>
          )}
          <TaskButton label="Refresh tasks" disabled={busy} onPress={() => void run()} />
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
              {tasks?.map((item) => {
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
                return (
                  <TaskRow
                    key={item.url}
                    name={name}
                    busy={busy}
                    completed={entry.completed}
                    onOpen={() => setSelected(item)}
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
                                onPress: () =>
                                  void run(() => deleteTask(session, calendar, item, options)),
                              },
                            ])
                        : undefined
                    }
                  />
                );
              })}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
