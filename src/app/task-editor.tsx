import { Redirect, router, useNavigation } from 'expo-router';
import { useAuth } from '@/features/auth/use-auth';
import { useTaskNavigation } from '@/features/tasks/task-navigation';
import { TasksScreen } from '@/features/tasks/tasks-screen';

export default function TaskEditorRoute() {
  const auth = useAuth();
  const route = useNavigation();
  const navigation = useTaskNavigation(auth.session);
  if (auth.status === 'restoring') return null;
  if (!auth.session) return <Redirect href="/" />;
  if (!navigation?.calendar || !navigation.task) return <Redirect href="/lists" />;

  return (
    <TasksScreen
      session={auth.session}
      calendar={navigation.calendar}
      task={navigation.task}
      onBack={() => {
        if (route.isFocused()) router.back();
      }}
      onEditorRefresh={navigation.invalidateTasks}
    />
  );
}
