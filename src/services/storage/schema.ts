/** Minimal database surface shared by Expo SQLite and the migration tests. */
export interface SchemaDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

const migrations = [
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    server_url TEXT NOT NULL,
    login_name TEXT NOT NULL,
    UNIQUE (server_url, login_name)
  );

  CREATE TABLE task_lists (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    display_name TEXT NOT NULL,
    owner_url TEXT,
    can_read INTEGER NOT NULL CHECK (can_read IN (0, 1)),
    can_write INTEGER NOT NULL CHECK (can_write IN (0, 1)),
    is_trashed INTEGER NOT NULL DEFAULT 0 CHECK (is_trashed IN (0, 1)),
    sync_token TEXT,
    last_synced_at INTEGER,
    PRIMARY KEY (account_id, url)
  );

  CREATE TABLE tasks (
    account_id INTEGER NOT NULL,
    list_url TEXT NOT NULL,
    url TEXT NOT NULL,
    uid TEXT NOT NULL,
    etag TEXT,
    vtodo TEXT NOT NULL,
    PRIMARY KEY (account_id, list_url, url),
    FOREIGN KEY (account_id, list_url) REFERENCES task_lists(account_id, url) ON DELETE CASCADE
  );

  CREATE INDEX tasks_by_uid ON tasks (account_id, list_url, uid);

  CREATE TABLE list_shares (
    account_id INTEGER NOT NULL,
    list_url TEXT NOT NULL,
    principal_uri TEXT NOT NULL,
    display_name TEXT,
    access TEXT NOT NULL CHECK (access IN ('read', 'read-write')),
    PRIMARY KEY (account_id, list_url, principal_uri),
    FOREIGN KEY (account_id, list_url) REFERENCES task_lists(account_id, url) ON DELETE CASCADE
  );

  -- A remote list/task disappearing must not discard unresolved local edits.
  CREATE TABLE pending_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    list_url TEXT NOT NULL,
    task_url TEXT NOT NULL,
    kind TEXT NOT NULL,
    base_etag TEXT,
    payload TEXT,
    enqueued_at INTEGER NOT NULL
  );

  CREATE INDEX pending_operations_by_account ON pending_operations (account_id, id);
  `,
] as const;

export const STORAGE_SCHEMA_VERSION = migrations.length;

/** Call on a private connection before handing it to app code. */
export async function migrateStorage(db: SchemaDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync('BEGIN IMMEDIATE;');
  try {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
    const version = row?.user_version;
    if (version === undefined || !Number.isInteger(version) || version < 0) {
      throw new Error('Invalid local storage schema version.');
    }
    if (version > STORAGE_SCHEMA_VERSION) {
      throw new Error('Local storage was created by a newer version of the app.');
    }
    for (let index = version; index < migrations.length; index++) {
      await db.execAsync(migrations[index]);
      await db.execAsync(`PRAGMA user_version = ${index + 1};`);
    }
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}
