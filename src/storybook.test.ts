import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storybook, storyMedia, findStory } from './storybook.js';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

test('bundled stories are validated public records with matching audio and legacy links', async () => {
  const stories = await storybook();
  assert.ok(stories.length >= 6);
  for (const story of stories) {
    assert.equal(story.shared, true);
    assert.ok(story.cues.length);
    assert.ok(await storyMedia(story.source));
    assert.equal(findStory(stories, story.id), story);
    assert.equal(findStory(stories, story.id.replace('storybook-', 'example-')), story);
  }
  assert.equal(await storyMedia('../.env'), undefined);
  assert.equal(await storyMedia('%2e%2e%2fsecret.mp3'), undefined);
  assert.equal(await storyMedia('missing-story.mp3'), undefined);
});

test('shared stories and ranged media work for guests and accounts; edits remain private', async () => {
  process.env.LESSON_DB = ':memory:';
  const { handleSubtitleLibrary, subtitleStore } = await import('./subtitle-library.js');
  async function call(owner: string, path: string, method = 'GET', data?: unknown, headers = {}) {
    const request = Object.assign(Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []), { method, headers: { host: 'localhost', ...headers } });
    let status = 0;
    let body: Buffer | string = '';
    const response = { writeHead(code: number) { status = code; }, end(value: Buffer | string) { body = value; } };
    await handleSubtitleLibrary(request as IncomingMessage, response as unknown as ServerResponse, path, owner);
    return { status, body, json: () => JSON.parse(String(body)) };
  }
  try {
    const listing = (await call('browser:alice', '/api/subtitle-library')).json();
    const id = listing.items[0].id;
    const story = (await call('browser:alice', '/api/subtitle-library/' + id)).json();
    assert.deepEqual((await call('user:bob', '/api/subtitle-library/' + id)).json().cues, story.cues);
    const audio = await call('user:bob', story.audioUrl, 'GET', undefined, { range: 'bytes=0-99' });
    assert.equal(audio.status, 206);
    assert.equal(audio.body.length, 100);
    assert.equal((await call('browser:alice', '/api/subtitle-library/' + id, 'PUT', story)).status, 403);
    const copy = (await call('browser:alice', '/api/subtitle-library', 'POST', { ...story, title: 'My copy' })).json();
    assert.equal((await call('user:bob', '/api/subtitle-library/' + copy.id)).status, 404);
    assert.equal((await call('browser:alice', '/api/subtitle-library/' + copy.id)).json().title, 'My copy');
    assert.equal((await call('user:bob', '/api/subtitle-library/' + id)).json().title, story.title);
  } finally { subtitleStore?.close(); }
});
