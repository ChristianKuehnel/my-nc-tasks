import { act, renderHook, waitFor } from '@testing-library/react-native';

import { createCalendar } from '@/services/caldav/collections';
import { CalDAVError } from '@/services/caldav/http';
import { discoverCalendars } from '@/services/caldav/discovery';
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

const mockDiscover = discoverCalendars as jest.MockedFunction<typeof discoverCalendars>;
const mockCreate = createCalendar as jest.MockedFunction<typeof createCalendar>;

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
      calendars: [TASKS, SHARED, EVENTS],
    });
    mockCreate.mockReset().mockResolvedValue({ url: `${HOME}work/` });
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
        calendars: [TASKS],
      });
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
