import { render, screen } from '@testing-library/react-native';

import ListsRoute from '@/app/lists';
import { useAuth, type UseAuthResult } from '@/features/auth/use-auth';
import { useLists, type UseListsResult } from '@/features/lists/use-lists';

jest.mock('@/features/auth/use-auth', () => ({
  useAuth: jest.fn(),
}));
jest.mock('@/features/lists/use-lists', () => ({
  useLists: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseLists = useLists as jest.MockedFunction<typeof useLists>;

const SESSION = {
  serverUrl: 'https://cloud.example.com',
  loginName: 'alice',
  appPassword: 'secret',
};

function authResult(overrides: Partial<UseAuthResult>): UseAuthResult {
  return {
    status: 'unauthenticated',
    session: null,
    error: null,
    login: jest.fn(),
    cancel: jest.fn(),
    logout: jest.fn(),
    ...overrides,
  };
}

function listsResult(overrides: Partial<UseListsResult>): UseListsResult {
  return {
    status: 'ready',
    error: null,
    owned: [],
    shared: [],
    isCreating: false,
    createError: null,
    isMutating: false,
    mutationError: null,
    refresh: jest.fn(),
    createList: jest.fn(async () => true),
    renameList: jest.fn(async () => true),
    deleteList: jest.fn(async () => true),
    unsubscribeList: jest.fn(async () => true),
    ...overrides,
  };
}

describe('ListsRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLists.mockReturnValue(listsResult({}));
  });

  it('shows a loading state while restoring the session', async () => {
    mockUseAuth.mockReturnValue(authResult({ status: 'restoring' }));
    await render(<ListsRoute />);
    expect(screen.getByText('Loading…')).toBeDefined();
    expect(mockUseLists).not.toHaveBeenCalled();
  });

  it('shows a loading state when unauthenticated', async () => {
    mockUseAuth.mockReturnValue(authResult({}));
    await render(<ListsRoute />);
    expect(screen.getByText('Loading…')).toBeDefined();
    expect(mockUseLists).not.toHaveBeenCalled();
  });

  it('renders the lists screen with the session when authenticated', async () => {
    mockUseAuth.mockReturnValue(authResult({ status: 'authenticated', session: SESSION }));
    await render(<ListsRoute />);
    expect(mockUseLists).toHaveBeenCalledTimes(1);
    const [credentials] = mockUseLists.mock.calls[0];
    expect(credentials).toEqual(SESSION);
    expect(screen.getByText('Task lists')).toBeDefined();
  });
});
