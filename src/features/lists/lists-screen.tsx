import { useEffect, useState } from 'react';
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
import type { CalendarShare, SharePrincipal } from '@/services/caldav/sharing';
import type { CalDAVCalendar } from '@/services/caldav/types';
import type { AuthSession } from '@/services/nextcloud/types';
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useLists, type UseListsResult } from './use-lists';

interface ListsScreenProps {
  session: AuthSession;
  /** Optional dependency overrides (used by tests). */
  options?: CreateCalendarDeps;
}

/** Which dialog is open (at most one at a time), or `null`. */
type Dialog =
  | { kind: 'create' }
  | { kind: 'rename'; calendar: CalDAVCalendar }
  | { kind: 'delete'; calendar: CalDAVCalendar }
  | { kind: 'trash' | 'restore'; calendar: CalDAVCalendar }
  | { kind: 'unsubscribe'; calendar: CalDAVCalendar }
  | { kind: 'share'; calendar: CalDAVCalendar }
  | null;

function toCredentials(session: AuthSession) {
  return {
    serverUrl: session.serverUrl,
    loginName: session.loginName,
    appPassword: session.appPassword,
  };
}

/**
 * A short share-state line for an owned list, or `null` when the list has no
 * shares (the share list is loaded lazily when the share dialog opens, so an
 * empty array means "nothing to show yet").
 */
function shareSubtitle(shares: CalendarShare[]): string | null {
  if (shares.length === 0) {
    return null;
  }
  const n = shares.length;
  return `Shared with ${n} ${n === 1 ? 'person' : 'people'}`;
}

/**
 * Task list overview (Phases 1.3 + 1.4): owned and shared VTODO calendars
 * with empty/loading/error states, a create flow (MKCALENDAR), and safe
 * mutations. Owned lists can be renamed and moved to Trash on supported
 * servers, or explicitly deleted where Trash is unavailable. Shared lists
 * can only be unsubscribed, without changing the owner's data.
 */
export function ListsScreen({ session, options }: ListsScreenProps) {
  const lists = useLists(toCredentials(session), options);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [openList, setOpenList] = useState<CalDAVCalendar | null>(null);

  const busy = lists.isCreating || lists.isMutating;
  const closeDialog = () => {
    setDialog(null);
    setDraftName('');
  };

  const openCreate = () => {
    setDraftName('');
    setDialog({ kind: 'create' });
  };
  const openRename = (calendar: CalDAVCalendar) => {
    setDraftName(calendar.displayName);
    setDialog({ kind: 'rename', calendar });
  };
  const openShare = (calendar: CalDAVCalendar) => {
    setDialog({ kind: 'share', calendar });
  };

  if (openList) {
    return (
      <TasksScreen
        key={openList.url}
        calendar={openList}
        session={session}
        options={options}
        onBack={() => setOpenList(null)}
      />
    );
  }

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
            onPress={openCreate}
            disabled={busy}
          >
            <Text style={styles.newButtonText}>+ New list</Text>
          </Pressable>
        </View>

        {lists.trashSupported && (
          <RowButton
            label={showTrash ? 'Back to task lists' : 'Trash'}
            accessibilityLabel={showTrash ? 'Back to task lists' : 'Open Trash'}
            disabled={busy}
            onPress={() => {
              if (!showTrash) lists.refresh();
              setShowTrash(!showTrash);
            }}
          />
        )}

        {lists.trashSupported && showTrash ? (
          <Section title="Trash">
            {lists.trashed.length === 0 && <Text style={styles.emptyText}>Trash is empty.</Text>}
            {lists.trashed.map((calendar) => (
              <ListRow
                key={calendar.url}
                name={calendar.displayName}
                busy={busy}
                onRestore={() => setDialog({ kind: 'restore', calendar })}
              />
            ))}
          </Section>
        ) : (
          <>
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
                  <ListRow
                    key={calendar.url}
                    name={calendar.displayName}
                    subtitle={shareSubtitle(lists.getShares(calendar.url))}
                    busy={busy}
                    onRename={() => openRename(calendar)}
                    onOpen={calendar.canRead ? () => setOpenList(calendar) : undefined}
                    onShare={lists.sharingSupported ? () => openShare(calendar) : undefined}
                    onTrash={
                      lists.trashSupported && calendar.canWrite
                        ? () => setDialog({ kind: 'trash', calendar })
                        : undefined
                    }
                    onDelete={
                      lists.trashSupported
                        ? undefined
                        : () => setDialog({ kind: 'delete', calendar })
                    }
                  />
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
                    busy={busy}
                    onUnsubscribe={() => setDialog({ kind: 'unsubscribe', calendar })}
                    onOpen={calendar.canRead ? () => setOpenList(calendar) : undefined}
                  />
                ))}
              </Section>
            )}
          </>
        )}
      </ScrollView>

      {dialog?.kind === 'create' && (
        <DialogShell
          title="New task list"
          error={lists.createError}
          actions={
            <>
              <DialogButton
                label="Cancel"
                accessibilityLabel="Cancel creating a list"
                disabled={lists.isCreating}
                onPress={closeDialog}
              />
              <DialogButton
                label={lists.isCreating ? 'Creating…' : 'Create'}
                accessibilityLabel="Create list"
                disabled={draftName.trim() === '' || lists.isCreating}
                primary
                onPress={() => {
                  void lists.createList(draftName).then((ok) => {
                    if (ok) {
                      closeDialog();
                    }
                  });
                }}
              />
            </>
          }
        >
          <TextInput
            accessibilityLabel="New list name"
            style={styles.input}
            placeholder="List name"
            placeholderTextColor="#9ca3af"
            value={draftName}
            onChangeText={setDraftName}
            autoFocus
            autoCorrect={false}
          />
        </DialogShell>
      )}

      {dialog?.kind === 'rename' && (
        <DialogShell
          title="Rename list"
          error={lists.mutationError}
          actions={
            <>
              <DialogButton
                label="Cancel"
                accessibilityLabel="Cancel renaming a list"
                disabled={lists.isMutating}
                onPress={closeDialog}
              />
              <DialogButton
                label={lists.isMutating ? 'Renaming…' : 'Rename'}
                accessibilityLabel="Confirm rename list"
                disabled={draftName.trim() === '' || lists.isMutating}
                primary
                onPress={() => {
                  void lists.renameList(dialog.calendar.url, draftName).then((ok) => {
                    if (ok) {
                      closeDialog();
                    }
                  });
                }}
              />
            </>
          }
        >
          <TextInput
            accessibilityLabel="New list name"
            style={styles.input}
            placeholder="List name"
            placeholderTextColor="#9ca3af"
            value={draftName}
            onChangeText={setDraftName}
            autoFocus
            autoCorrect={false}
          />
        </DialogShell>
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Permanently delete list?"
          message={`“${dialog.calendar.displayName}” and all of its tasks will be permanently deleted. This cannot be undone.`}
          confirmLabel={lists.isMutating ? 'Deleting…' : 'Delete'}
          confirmAccessibilityLabel="Confirm delete list"
          busy={lists.isMutating}
          error={lists.mutationError}
          destructive
          onCancel={closeDialog}
          onConfirm={() => {
            void lists.deleteList(dialog.calendar.url).then((ok) => {
              if (ok) {
                closeDialog();
              }
            });
          }}
        />
      )}

      {(dialog?.kind === 'trash' || dialog?.kind === 'restore') && (
        <ConfirmDialog
          title={dialog.kind === 'trash' ? 'Move list to Trash?' : 'Restore list?'}
          message={
            dialog.kind === 'trash'
              ? `“${dialog.calendar.displayName}” and its tasks will move to Nextcloud Trash. You can restore them until the server removes them.`
              : `“${dialog.calendar.displayName}” and its tasks will return to your active lists.`
          }
          confirmLabel={dialog.kind === 'trash' ? 'Move to Trash' : 'Restore'}
          confirmAccessibilityLabel={
            dialog.kind === 'trash' ? 'Confirm move to Trash' : 'Confirm restore list'
          }
          busy={lists.isMutating}
          error={lists.mutationError}
          destructive={false}
          onCancel={closeDialog}
          onConfirm={() => {
            const mutate = dialog.kind === 'trash' ? lists.trashList : lists.restoreList;
            void mutate(dialog.calendar.url).then((ok) => {
              if (ok) closeDialog();
            });
          }}
        />
      )}

      {dialog?.kind === 'unsubscribe' && (
        <ConfirmDialog
          title="Unsubscribe?"
          message={`“${dialog.calendar.displayName}” will be removed from your account. The owner’s list and its tasks are not affected.`}
          confirmLabel={lists.isMutating ? 'Unsubscribing…' : 'Unsubscribe'}
          confirmAccessibilityLabel="Confirm unsubscribe from list"
          busy={lists.isMutating}
          error={lists.mutationError}
          destructive
          onCancel={closeDialog}
          onConfirm={() => {
            void lists.unsubscribeList(dialog.calendar.url).then((ok) => {
              if (ok) {
                closeDialog();
              }
            });
          }}
        />
      )}

      {dialog?.kind === 'share' && (
        <ShareDialog lists={lists} calendar={dialog.calendar} onClose={closeDialog} />
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
  subtitle?: string | null;
  busy: boolean;
  onRename?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  onTrash?: () => void;
  onRestore?: () => void;
  onUnsubscribe?: () => void;
  onOpen?: () => void;
}

function ListRow({
  name,
  subtitle,
  busy,
  onRename,
  onShare,
  onDelete,
  onTrash,
  onRestore,
  onUnsubscribe,
  onOpen,
}: ListRowProps) {
  const hasActions =
    onRename !== undefined ||
    onShare !== undefined ||
    onDelete !== undefined ||
    onTrash !== undefined ||
    onRestore !== undefined ||
    onUnsubscribe !== undefined;
  return (
    <View style={styles.row} accessibilityRole="listitem" accessibilityLabel={name}>
      <View style={styles.rowText}>
        {onOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open list ${name}`}
            disabled={busy}
            onPress={onOpen}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={styles.rowName}>{name}</Text>
          </Pressable>
        ) : (
          <Text style={styles.rowName}>{name}</Text>
        )}
        {subtitle !== undefined && subtitle !== null && (
          <Text style={styles.rowSubtitle}>{subtitle}</Text>
        )}
      </View>
      {hasActions && (
        <View style={styles.rowActions}>
          {onRename !== undefined && (
            <RowButton
              label="Rename"
              accessibilityLabel={`Rename ${name}`}
              disabled={busy}
              onPress={onRename}
            />
          )}
          {onShare !== undefined && (
            <RowButton
              label="Share"
              accessibilityLabel={`Share ${name}`}
              disabled={busy}
              onPress={onShare}
            />
          )}
          {onUnsubscribe !== undefined && (
            <RowButton
              label="Unsubscribe"
              accessibilityLabel={`Unsubscribe from ${name}`}
              disabled={busy}
              onPress={onUnsubscribe}
            />
          )}
          {onDelete !== undefined && (
            <RowButton
              label="Delete"
              accessibilityLabel={`Delete ${name}`}
              disabled={busy}
              destructive
              onPress={onDelete}
            />
          )}
          {onTrash && (
            <RowButton
              label="Move to Trash"
              accessibilityLabel={`Move ${name} to Trash`}
              disabled={busy}
              onPress={onTrash}
            />
          )}
          {onRestore && (
            <RowButton
              label="Restore"
              accessibilityLabel={`Restore ${name}`}
              disabled={busy}
              onPress={onRestore}
            />
          )}
        </View>
      )}
    </View>
  );
}

interface RowButtonProps {
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  destructive?: boolean;
  onPress: () => void;
}

function RowButton({ label, accessibilityLabel, disabled, destructive, onPress }: RowButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.rowButton,
        destructive ? styles.rowButtonDestructive : null,
        pressed ? styles.pressed : null,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.rowButtonText, destructive ? styles.rowButtonTextDestructive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

interface DialogShellProps {
  title: string;
  error?: string | null;
  children: React.ReactNode;
  actions: React.ReactNode;
}

function DialogShell({ title, error, children, actions }: DialogShellProps) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.overlay}
    >
      <View style={styles.dialog} accessibilityRole="dialog">
        <Text style={styles.dialogTitle} accessibilityRole="header">
          {title}
        </Text>
        {children}
        {error !== undefined && error !== null && <Text style={styles.mutationError}>{error}</Text>}
        <View style={styles.dialogActions}>{actions}</View>
      </View>
    </KeyboardAvoidingView>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  confirmAccessibilityLabel: string;
  busy: boolean;
  error?: string | null;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmAccessibilityLabel,
  busy,
  error,
  destructive,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <DialogShell
      title={title}
      error={error}
      actions={
        <>
          <DialogButton
            label="Cancel"
            accessibilityLabel="Cancel"
            disabled={busy}
            onPress={onCancel}
          />
          <DialogButton
            label={confirmLabel}
            accessibilityLabel={confirmAccessibilityLabel}
            disabled={busy}
            destructive={destructive}
            onPress={onConfirm}
          />
        </>
      }
    >
      <Text style={styles.dialogBody}>{message}</Text>
    </DialogShell>
  );
}

interface DialogButtonProps {
  label: string;
  accessibilityLabel: string;
  disabled?: boolean;
  primary?: boolean;
  destructive?: boolean;
  onPress: () => void;
}

function DialogButton({
  label,
  accessibilityLabel,
  disabled,
  primary,
  destructive,
  onPress,
}: DialogButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.dialogButton,
        primary ? styles.dialogButtonPrimary : null,
        destructive ? styles.dialogButtonDestructive : null,
        disabled ? styles.dialogButtonDisabled : null,
        pressed ? styles.pressed : null,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text
        style={[
          styles.dialogButtonText,
          primary || destructive ? styles.dialogButtonTextInverse : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface ShareDialogProps {
  lists: UseListsResult;
  calendar: CalDAVCalendar;
  onClose: () => void;
}

/**
 * Manage sharing for one owned list (Phase 1.5). Loads the current shares,
 * lets the user search for shareable users/groups and add them, change a
 * share's access level, or revoke it. Only rendered when the server advertises
 * the `oc-resource-sharing` capability (the parent gates the entry point).
 */
function ShareDialog({ lists, calendar, onClose }: ShareDialogProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SharePrincipal[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const shares = lists.getShares(calendar.url);

  // Load (or reload) this calendar's shares when the dialog opens.
  useEffect(() => {
    void lists.refreshShares(calendar.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.url]);

  const runSearch = () => {
    const trimmed = query.trim();
    if (trimmed === '' || isSearching) {
      return;
    }
    setIsSearching(true);
    void lists.searchSharePrincipals(trimmed).then((found) => {
      setResults(found);
      setIsSearching(false);
    });
  };

  const addShare = (principal: SharePrincipal) => {
    void lists.shareCalendar(calendar.url, principal.principal, 'read').then((ok) => {
      if (ok) {
        setQuery('');
        setResults([]);
      }
    });
  };

  const toggleAccess = (share: CalendarShare) => {
    const next = share.access === 'read' ? 'read-write' : 'read';
    void lists.updateShareAccess(calendar.url, share.principal, next);
  };

  const removeShare = (share: CalendarShare) => {
    void lists.revokeShare(calendar.url, share.principal);
  };

  return (
    <DialogShell
      title={`Share “${calendar.displayName}”`}
      error={lists.shareError}
      actions={
        <DialogButton label="Done" accessibilityLabel="Close share dialog" onPress={onClose} />
      }
    >
      <View style={styles.shareSection}>
        <Text style={styles.shareSectionTitle}>
          {shares.length === 0 ? 'Not shared yet' : 'Shared with'}
        </Text>
        {shares.length === 0 ? (
          <Text style={styles.shareEmpty}>Add a person or group below to share this list.</Text>
        ) : (
          <View style={styles.shareList}>
            {shares.map((share) => (
              <ShareRow
                key={share.principal}
                name={share.displayName ?? 'Unknown'}
                access={share.access}
                busy={lists.isSharing}
                onToggle={() => toggleAccess(share)}
                onRemove={() => removeShare(share)}
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.shareSearch}>
        <View style={styles.shareSearchInputRow}>
          <TextInput
            accessibilityLabel="Search people or groups to share with"
            style={styles.shareSearchInput}
            placeholder="Search people or groups"
            placeholderTextColor="#9ca3af"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={runSearch}
          />
          <RowButton
            label="Search"
            accessibilityLabel="Search people or groups"
            disabled={query.trim() === '' || isSearching || lists.isSharing}
            onPress={runSearch}
          />
        </View>

        {isSearching && (
          <View style={styles.shareSearchStatus} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" />
          </View>
        )}

        {!isSearching && results.length > 0 && (
          <View style={styles.shareResults}>
            {results.map((principal) => (
              <SearchResultRow
                key={principal.principal}
                name={principal.displayName}
                kind={principal.kind}
                busy={lists.isSharing}
                onAdd={() => addShare(principal)}
              />
            ))}
          </View>
        )}
      </View>
    </DialogShell>
  );
}

interface ShareRowProps {
  name: string;
  access: 'read' | 'read-write';
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
}

function ShareRow({ name, access, busy, onToggle, onRemove }: ShareRowProps) {
  const label = access === 'read' ? 'Read-only' : 'Read-write';
  return (
    <View style={styles.shareRow} accessibilityRole="listitem" accessibilityLabel={name}>
      <Text style={styles.shareRowName}>{name}</Text>
      <View style={styles.shareRowActions}>
        <RowButton
          label={label}
          accessibilityLabel={`Toggle access for ${name}, currently ${label}`}
          disabled={busy}
          onPress={onToggle}
        />
        <RowButton
          label="Remove"
          accessibilityLabel={`Remove ${name}`}
          destructive
          disabled={busy}
          onPress={onRemove}
        />
      </View>
    </View>
  );
}

interface SearchResultRowProps {
  name: string;
  kind: 'user' | 'group' | 'room' | 'resource' | 'other';
  busy: boolean;
  onAdd: () => void;
}

function SearchResultRow({ name, kind, busy, onAdd }: SearchResultRowProps) {
  return (
    <View style={styles.shareRow} accessibilityRole="listitem" accessibilityLabel={name}>
      <Text style={styles.shareRowName}>
        {name}
        {kind !== 'other' ? ` (${kind})` : ''}
      </Text>
      <View style={styles.shareRowActions}>
        <RowButton label="Add" accessibilityLabel={`Add ${name}`} disabled={busy} onPress={onAdd} />
      </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowText: {
    flex: 1,
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
  rowActions: {
    flexDirection: 'row',
    gap: 8,
  },
  rowButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rowButtonDestructive: {
    borderColor: '#fca5a5',
  },
  rowButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  rowButtonTextDestructive: {
    color: '#dc2626',
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
  dialogBody: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 21,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  mutationError: {
    fontSize: 14,
    color: '#dc2626',
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  dialogButton: {
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  dialogButtonPrimary: {
    backgroundColor: '#2563eb',
  },
  dialogButtonDestructive: {
    backgroundColor: '#dc2626',
  },
  dialogButtonDisabled: {
    opacity: 0.5,
  },
  dialogButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  dialogButtonTextInverse: {
    color: '#ffffff',
  },
  shareSection: {
    gap: 8,
  },
  shareSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  shareEmpty: {
    fontSize: 14,
    color: '#6b7280',
  },
  shareList: {
    gap: 8,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  shareRowName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  shareRowActions: {
    flexDirection: 'row',
    gap: 8,
  },
  shareSearch: {
    gap: 8,
  },
  shareSearchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareSearchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  shareSearchStatus: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  shareResults: {
    gap: 8,
  },
});
