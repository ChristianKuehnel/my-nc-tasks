import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CreateCalendarDeps } from '@/services/caldav/collections';
import type { AuthSession } from '@/services/nextcloud/types';
import { useLists } from './use-lists';

interface ListsScreenProps {
  session: AuthSession;
  /** Optional dependency overrides (used by tests). */
  options?: CreateCalendarDeps;
}

function toCredentials(session: AuthSession) {
  return {
    serverUrl: session.serverUrl,
    loginName: session.loginName,
    appPassword: session.appPassword,
  };
}

/**
 * Task list overview (Phase 1.3): owned and shared VTODO calendars with
 * empty/loading/error states and a name-input flow for creating new lists
 * (MKCALENDAR). Shared lists are clearly marked; read-only shared lists
 * offer no mutations from this screen.
 */
export function ListsScreen({ session, options }: ListsScreenProps) {
  const lists = useLists(toCredentials(session), options);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');

  const closeCreate = () => {
    setIsCreating(false);
    setName('');
  };

  if (lists.status === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading your task lists…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (lists.status === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.title} accessibilityRole="header">
            Task lists
          </Text>
          <Text style={styles.errorText}>{lists.error ?? 'Could not load your task lists.'}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading task lists"
            style={({ pressed }) => [styles.retryButton, pressed ? styles.pressed : null]}
            onPress={lists.refresh}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const hasLists = lists.owned.length > 0 || lists.shared.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <Text style={styles.title} accessibilityRole="header">
            Task lists
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create a new task list"
            style={({ pressed }) => [styles.newButton, pressed ? styles.pressed : null]}
            onPress={() => setIsCreating(true)}
          >
            <Text style={styles.newButtonText}>+ New list</Text>
          </Pressable>
        </View>

        {!hasLists && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No task lists yet. Create your first list to get started.
            </Text>
          </View>
        )}

        {lists.owned.length > 0 && (
          <Section title="My lists">
            {lists.owned.map((calendar) => (
              <ListRow key={calendar.url} name={calendar.displayName} />
            ))}
          </Section>
        )}

        {lists.shared.length > 0 && (
          <Section title="Shared with me">
            {lists.shared.map((calendar) => (
              <ListRow
                key={calendar.url}
                name={calendar.displayName}
                subtitle={calendar.canWrite ? 'Shared with you' : 'Shared with you · read-only'}
              />
            ))}
          </Section>
        )}
      </ScrollView>

      {isCreating && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.overlay}
        >
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle} accessibilityRole="header">
              New task list
            </Text>
            <TextInput
              accessibilityLabel="New list name"
              style={styles.input}
              placeholder="List name"
              placeholderTextColor="#9ca3af"
              value={name}
              onChangeText={setName}
              autoFocus
              autoCorrect={false}
            />
            {lists.createError !== null && (
              <Text style={styles.createError}>{lists.createError}</Text>
            )}
            <View style={styles.dialogActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel creating a list"
                style={({ pressed }) => [styles.cancelButton, pressed ? styles.pressed : null]}
                onPress={closeCreate}
                disabled={lists.isCreating}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={lists.isCreating ? 'Creating list' : 'Create list'}
                style={({ pressed }) => [
                  styles.createButton,
                  name.trim() === '' || lists.isCreating ? styles.createButtonDisabled : null,
                  pressed ? styles.pressed : null,
                ]}
                onPress={() => {
                  void lists.createList(name).then(closeCreate);
                }}
                disabled={name.trim() === '' || lists.isCreating}
              >
                <Text style={styles.createText}>{lists.isCreating ? 'Creating…' : 'Create'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionList}>{children}</View>
    </View>
  );
}

interface ListRowProps {
  name: string;
  subtitle?: string;
}

function ListRow({ name, subtitle }: ListRowProps) {
  return (
    <View style={styles.row} accessibilityRole="listitem" accessibilityLabel={name}>
      <Text style={styles.rowName}>{name}</Text>
      {subtitle !== undefined && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  loadingText: {
    fontSize: 15,
    color: '#555',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 15,
    color: '#dc2626',
    textAlign: 'center',
  },
  retryButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  newButton: {
    borderRadius: 10,
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  newButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
  empty: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sectionList: {
    gap: 8,
  },
  row: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
  },
  rowName: {
    fontSize: 16,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#6b7280',
  },
  pressed: {
    opacity: 0.7,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  createError: {
    fontSize: 14,
    color: '#dc2626',
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelButton: {
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  createButton: {
    borderRadius: 10,
    backgroundColor: '#2563eb',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
});
