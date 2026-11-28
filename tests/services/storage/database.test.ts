import { openDatabaseAsync } from 'expo-sqlite';
import { openTaskDatabase } from '@/services/storage/database';
import { migrateStorage } from '@/services/storage/schema';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));
jest.mock('@/services/storage/schema', () => ({ migrateStorage: jest.fn() }));

const database = {
  closeAsync: jest.fn().mockResolvedValue(undefined),
} as unknown as Awaited<ReturnType<typeof openDatabaseAsync>>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(openDatabaseAsync).mockResolvedValue(database);
  jest.mocked(migrateStorage).mockResolvedValue(undefined);
});

it('migrates a private connection before handing it to the caller', async () => {
  await expect(openTaskDatabase()).resolves.toBe(database);
  expect(openDatabaseAsync).toHaveBeenCalledWith('my-nc-tasks.db', { useNewConnection: true });
  expect(migrateStorage).toHaveBeenCalledWith(database);
  expect(database.closeAsync).not.toHaveBeenCalled();
});

it('closes the connection when a migration fails', async () => {
  const failure = new Error('Migration failed');
  jest.mocked(migrateStorage).mockRejectedValue(failure);
  await expect(openTaskDatabase()).rejects.toBe(failure);
  expect(database.closeAsync).toHaveBeenCalledTimes(1);
});
