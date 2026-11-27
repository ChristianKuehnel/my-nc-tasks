import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/features/auth/use-auth';
import { useTaskNavigation } from '@/features/tasks/task-navigation';
import { SmartTasksScreen } from '@/features/tasks/smart-tasks-screen';
import { smartViews } from '@/features/tasks/smart-views';

export default function SmartTasksRoute() {
  const { view: requested } = useLocalSearchParams();
  const auth = useAuth();
  const session = auth.session;
  const navigation = useTaskNavigation(session);
  const view = smartViews.find((name) => name === requested);
  if (auth.status === 'restoring') return null;
  if (!session) return <Redirect href="/" />;
  if (!navigation || !view) return <Redirect href="/lists" />;

  return (
    <SmartTasksScreen
      key={`${view}:${navigation.revision}`}
      session={session}
      view={view}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/lists'))}
      onOpen={({ calendar, task }) => {
        navigation.selectCalendar(calendar, session);
        navigation.selectTask(task);
        router.push('/task-editor');
      }}
    />
  );
}
