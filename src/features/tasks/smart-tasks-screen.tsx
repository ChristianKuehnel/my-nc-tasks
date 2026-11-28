import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthColors } from '@/features/auth/use-auth-colors';
import { discoverCalendars, listTasks } from '@/services/caldav';
import type { AuthSession } from '@/services/nextcloud/types';
import { TaskButton } from './task-controls';
import {
  selectSmartTasks,
  taskEntry,
  type ListedTask,
  type SmartSort,
  type SmartView,
} from './smart-views';

export function SmartTasksScreen({
  session,
  view,
  onBack,
  onOpen,
}: {
  session: AuthSession;
  view: SmartView;
  onBack: () => void;
  onOpen: (item: ListedTask) => void;
}) {
  const colors = useAuthColors();
  const [sort, setSort] = useState<SmartSort>('Date');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; tasks: ListedTask[]; failed: number }>();
  const [error, setError] = useState<{ attempt: number }>();
  const busy = result?.attempt !== attempt && error?.attempt !== attempt;

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { calendars } = await discoverCalendars(session);
        const readable = calendars.filter(({ isTaskList, canRead }) => isTaskList && canRead);
        const tasks: ListedTask[] = [];
        let failed = 0;
        for (let i = 0; active && i < readable.length; i += 3) {
          const batch = await Promise.allSettled(
            readable
              .slice(i, i + 3)
              .map(async (calendar) =>
                (await listTasks(session, calendar)).map((task) => ({ task, calendar })),
              ),
          );
          for (const group of batch) {
            if (group.status === 'fulfilled') tasks.push(...group.value);
            else failed++;
          }
        }
        if (active) setResult({ attempt, tasks, failed });
      } catch {
        if (active) setError({ attempt });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [session, attempt]);

  const rows = selectSmartTasks(result?.tasks ?? [], view, sort, new Date());
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        contentContainerStyle={{ padding: 20, gap: 10 }}
        data={rows}
        keyExtractor={({ task }) => task.url}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            <TaskButton label="Back to lists" onPress={onBack} />
            <Text
              accessibilityRole="header"
              style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}
            >
              {view}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['Date', 'Title', 'Priority'] as const).map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityLabel={`Sort by ${option}`}
                  accessibilityState={{ selected: sort === option }}
                  onPress={() => setSort(option)}
                  style={{
                    minHeight: 44,
                    justifyContent: 'center',
                    paddingHorizontal: 10,
                    borderRadius: 8,
                    backgroundColor: sort === option ? colors.action : colors.surface,
                  }}
                >
                  <Text style={{ color: sort === option ? colors.actionText : colors.text }}>
                    {option}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TaskButton
              label="Refresh tasks"
              disabled={busy}
              onPress={() => setAttempt((value) => value + 1)}
            />
            {busy && (
              <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>
                Loading tasks…
              </Text>
            )}
            {error?.attempt === attempt && (
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                Could not load task lists.
              </Text>
            )}
            {result?.attempt === attempt && result.failed > 0 && (
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                Some lists could not be loaded ({result.failed}).
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          !busy && error?.attempt !== attempt && !result?.failed ? (
            <Text style={{ color: colors.muted }}>No matching tasks.</Text>
          ) : undefined
        }
        renderItem={({ item }) => {
          const entry = taskEntry(item.task);
          const title = entry.summary || 'Untitled task';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${title} from ${item.calendar.displayName}${entry.completed ? ', completed' : ''}`}
              onPress={() => onOpen(item)}
              style={{
                minHeight: 44,
                padding: 10,
                borderRadius: 8,
                backgroundColor: colors.surface,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  textDecorationLine: entry.completed ? 'line-through' : 'none',
                }}
              >
                {entry.completed ? '✓ ' : ''}
                {title}
              </Text>
              <Text style={{ color: colors.muted }}>
                {item.calendar.displayName}
                {entry.due
                  ? ` · Due ${entry.due.value}`
                  : entry.start
                    ? ` · Starts ${entry.start.value}`
                    : ''}
              </Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
