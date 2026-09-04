import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Learning, Lesson, LessonRequest, Level } from './lesson.js';

/**
 * The lesson pool: every generated lesson, kept so the next learner who asks
 * for the same direction, level and topic gets it straight from disk instead
 * of waiting on the model. Learners still never see their own sentence twice,
 * because the page sends the sentences it has shown and those are skipped.
 *
 * Node's own SQLite keeps this to one file and no dependency. The file lives
 * on the persistent disk in production; anywhere else it is just a cache that
 * may be thrown away.
 */

/** How many lessons a direction/level/topic should hold before the pool stops topping it up. */
export const POOL_TARGET = 12;

interface Row {
  target: string;
  lesson: string;
}

/**
 * The topic as the pool files it: case, spacing and stray punctuation ignored,
 * so "Hunder", "hunder " and "hunder." share one shelf. An empty topic is a
 * shelf of its own, the everyday situations the prompt picks at random.
 */
export function topicKey(topic: string | undefined): string {
  return (topic ?? '')
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/[.,;:!?…]+$/u, '')
    .replace(/\s+/gu, ' ');
}

export class LessonPool {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS lessons (
        id INTEGER PRIMARY KEY,
        learning TEXT NOT NULL,
        level TEXT NOT NULL,
        topic TEXT NOT NULL,
        target TEXT NOT NULL,
        lesson TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE (learning, level, topic, target)
      );
      CREATE INDEX IF NOT EXISTS lessons_shelf ON lessons (learning, level, topic);
    `);
  }

  /** Everything on one shelf, oldest first. */
  private shelf(learning: Learning, level: Level, topic: string): Row[] {
    return this.db
      .prepare('SELECT target, lesson FROM lessons WHERE learning = ? AND level = ? AND topic = ? ORDER BY id')
      .all(learning, level, topic) as unknown as Row[];
  }

  /** How many lessons the shelf for this request holds. */
  count(request: LessonRequest): number {
    const row = this.db
      .prepare('SELECT count(*) AS n FROM lessons WHERE learning = ? AND level = ? AND topic = ?')
      .get(request.learning, request.level, topicKey(request.topic)) as { n: number };
    return row.n;
  }

  /** The sentences on this request's shelf, for the model to steer clear of when adding more. */
  targets(request: LessonRequest): string[] {
    return this.shelf(request.learning, request.level, topicKey(request.topic)).map((row) => row.target);
  }

  /**
   * A random lesson from the shelf that the learner has not had, or undefined
   * when the shelf is empty or they have seen it all.
   */
  pick(request: LessonRequest): Lesson | undefined {
    const seen = new Set((request.avoid ?? []).map((sentence) => sentence.trim()));
    const fresh = this.shelf(request.learning, request.level, topicKey(request.topic)).filter(
      (row) => !seen.has(row.target),
    );
    if (fresh.length === 0) return undefined;
    const row = fresh[Math.floor(Math.random() * fresh.length)]!;
    return JSON.parse(row.lesson) as Lesson;
  }

  /**
   * Shelves a lesson. One without its breakdown is not worth handing out
   * again, and a sentence already on the shelf stays as it was.
   */
  store(request: LessonRequest, lesson: Lesson): boolean {
    if (lesson.chunks.length === 0) return false;
    const result = this.db
      .prepare(
        'INSERT OR IGNORE INTO lessons (learning, level, topic, target, lesson) VALUES (?, ?, ?, ?, ?)',
      )
      .run(request.learning, request.level, topicKey(request.topic), lesson.target.trim(), JSON.stringify(lesson));
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
