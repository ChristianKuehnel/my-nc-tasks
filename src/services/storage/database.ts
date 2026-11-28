import { openDatabaseAsync } from 'expo-sqlite';
import { migrateStorage } from './schema';

/** Opens a private handle; the caller owns its lifetime after migration. */
export async function openTaskDatabase() {
  const database = await openDatabaseAsync('my-nc-tasks.db', { useNewConnection: true });
  try {
    await migrateStorage(database);
    return database;
  } catch (error) {
    await database.closeAsync();
    throw error;
  }
}
