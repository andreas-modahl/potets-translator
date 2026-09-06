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

/** Text with case, dotted/dotless i and accents flattened, for loose matching. */
function fold(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/ı/gu, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '');
}

/**
 * Enough of a word to recognise it inflected: Turkish softens a final
 * consonant (köpek → köpeğim) and Norwegian adds endings, so the last letter
 * of anything longer than four is let go.
 */
export function stem(word: string): string {
  const folded = fold(word.trim());
  return folded.length > 4 ? folded.slice(0, -1) : folded;
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
      CREATE TABLE IF NOT EXISTS extras (
        kind TEXT NOT NULL,
        learning TEXT NOT NULL,
        key TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (kind, learning, key)
      );
    `);
  }

  /**
   * Something else the model was asked once and that never changes, such as
   * the forms of a word, filed by kind and key. Missing is undefined.
   */
  extra(kind: string, learning: Learning, key: string): string | undefined {
    const row = this.db
      .prepare('SELECT body FROM extras WHERE kind = ? AND learning = ? AND key = ?')
      .get(kind, learning, key) as { body: string } | undefined;
    return row?.body;
  }

  keep(kind: string, learning: Learning, key: string, body: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO extras (kind, learning, key, body) VALUES (?, ?, ?, ?)')
      .run(kind, learning, key, body);
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
   *
   * When the learner has words to meet again, only a lesson that brings one
   * of them back will do; with none on the shelf the caller asks the model,
   * and that sentence joins the shelf for the next learner with the word.
   */
  pick(request: LessonRequest): Lesson | undefined {
    const seen = new Set((request.avoid ?? []).map((sentence) => sentence.trim()));
    let fresh = this.shelf(request.learning, request.level, topicKey(request.topic)).filter(
      (row) => !seen.has(row.target),
    );
    if (request.review?.length) {
      const stems = request.review.map(stem).filter(Boolean);
      fresh = fresh.filter((row) => {
        const sentence = fold(row.target);
        return stems.some((piece) => sentence.includes(piece));
      });
    }
    if (fresh.length === 0) return undefined;
    const row = fresh[Math.floor(Math.random() * fresh.length)]!;
    const lesson = JSON.parse(row.lesson) as Lesson;
    // A lesson shelved before word classes were asked for is short of what
    // the page shows now; it leaves the shelf, and the caller asks afresh.
    if (lesson.chunks.some((chunk) => !chunk.pos)) {
      this.db.prepare('DELETE FROM lessons WHERE target = ? AND learning = ?').run(row.target, request.learning);
      return undefined;
    }
    return lesson;
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
