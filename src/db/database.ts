/**
 * Database open + migrate. [TASK-007]
 *
 * Opens better-sqlite3, applies the schema idempotently (all CREATE ... IF NOT
 * EXISTS), and sets WAL + foreign_keys. The schema file is shipped alongside
 * the compiled output (copied into dist/ by the build step).
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { dbPath, ensureDataDir } from '../paths';

export type DB = Database.Database;

function readSchema(): string {
  return fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
}

/** Open (and migrate) a database. Pass ':memory:' for tests. */
export function openDatabase(file?: string): DB {
  const target = file ?? dbPath();
  if (target !== ':memory:') ensureDataDir();

  let db: DB;
  try {
    db = new Database(target);
  } catch (err) {
    throw new Error(`bsc: cannot open database at ${target}: ${(err as Error).message}`);
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readSchema());
  return db;
}

let singleton: DB | null = null;

/** Process-wide singleton handle to the default database. */
export function getDb(): DB {
  if (!singleton) singleton = openDatabase();
  return singleton;
}

export function closeDb(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
