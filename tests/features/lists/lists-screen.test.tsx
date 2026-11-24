import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CalDAVCalendar } from '@/services/caldav/types';
import type { SharePrincipal } from '@/services/caldav/sharing';
import type { AuthSession } from '@/services/nextcloud/types';
import { useLists, type UseListsResult } from '@/features/lists/use-lists';
import { ListsScreen } from '@/features/lists/lists-screen';

jest.mock('@/features/lists/use-lists', () => ({
  useLists: jest.fn(),
}));

const mockUseLists = useLists as jest.MockedFunction<typeof useLists>;

const SESSION: AuthSession = {
  serverUrl: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'secret',
};

function calendar(overrides: Partial<CalDAVCalendar> & { url: string }): CalDAVCalendar {
  return {
    displayName: 'Calendar',
    components: ['VTODO'],
    isTaskList: true,
    ownerUrl: 'https://cloud.example.com/remote.php/dav/principals/users/alice/',
    isOwned: true,
    isSharedWithMe: false,
    sharedAddresses: [],
    canRead: true,
    canWrite: true,
    ...overrides,
  };
}

const TASKS = calendar({ url: 'https://cloud.example.com/x/tasks/', displayName: 'Tasks' });
const READONLY_SHARED = calendar({
  url: 'https://cloud.example.com/bob/shared/',
  displayName: "Bob's Tasks",
  ownerUrl: 'https://cloud.example.com/remote.php/dav/principals/users/bob/',
  isOwned: false,
  isSharedWithMe: true,
  canWrite: false,
});

function listsResult(overrides: Partial<UseListsResult>): UseListsResult {
  return {
    status: 'ready',
    error: null,
    owned: [TASKS],
    shared: [READONLY_SHARED],
    isCreating: false,
    createError: null,
    isMutating: false,
    mutationError: null,
    sharingSupported: false,
    isSharing: false,
    shareError: null,
    getShares: jest.fn(() => []),
    refreshShares: jest.fn(async () => undefined),
    searchSharePrincipals: jest.fn(async () => []),
    shareCalendar: jest.fn(async () => true),
    updateShareAccess: jest.fn(async () => true),
    revokeShare: jest.fn(async () => true),
    refresh: jest.fn(),
    createList: jest.fn(async () => true),
    renameList: jest.fn(async () => true),
    deleteList: jest.fn(async () => true),
    unsubscribeList: jest.fn(async () => true),
    ...overrides,
  };
}

function renderScreen(overrides: Partial<UseListsResult> = {}) {
  mockUseLists.mockReturnValue(listsResult(overrides));
  return render(<ListsScreen session={SESSION} />);
}

describe('ListsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading state', async () => {
    await renderScreen({ status: 'loading', owned: [], shared: [] });
    expect(screen.getByText('Loading your task lists…')).toBeDefined();
  });

  it('shows an error state with a working retry button', async () => {
    const refresh = jest.fn();
    await renderScreen({
      status: 'error',
      error: 'The server rejected the credentials (HTTP 401).',
      refresh,
    });
    expect(screen.getByText('The server rejected the credentials (HTTP 401).')).toBeDefined();
    await fireEvent.press(screen.getByLabelText('Retry loading task lists'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows owned and shared lists in separate sections', async () => {
    await renderScreen();
    expect(screen.getByText('My lists')).toBeDefined();
    expect(screen.getByText('Shared with me')).toBeDefined();
    expect(screen.getByText('Tasks')).toBeDefined();
    expect(screen.getByText("Bob's Tasks")).toBeDefined();
    expect(screen.getByText('Shared with you · read-only')).toBeDefined();
  });

  it('shows an empty state when there are no lists', async () => {
    await renderScreen({ owned: [], shared: [] });
    expect(screen.getByText(/No task lists yet/)).toBeDefined();
    expect(screen.queryByText('My lists')).toBeNull();
  });

  it('offers rename + delete for owned lists but only unsubscribe for shared lists', async () => {
    await renderScreen();
    // Owned row: rename and delete, but no unsubscribe.
    expect(screen.getByLabelText('Rename Tasks')).toBeDefined();
    expect(screen.getByLabelText('Delete Tasks')).toBeDefined();
    expect(screen.queryByLabelText('Unsubscribe Tasks')).toBeNull();
    // Shared row: unsubscribe, but no rename or delete of the owner's data.
    expect(screen.getByLabelText("Unsubscribe from Bob's Tasks")).toBeDefined();
    expect(screen.queryByLabelText("Rename Bob's Tasks")).toBeNull();
    expect(screen.queryByLabelText("Delete Bob's Tasks")).toBeNull();
  });

  it('opens the create dialog and creates a list with the entered name', async () => {
    const createList = jest.fn(async () => true);
    await renderScreen({ createList });

    await fireEvent.press(screen.getByLabelText('Create a new task list'));
    expect(screen.getByLabelText('New list name')).toBeDefined();

    await fireEvent.changeText(screen.getByLabelText('New list name'), 'Work');
    await fireEvent.press(screen.getByLabelText('Create list'));
    expect(createList).toHaveBeenCalledWith('Work');
  });

  it('does not call createList for an empty name', async () => {
    const createList = jest.fn(async () => true);
    await renderScreen({ createList });

    await fireEvent.press(screen.getByLabelText('Create a new task list'));
    await fireEvent.changeText(screen.getByLabelText('New list name'), '   ');
    await fireEvent.press(screen.getByLabelText('Create list'));
    expect(createList).not.toHaveBeenCalled();
  });

  it('shows the creation error in the dialog and allows retry', async () => {
    const createList = jest.fn(async () => true);
    await renderScreen({
      createList,
      createError: 'The server rejected the request (HTTP 400).',
    });

    await fireEvent.press(screen.getByLabelText('Create a new task list'));
    expect(screen.getByText('The server rejected the request (HTTP 400).')).toBeDefined();

    await fireEvent.changeText(screen.getByLabelText('New list name'), 'Other');
    await fireEvent.press(screen.getByLabelText('Create list'));
    expect(createList).toHaveBeenCalledWith('Other');
  });

  it('renames a list through the confirmation dialog (prefilled, confirms new name)', async () => {
    const renameList = jest.fn(async () => true);
    await renderScreen({ renameList });

    await fireEvent.press(screen.getByLabelText('Rename Tasks'));
    const input = screen.getByLabelText('New list name');
    expect(input).toBeDefined();
    expect(input.props.value).toBe('Tasks');

    await fireEvent.changeText(input, 'Work');
    await fireEvent.press(screen.getByLabelText('Confirm rename list'));
    expect(renameList).toHaveBeenCalledWith(TASKS.url, 'Work');
  });

  it('does not rename when the name is cleared to whitespace', async () => {
    const renameList = jest.fn(async () => true);
    await renderScreen({ renameList });

    await fireEvent.press(screen.getByLabelText('Rename Tasks'));
    await fireEvent.changeText(screen.getByLabelText('New list name'), '   ');
    await fireEvent.press(screen.getByLabelText('Confirm rename list'));
    expect(renameList).not.toHaveBeenCalled();
  });

  it('surfaces a rename error and keeps the dialog open for retry', async () => {
    const renameList = jest.fn(async () => false);
    await renderScreen({
      renameList,
      mutationError: 'The server refused to rename the list (HTTP 403).',
    });

    await fireEvent.press(screen.getByLabelText('Rename Tasks'));
    expect(screen.getByText('The server refused to rename the list (HTTP 403).')).toBeDefined();
    // The confirm button is still present (dialog not closed on failure).
    expect(screen.getByLabelText('Confirm rename list')).toBeDefined();
  });

  it('deletes a list only after explicit confirmation', async () => {
    const deleteList = jest.fn(async () => true);
    await renderScreen({ deleteList });

    // Pressing Delete opens the confirmation; no delete happens yet.
    await fireEvent.press(screen.getByLabelText('Delete Tasks'));
    expect(screen.getByText('Delete list?')).toBeDefined();
    expect(deleteList).not.toHaveBeenCalled();

    // Cancelling performs no delete.
    await fireEvent.press(screen.getByLabelText('Cancel'));
    expect(deleteList).not.toHaveBeenCalled();

    // Confirming deletes.
    await fireEvent.press(screen.getByLabelText('Delete Tasks'));
    await fireEvent.press(screen.getByLabelText('Confirm delete list'));
    expect(deleteList).toHaveBeenCalledWith(TASKS.url);
  });

  it('refuses to offer delete for a shared list', async () => {
    await renderScreen();
    expect(screen.queryByLabelText("Delete Bob's Tasks")).toBeNull();
  });

  it('unsubscribes from a shared list only after explicit confirmation', async () => {
    const unsubscribeList = jest.fn(async () => true);
    await renderScreen({ unsubscribeList });

    await fireEvent.press(screen.getByLabelText("Unsubscribe from Bob's Tasks"));
    expect(screen.getByText('Unsubscribe?')).toBeDefined();
    expect(unsubscribeList).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Confirm unsubscribe from list'));
    expect(unsubscribeList).toHaveBeenCalledWith(READONLY_SHARED.url);
  });

  it('offers the Share action only when the server supports sharing', async () => {
    await renderScreen();
    expect(screen.queryByLabelText('Share Tasks')).toBeNull();

    await renderScreen({ sharingSupported: true });
    expect(screen.getByLabelText('Share Tasks')).toBeDefined();
  });

  it('shows a share subtitle on owned rows that have shares', async () => {
    await renderScreen({
      getShares: jest.fn((url: string) =>
        url === TASKS.url
          ? [
              { principal: 'principal:principals/users/bob', displayName: 'Bob', access: 'read' },
              {
                principal: 'principal:principals/groups/team',
                displayName: null,
                access: 'read-write',
              },
            ]
          : [],
      ),
    });
    expect(screen.getByText('Shared with 2 people')).toBeDefined();
  });

  it('opens the share dialog, loads the shares, and lets you add a sharee', async () => {
    const shareCalendar = jest.fn(async () => true);
    const refreshShares = jest.fn(async () => undefined);
    const searchSharePrincipals = jest.fn(async (): Promise<SharePrincipal[]> => [
      { principal: 'principal:principals/users/bob', displayName: 'Bob Builder', kind: 'user' },
    ]);
    await renderScreen({
      sharingSupported: true,
      shareCalendar,
      refreshShares,
      searchSharePrincipals,
    });

    await fireEvent.press(screen.getByLabelText('Share Tasks'));
    expect(screen.getByText('Share “Tasks”')).toBeDefined();
    expect(refreshShares).toHaveBeenCalledWith(TASKS.url);

    await fireEvent.changeText(
      screen.getByLabelText('Search people or groups to share with'),
      'bob',
    );
    await fireEvent.press(screen.getByLabelText('Search people or groups'));
    expect(searchSharePrincipals).toHaveBeenCalledWith('bob');

    await fireEvent.press(screen.getByLabelText('Add Bob Builder'));
    expect(shareCalendar).toHaveBeenCalledWith(TASKS.url, 'principal:principals/users/bob', 'read');
  });

  it('toggles a share’s access level and removes shares', async () => {
    const updateShareAccess = jest.fn(async () => true);
    const revokeShare = jest.fn(async () => true);
    await renderScreen({
      sharingSupported: true,
      getShares: jest.fn((url: string) =>
        url === TASKS.url
          ? [{ principal: 'principal:principals/users/bob', displayName: 'Bob', access: 'read' }]
          : [],
      ),
      updateShareAccess,
      revokeShare,
    });

    await fireEvent.press(screen.getByLabelText('Share Tasks'));

    await fireEvent.press(screen.getByLabelText('Toggle access for Bob, currently Read-only'));
    expect(updateShareAccess).toHaveBeenCalledWith(
      TASKS.url,
      'principal:principals/users/bob',
      'read-write',
    );

    await fireEvent.press(screen.getByLabelText('Remove Bob'));
    expect(revokeShare).toHaveBeenCalledWith(TASKS.url, 'principal:principals/users/bob');
  });
});
