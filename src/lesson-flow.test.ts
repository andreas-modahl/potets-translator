import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { LEARNINGS, LEVELS, learningOf, type Lesson, type LessonRequest } from './lesson.js';
import { LessonPool, POOL_TARGET, topicKey } from './pool.js';

test('120 requests through the actual server flow replenish unseen supply without losing full exclusions', async () => {
  // Evaluate the actual handlers without importing server.ts, which starts a
  // listener. Model responses are fixtures; pool selection and orchestration
  // are real. Await background fills to represent time spent solving a card.
  const source = readFileSync('src/server.ts', 'utf8').replace(/\r\n/g, '\n');
  const parser = source.slice(source.indexOf('function parseLesson('), source.indexOf('const pool ='));
  const handlers = source.slice(source.indexOf('function topUp('), source.indexOf('/**\n * The forms of a chest word'));
  const pool = new LessonPool(':memory:');
  const asked: LessonRequest = { learning: 'tr', level: 'start' };
  const make = (target: string): Lesson => ({ learning: 'tr', target, native: target,
    chunks: [{ target, native: target, pos: 'noun' }] });
  for (let i = 0; i < 31; i++) pool.store(asked, make(`Original ${i}`));
  const jobs: Promise<unknown>[] = [];
  const generatedRequests: LessonRequest[] = [];
  let generated = 0;
  let delivered: Lesson | undefined;
  const context = {
    pool, POOL_TARGET, topicKey, LEARNINGS, LEVELS, learningOf,
    MAX_REVIEW: 5, MAX_STATE_BODY_BYTES: 2 * 1024 * 1024, TOP_UP_BATCH: 4,
    toppingUp: new Set(), config: { maxInputChars: 2000 }, BadRequest: Error, console,
    readBody: async (body: string) => body,
    send: (_response: unknown, status: number, result: Lesson) => { assert.equal(status, 200); delivered = result; },
    limiter: { run: (fn: () => Promise<unknown>) => { const job = Promise.resolve().then(fn); jobs.push(job); return job; } },
    lesson: async () => make(`Generated ${generated++}`),
    lessons: async (request: LessonRequest, count: number) => {
      generatedRequests.push(request);
      return Array.from({ length: count }, () => make(`Generated ${generated++}`));
    },
  };
  const handle = runInNewContext(stripTypeScriptTypes(`${parser}\n${handlers}\nhandleLesson;`), context);
  const avoid: string[] = [];
  try {
    for (let turn = 0; turn < 120; turn++) {
      await handle(JSON.stringify({ ...asked, avoid }), {});
      await Promise.all(jobs);
      assert(delivered);
      assert(!avoid.includes(delivered.target), `repeat at turn ${turn + 1}`);
      avoid.push(delivered.target);
    }
    assert.equal(new Set(avoid).size, 120);
    assert(generatedRequests.some(request => (request.avoid?.length ?? 0) > 100));
    assert(pool.available({ ...asked, avoid }) >= POOL_TARGET, 'keeps unseen sentences ready even on a large shelf');
  } finally { pool.close(); }
});
