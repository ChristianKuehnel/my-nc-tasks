import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { TaskNavigationProvider } from '@/features/tasks/task-navigation';

// Keep the native splash screen visible until the first render, so users
// never see a flash of unstyled content.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <TaskNavigationProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </TaskNavigationProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
