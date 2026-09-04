import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Who has logged in, and what their page had in local storage the last time
 * it synced: the chest, the history and the rest, one blob per direction.
 * The page owns the shape of a blob; the server only keeps and returns it.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
}

/** The largest blob one direction may sync, in bytes of JSON. */
export const MAX_STATE_BYTES = 1_000_000;

export class UserStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        picture TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS user_state (
        user_id TEXT NOT NULL REFERENCES users (id),
        direction TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (user_id, direction)
      );
    `);
  }

  /** Records a login, updating the name and picture Google reports. */
  upsert(user: User): void {
    this.db
      .prepare(
        `INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           email = excluded.email, name = excluded.name, picture = excluded.picture,
           seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(user.id, user.email, user.name, user.picture);
  }

  get(id: string): User | undefined {
    const row = this.db.prepare('SELECT id, email, name, picture FROM users WHERE id = ?').get(id) as
      | User
      | undefined;
    // Rows come back without a prototype; a plain object is friendlier.
    return row ? { id: row.id, email: row.email, name: row.name, picture: row.picture } : undefined;
  }

  /** Every direction's blob for the user, keyed by direction. */
  state(userId: string): Record<string, unknown> {
    const rows = this.db
      .prepare('SELECT direction, state FROM user_state WHERE user_id = ?')
      .all(userId) as unknown as Array<{ direction: string; state: string }>;
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.direction] = JSON.parse(row.state);
      } catch {
        // A blob that will not parse is dropped rather than returned broken.
      }
    }
    return result;
  }

  /** Replaces one direction's blob. */
  setState(userId: string, direction: string, state: unknown): void {
    const json = JSON.stringify(state);
    if (Buffer.byteLength(json) > MAX_STATE_BYTES) {
      throw new RangeError(`State for ${direction} is larger than ${MAX_STATE_BYTES} bytes.`);
    }
    this.db
      .prepare(
        `INSERT INTO user_state (user_id, direction, state) VALUES (?, ?, ?)
         ON CONFLICT (user_id, direction) DO UPDATE SET
           state = excluded.state, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(userId, direction, json);
  }

  close(): void {
    this.db.close();
  }
}
