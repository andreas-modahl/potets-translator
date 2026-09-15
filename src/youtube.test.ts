import assert from 'node:assert/strict';
import { test } from 'node:test';
import { youtubeUrl, youtubeMedia, validateYoutubeMetadata } from './youtube.js';

test('YouTube watch, short, mobile and Shorts links become a single video URL', () => {
  for (const url of ['https://youtu.be/rEJb7j61-es?t=5', 'https://www.youtube.com/watch?v=rEJb7j61-es&list=ignored',
    'https://m.youtube.com/watch?v=rEJb7j61-es', 'https://youtube.com/shorts/rEJb7j61-es', 'https://www.youtube.com/embed/rEJb7j61-es']) {
    assert.equal(youtubeUrl(url), 'https://www.youtube.com/watch?v=rEJb7j61-es');
  }
});
test('YouTube import rejects non-video URLs and arbitrary network destinations', async () => {
  for (const url of [null, 'file:///etc/passwd', 'http://127.0.0.1/', 'https://youtube.com.evil.test/watch?v=rEJb7j61-es',
    'https://youtube.com@evil.test/watch?v=rEJb7j61-es', 'https://user:pass@youtube.com/watch?v=rEJb7j61-es',
    'https://youtube.com:444/watch?v=rEJb7j61-es', 'https://youtube.com/playlist?list=abc', 'https://youtu.be/../secret',
    'https://youtube.com/watch?v=short', 'https://youtu.be/rEJb7j61-es/extra', 'x'.repeat(2049)]) assert.equal(youtubeUrl(url), undefined);
  assert.equal(await youtubeMedia('../.env', 'test'), undefined);
  assert.equal(await youtubeMedia('https://youtu.be/rEJb7j61-es', 'unknown-test-owner'), undefined);
});
test('YouTube duration must be known, finite, positive, at most thirty minutes, and not live', () => {
  validateYoutubeMetadata({ duration: 1800, is_live: false });
  for (const metadata of [{}, { duration: NaN }, { duration: Infinity }, { duration: '79' }, { duration: 0 },
    { duration: -1 }, { duration: 1801 }, { duration: 79, is_live: true }]) assert.throws(() => validateYoutubeMetadata(metadata));
});
