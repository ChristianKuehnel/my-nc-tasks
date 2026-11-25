import { useColorScheme } from 'react-native';

const light = {
  background: '#ffffff',
  surface: '#f8fafc',
  text: '#111827',
  muted: '#475569',
  border: '#64748b',
  error: '#b91c1c',
  action: '#2563eb',
  actionText: '#ffffff',
  disabledAction: '#e2e8f0',
  disabledActionText: '#475569',
};

const dark: typeof light = {
  background: '#0f172a',
  surface: '#1e293b',
  text: '#f8fafc',
  muted: '#cbd5e1',
  border: '#94a3b8',
  error: '#fca5a5',
  action: '#93c5fd',
  actionText: '#0f172a',
  disabledAction: '#334155',
  disabledActionText: '#cbd5e1',
};

export function useAuthColors() {
  return useColorScheme() === 'dark' ? dark : light;
}
