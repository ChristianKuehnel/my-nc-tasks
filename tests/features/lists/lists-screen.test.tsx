import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CalDAVCalendar } from '@/services/caldav/types';
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
    refresh: jest.fn(),
    createList: jest.fn(async () => undefined),
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

  it('opens the create dialog and creates a list with the entered name', async () => {
    const createList = jest.fn(async () => undefined);
    await renderScreen({ createList });

    await fireEvent.press(screen.getByLabelText('Create a new task list'));
    expect(screen.getByLabelText('New list name')).toBeDefined();

    await fireEvent.changeText(screen.getByLabelText('New list name'), 'Work');
    await fireEvent.press(screen.getByLabelText('Create list'));
    expect(createList).toHaveBeenCalledWith('Work');
  });

  it('does not call createList for an empty name', async () => {
    const createList = jest.fn(async () => undefined);
    await renderScreen({ createList });

    await fireEvent.press(screen.getByLabelText('Create a new task list'));
    await fireEvent.changeText(screen.getByLabelText('New list name'), '   ');
    await fireEvent.press(screen.getByLabelText('Create list'));
    expect(createList).not.toHaveBeenCalled();
  });

  it('shows the creation error in the dialog and allows retry', async () => {
    const createList = jest.fn(async () => undefined);
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
});
