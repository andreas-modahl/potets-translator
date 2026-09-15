import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillSections, makeSections, nextSection, sectionPhrases, sectionClipPhrases } from './subtitle-sections.js';
import { SubtitleStore } from './subtitle-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubtitleError } from './subtitles.js';

test('downloaded sections restore the video clock and exclude overlapping context', async () => {
  const section = makeSections(180000)[1]!;
  const phrases = await sectionClipPhrases(Buffer.alloc(44), 59000, section, async () => [{
    text: 'before inside', words: [{ text: 'before', start: 0, end: 500 }, { text: 'inside', start: 1500, end: 2000 }],
  }], []);
  assert.deepEqual(phrases, [{ text: 'inside', words: [{ text: 'inside', start: 60500, end: 61000 }] }]);
});

test('prioritize the viewed section, then following sections, then earlier gaps', () => {
  const sections = makeSections(300000);
  const order = [];
  for (let count = 0; count < sections.length; count++) {
    const section = nextSection(sections, 125000)!;
    order.push(section.start); section.state = 'done';
  }
  assert.deepEqual(order, [120000, 180000, 240000, 0, 60000]);
  assert.equal(nextSection(sections, 125000), undefined);
  assert.equal(nextSection(makeSections(300000), 300000)?.start, 240000);
});

test('seeking changes the next scheduled work without interrupting an active section', async () => {
  const sections = makeSections(300000);
  const order: number[] = [];
  let position = 60000;
  await fillSections(sections, new AbortController().signal, async section => {
    order.push(section.start);
    if (order.length === 1) position = 240000;
  }, () => {}, 1, () => position);
  assert.deepEqual(order, [60000, 240000, 0, 120000, 180000]);
});

test('provider throttling stops scheduling later sections without using their retry budgets', async () => {
  const sections = makeSections(600000);
  await assert.rejects(fillSections(sections, new AbortController().signal, async () => {
    throw new SubtitleError('throttled', 429);
  }, () => {}), /throttled/);
  assert.equal(sections.filter(section => section.state === 'error').length, 3);
  assert.ok(sections.slice(3).every(section => section.state === 'pending' && section.attempts === 0));
});

test('three workers finish out of order without repeating completed or silent sections', async () => {
  const sections = makeSections(240000);
  sections[0]!.state = 'done';
  let active = 0, peak = 0;
  const finished: number[] = [];
  await fillSections(sections, new AbortController().signal, async section => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, section.start === 60000 ? 30 : 1));
    finished.push(section.start); active--;
  }, () => {});
  assert.equal(peak, 3);
  assert.notEqual(finished[0], 60000);
  assert.deepEqual([...finished].sort((a, b) => a - b), [60000, 120000, 180000]);
  assert.ok(sections.every(section => section.state === 'done'));
  await fillSections(sections, new AbortController().signal, async () => assert.fail('silence must not be retried'), () => {});
});

test('retry limits survive restarts and one failed section does not stop its neighbors', async () => {
  const sections = makeSections(120000);
  sections[0]!.state = 'loading'; sections[0]!.attempts = 2;
  await fillSections(sections, new AbortController().signal, async section => {
    if (section.start === 0) throw new Error('provider unavailable');
  }, () => {});
  assert.equal(sections[0]!.state, 'error');
  assert.equal(sections[0]!.attempts, 3);
  assert.equal(sections[0]!.error, 'provider unavailable');
  assert.equal(sections[1]!.state, 'done');
  await fillSections(sections, new AbortController().signal, async () => assert.fail('exhausted retries'), () => {});
});

test('cancellation waits for in-flight sections before releasing resources', async () => {
  const controller = new AbortController();
  const sections = makeSections(180000);
  let settled = 0;
  await fillSections(sections, controller.signal, async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort(); settled++;
  }, () => {});
  assert.equal(settled, 3);
  assert.ok(sections.every(section => section.state === 'error'));
});

test('section boundaries keep whole words in one section and preserve existing translations', async () => {
  const pcm = Buffer.alloc(120000 * 32);
  const sections = makeSections(120000);
  const first = await sectionPhrases(pcm, sections[0]!, async () => [{ text: 'bir iki', words: [
    { text: 'bir', start: 59400, end: 60200 }, { text: 'iki', start: 60300, end: 60800 },
  ] }], []);
  const second = await sectionPhrases(pcm, sections[1]!, async () => [{ text: 'bir iki', words: [
    { text: 'bir', start: 400, end: 1200 }, { text: 'iki', start: 1300, end: 1800 },
  ] }], []);
  assert.equal(first[0]!.words[0]!.end, 60000);
  assert.equal(first[0]!.text, 'bir');
  assert.equal(second[0]!.text, 'iki');
  const existing = { start: 60300, end: 60800, text: 'edited', turkish: 'iki', words: [], chunks: [] };
  assert.deepEqual(await sectionPhrases(pcm, sections[1]!, async () => [{ text: 'iki', words: [{ text: 'iki', start: 1300, end: 1800 }] }], [existing]), []);
});

test('silent section completion and empty pending saves survive a database restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'subtitle-sections-'));
  const path = join(directory, 'test.db');
  let store = new SubtitleStore(path);
  try {
    const source = 'https://www.youtube.com/watch?v=zo_YJpzSyh0';
    const id = store.createPending('alice', 'Video', source);
    const sections = makeSections(120000);
    sections[0]!.state = 'done'; sections[1]!.state = 'loading'; sections[1]!.attempts = 1;
    store.saveProgress('alice', id, { title: 'Video (delvis)', source, cues: [] }, sections);
    store.close(); store = new SubtitleStore(path);
    assert.deepEqual(store.sections(id), sections);
    assert.deepEqual(store.get('alice', id)?.cues, []);
    assert.equal(store.recordOwner(id), 'alice');
    assert.throws(() => store.saveProgress('bob', id, { title: 'Changed', source, cues: [] }, []));
    assert.equal(store.get('alice', id)?.title, 'Video (delvis)');
    assert.deepEqual(store.sections(id), sections);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
