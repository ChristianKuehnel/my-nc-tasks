import { act, renderHook, waitFor } from '@testing-library/react-native';

import { createCalendar } from '@/services/caldav/collections';
import { CalDAVError } from '@/services/caldav/http';
import { discoverCalendars } from '@/services/caldav/discovery';
import { deleteCalendar, renameCalendar, unsubscribeCalendar } from '@/services/caldav/mutations';
import {
  listShares,
  searchPrincipals,
  updateShares,
  type CalendarShare,
  type SharePrincipal,
} from '@/services/caldav/sharing';
import type {
  CalDAVCalendar,
  CalDAVCredentials,
  DiscoveredCalendars,
} from '@/services/caldav/types';
import { useLists } from '@/features/lists/use-lists';

jest.mock('@/services/caldav/discovery', () => ({
  discoverCalendars: jest.fn(),
}));
jest.mock('@/services/caldav/collections', () => ({
  createCalendar: jest.fn(),
}));
jest.mock('@/services/caldav/mutations', () => ({
  renameCalendar: jest.fn(),
  deleteCalendar: jest.fn(),
  unsubscribeCalendar: jest.fn(),
}));
jest.mock('@/services/caldav/sharing', () => ({
  listShares: jest.fn(),
  searchPrincipals: jest.fn(),
  updateShares: jest.fn(),
}));

const mockDiscover = discoverCalendars as jest.MockedFunction<typeof discoverCalendars>;
const mockCreate = createCalendar as jest.MockedFunction<typeof createCalendar>;
const mockRename = renameCalendar as jest.MockedFunction<typeof renameCalendar>;
const mockDelete = deleteCalendar as jest.MockedFunction<typeof deleteCalendar>;
const mockUnsubscribe = unsubscribeCalendar as jest.MockedFunction<typeof unsubscribeCalendar>;
const mockListShares = listShares as jest.MockedFunction<typeof listShares>;
const mockSearchPrincipals = searchPrincipals as jest.MockedFunction<typeof searchPrincipals>;
const mockUpdateShares = updateShares as jest.MockedFunction<typeof updateShares>;

const CREDENTIALS: CalDAVCredentials = {
  serverUrl: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'app__pw',
};

const HOME = 'https://cloud.example.com/remote.php/dav/calendars/alice/';

function calendar(overrides: Partial<CalDAVCalendar> & { url: string }): CalDAVCalendar {
  return {
    displayName: overrides.url.split('/').slice(-2, -1)[0] ?? 'Calendar',
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

const TASKS = calendar({ url: `${HOME}tasks/` });
const SHARED = calendar({
  url: 'https://cloud.example.com/remote.php/dav/calendars/bob/shared/',
  displayName: "Bob's Tasks",
  ownerUrl: 'https://cloud.example.com/remote.php/dav/principals/users/bob/',
  isOwned: false,
  isSharedWithMe: true,
  canWrite: false,
});
const EVENTS: CalDAVCalendar = {
  ...calendar({ url: `${HOME}events/` }),
  displayName: 'Events',
  components: ['VEVENT'],
  isTaskList: false,
};

describe('useLists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscover.mockReset().mockResolvedValue({
      principalUrl: 'https://cloud.example.com/remote.php/dav/principals/users/alice/',
      homeSetUrl: HOME,
      davRootUrl: 'https://cloud.example.com/remote.php/dav/',
      capabilities: { sharing: false },
      calendars: [TASKS, SHARED, EVENTS],
    });
    mockCreate.mockReset().mockResolvedValue({ url: `${HOME}work/` });
    mockRename.mockReset().mockResolvedValue(undefined);
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockUnsubscribe.mockReset().mockResolvedValue(undefined);
    mockListShares.mockReset().mockResolvedValue([]);
    mockSearchPrincipals.mockReset().mockResolvedValue([]);
    mockUpdateShares.mockReset().mockResolvedValue(undefined);
  });

  it('loads task lists only (VEVENT calendars are filtered out)', async () => {
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.owned).toEqual([TASKS]);
    expect(result.current.shared).toEqual([SHARED]);
  });

  it('starts in loading and settles to error with a message on failure', async () => {
    mockDiscover.mockRejectedValue(new CalDAVError('unauthorized', 'Bad credentials.'));
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Bad credentials.');
    expect(result.current.owned).toEqual([]);
  });

  it('refresh retries the discovery', async () => {
    mockDiscover
      .mockRejectedValueOnce(new CalDAVError('network', 'Network error: down'))
      .mockResolvedValueOnce({
        principalUrl: 'https://cloud.example.com/remote.php/dav/principals/users/alice/',
        homeSetUrl: HOME,
        davRootUrl: 'https://cloud.example.com/remote.php/dav/',
        capabilities: { sharing: false },
        calendars: [TASKS],
      });

    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('error'));

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.owned).toEqual([TASKS]);
  });

  it('createList creates the calendar and re-discovers', async () => {
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.createList('Work');
    });

    expect(mockCreate).toHaveBeenCalledWith(CREDENTIALS, HOME, 'Work', expect.anything());
    // Re-discovery ran once more (initial + after create).
    expect(mockDiscover).toHaveBeenCalledTimes(2);
    expect(result.current.isCreating).toBe(false);
    expect(result.current.createError).toBeNull();
  });

  it('createList reports a creation error and keeps the previous state', async () => {
    mockCreate.mockRejectedValueOnce(
      new CalDAVError('bad_request', 'The server rejected the request (HTTP 400).'),
    );
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.createList('Work');
    });

    expect(result.current.createError).toBe('The server rejected the request (HTTP 400).');
    expect(result.current.status).toBe('ready');
    expect(result.current.owned).toEqual([TASKS]);
  });

  it('createList is a no-op while still loading (no home set known yet)', async () => {
    let resolveDiscover: (value: DiscoveredCalendars) => void = () => undefined;
    mockDiscover.mockImplementationOnce(
      () =>
        new Promise<DiscoveredCalendars>((resolve) => {
          resolveDiscover = resolve;
        }),
    );
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    expect(result.current.status).toBe('loading');

    await act(async () => {
      await result.current.createList('Work');
    });
    expect(mockCreate).not.toHaveBeenCalled();

    await act(async () => {
      resolveDiscover({
        principalUrl: 'https://cloud.example.com/remote.php/dav/principals/users/alice/',
        homeSetUrl: HOME,
        davRootUrl: 'https://cloud.example.com/remote.php/dav/',
        capabilities: { sharing: false },
        calendars: [TASKS],
      });
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('renameList calls renameCalendar and re-discovers on success', async () => {
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let ok = false;
    await act(async () => {
      ok = await result.current.renameList(TASKS.url, 'Work');
    });

    expect(mockRename).toHaveBeenCalledWith(CREDENTIALS, TASKS.url, 'Work', expect.anything());
    expect(ok).toBe(true);
    expect(mockDiscover).toHaveBeenCalledTimes(2);
    expect(result.current.isMutating).toBe(false);
    expect(result.current.mutationError).toBeNull();
  });

  it('renameList surfaces a forbidden refusal', async () => {
    mockRename.mockRejectedValueOnce(
      new CalDAVError('forbidden', 'The server refused to rename the list (HTTP 403).'),
    );
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let ok = true;
    await act(async () => {
      ok = await result.current.renameList(TASKS.url, 'Work');
    });

    expect(ok).toBe(false);
    expect(result.current.mutationError).toBe('The server refused to rename the list (HTTP 403).');
    expect(result.current.isMutating).toBe(false);
  });

  it('deleteList calls deleteCalendar and re-discovers on success', async () => {
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let ok = false;
    await act(async () => {
      ok = await result.current.deleteList(TASKS.url);
    });

    expect(mockDelete).toHaveBeenCalledWith(CREDENTIALS, TASKS.url, expect.anything());
    expect(ok).toBe(true);
    expect(mockDiscover).toHaveBeenCalledTimes(2);
  });

  it('deleteList surfaces a network error', async () => {
    mockDelete.mockRejectedValueOnce(new CalDAVError('network', 'Could not reach the server.'));
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let ok = true;
    await act(async () => {
      ok = await result.current.deleteList(TASKS.url);
    });

    expect(ok).toBe(false);
    expect(result.current.mutationError).toBe('Could not reach the server.');
  });

  it('unsubscribeList calls unsubscribeCalendar and re-discovers on success', async () => {
    const { result } = await renderHook(() => useLists(CREDENTIALS));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let ok = false;
    await act(async () => {
      ok = await result.current.unsubscribeList(TASKS.url);
    });

    expect(mockUnsubscribe).toHaveBeenCalledWith(CREDENTIALS, TASKS.url, expect.anything());
    expect(ok).toBe(true);
    expect(mockDiscover).toHaveBeenCalledTimes(2);
  });

  describe('sharing', () => {
    const DAV_ROOT = 'https://cloud.example.com/remote.php/dav/';

    it('reflects the sharing capability from discovery', async () => {
      mockDiscover.mockResolvedValue({
        principalUrl: 'https://cloud.example.com/remote.php/dav/principals/users/alice/',
        homeSetUrl: HOME,
        davRootUrl: DAV_ROOT,
        capabilities: { sharing: true },
        calendars: [TASKS],
      });
      const { result } = await renderHook(() => useLists(CREDENTIALS));
      await waitFor(() => expect(result.current.status).toBe('ready'));
      expect(result.current.sharingSupported).toBe(true);
    });

    it('shareCalendar sends a set, refreshes shares, and reports success', async () => {
      const share: CalendarShare = {
        principal: 'principal:principals/users/bob',
        displayName: 'Bob',
        access: 'read',
      };
      mockListShares.mockResolvedValueOnce([share]);
      const { result } = await renderHook(() => useLists(CREDENTIALS));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let ok = false;
      await act(async () => {
        ok = await result.current.shareCalendar(
          TASKS.url,
          'principal:principals/users/bob',
          'read',
        );
      });

      expect(mockUpdateShares).toHaveBeenCalledWith(
        CREDENTIALS,
        TASKS.url,
        [{ principal: 'principal:principals/users/bob', access: 'read' }],
        [],
        expect.anything(),
      );
      expect(ok).toBe(true);
      expect(result.current.getShares(TASKS.url)).toEqual([share]);
    });

    it('shareCalendar surfaces a forbidden refusal and keeps the previous shares', async () => {
      mockUpdateShares.mockRejectedValueOnce(
        new CalDAVError('forbidden', 'The server refused access (HTTP 403).'),
      );
      const { result } = await renderHook(() => useLists(CREDENTIALS));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let ok = true;
      await act(async () => {
        ok = await result.current.shareCalendar(
          TASKS.url,
          'principal:principals/users/bob',
          'read',
        );
      });

      expect(ok).toBe(false);
      expect(result.current.shareError).toBe('The server refused access (HTTP 403).');
      expect(result.current.getShares(TASKS.url)).toEqual([]);
    });

    it('revokeShare sends a remove for the sharee', async () => {
      const { result } = await renderHook(() => useLists(CREDENTIALS));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let ok = false;
      await act(async () => {
        ok = await result.current.revokeShare(TASKS.url, 'principal:principals/users/bob');
      });

      expect(mockUpdateShares).toHaveBeenCalledWith(
        CREDENTIALS,
        TASKS.url,
        [],
        ['principal:principals/users/bob'],
        expect.anything(),
      );
      expect(ok).toBe(true);
    });

    it('searchSharePrincipals queries the DAV root and returns the results', async () => {
      const results: SharePrincipal[] = [
        { principal: '/remote.php/dav/principals/users/bob/', displayName: 'Bob', kind: 'user' },
      ];
      mockSearchPrincipals.mockResolvedValueOnce(results);
      const { result } = await renderHook(() => useLists(CREDENTIALS));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      let found: SharePrincipal[] = [];
      await act(async () => {
        found = await result.current.searchSharePrincipals('bob');
      });

      expect(mockSearchPrincipals).toHaveBeenCalledWith(
        CREDENTIALS,
        DAV_ROOT,
        'bob',
        expect.anything(),
      );
      expect(found).toEqual(results);
    });

    it('refreshShares loads the calendar shares into state', async () => {
      const share: CalendarShare = {
        principal: 'principal:principals/groups/team',
        displayName: null,
        access: 'read',
      };
      mockListShares.mockResolvedValueOnce([share]);
      const { result } = await renderHook(() => useLists(CREDENTIALS));
      await waitFor(() => expect(result.current.status).toBe('ready'));

      expect(result.current.getShares(TASKS.url)).toEqual([]);
      await act(async () => {
        await result.current.refreshShares(TASKS.url);
      });
      expect(result.current.getShares(TASKS.url)).toEqual([share]);
    });
  });
});
