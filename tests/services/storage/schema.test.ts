import { DatabaseSync } from 'node:sqlite';
import {
  migrateStorage,
  STORAGE_SCHEMA_VERSION,
  type SchemaDatabase,
} from '@/services/storage/schema';

let sqlite: DatabaseSync;
let db: SchemaDatabase;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  db = {
    async execAsync(sql) {
      sqlite.exec(sql);
    },
    async getFirstAsync<T>(sql: string) {
      return (sqlite.prepare(sql).get() as T | undefined) ?? null;
    },
  };
});

afterEach(() => sqlite.close());

it('initializes the schema and can reopen it without losing rows', async () => {
  await migrateStorage(db);
  sqlite.exec("INSERT INTO accounts VALUES (1, 'https://example.test', 'person');");
  await migrateStorage(db);
  expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({
    user_version: STORAGE_SCHEMA_VERSION,
  });
  expect(sqlite.prepare('SELECT id FROM accounts').get()).toEqual({ id: 1 });
});

it('isolates identical URLs by account and keeps pending changes when cached rows disappear', async () => {
  await migrateStorage(db);
  sqlite.exec(`
    INSERT INTO accounts VALUES (1, 'https://example.test', 'one'), (2, 'https://example.test', 'two');
    INSERT INTO task_lists (account_id, url, display_name, can_read, can_write)
    VALUES (1, '/shared/', 'Shared', 1, 1), (2, '/shared/', 'Shared', 1, 0);
    INSERT INTO tasks VALUES (1, '/shared/', '/shared/item.ics', 'uid', '"1"', 'first'),
      (2, '/shared/', '/shared/item.ics', 'uid', '"2"', 'second');
    INSERT INTO list_shares VALUES (1, '/shared/', 'principal:test', NULL, 'read');
    INSERT INTO pending_operations (account_id, list_url, task_url, kind, enqueued_at)
    VALUES (1, '/shared/', '/shared/item.ics', 'update', 0);
    DELETE FROM task_lists WHERE account_id = 1;
  `);
  expect(sqlite.prepare('SELECT account_id, vtodo FROM tasks').all()).toEqual([
    { account_id: 2, vtodo: 'second' },
  ]);
  expect(sqlite.prepare('SELECT * FROM list_shares').all()).toEqual([]);
  expect(sqlite.prepare('SELECT account_id FROM pending_operations').all()).toEqual([
    { account_id: 1 },
  ]);
  expect(() =>
    sqlite.exec("INSERT INTO tasks VALUES (1, '/shared/', 'orphan', 'uid', NULL, 'task');"),
  ).toThrow(/FOREIGN KEY/);
  sqlite.exec('DELETE FROM accounts WHERE id = 1;');
  expect(sqlite.prepare('SELECT * FROM pending_operations').all()).toEqual([]);
});

it('rolls back a failed migration including its version marker', async () => {
  const failing: SchemaDatabase = {
    ...db,
    async execAsync(sql) {
      if (sql.startsWith('PRAGMA user_version =')) throw new Error('Injected failure');
      await db.execAsync(sql);
    },
  };
  await expect(migrateStorage(failing)).rejects.toThrow('Injected failure');
  expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({ user_version: 0 });
  expect(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'accounts'").get(),
  ).toBeUndefined();
  await expect(migrateStorage(db)).resolves.toBeUndefined();
});

it('refuses a newer schema without changing its version or data', async () => {
  sqlite.exec(
    `PRAGMA user_version = ${STORAGE_SCHEMA_VERSION + 1}; CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES ('keep');`,
  );
  await expect(migrateStorage(db)).rejects.toThrow(/newer version/);
  expect(sqlite.prepare('PRAGMA user_version').get()).toEqual({
    user_version: STORAGE_SCHEMA_VERSION + 1,
  });
  expect(sqlite.prepare('SELECT value FROM future_data').get()).toEqual({ value: 'keep' });
});
