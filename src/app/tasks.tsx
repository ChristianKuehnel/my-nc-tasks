import { Redirect, router } from 'expo-router';
import { useAuth } from '@/features/auth/use-auth';
import { useTaskNavigation } from '@/features/tasks/task-navigation';
import { TasksScreen } from '@/features/tasks/tasks-screen';

export default function TasksRoute() {
  const auth = useAuth();
  const navigation = useTaskNavigation(auth.session);
  if (auth.status === 'restoring') return null;
  if (!auth.session) return <Redirect href="/" />;
  if (!navigation?.calendar) return <Redirect href="/lists" />;

  return (
    <TasksScreen
      key={navigation.revision}
      session={auth.session}
      calendar={navigation.calendar}
      onBack={router.back}
      onOpenTask={(task) => {
        navigation.selectTask(task);
        router.push('/task-editor');
      }}
    />
  );
}
