import assert from 'node:assert/strict';
import { test } from 'node:test';
import { youtubeUrl, youtubeMedia, validateYoutubeMetadata, youtubeDownloadFormat } from './youtube.js';

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
test('YouTube duration must be known, finite, positive, at most two hours, and not live', () => {
  validateYoutubeMetadata({ duration: 7200, is_live: false });
  for (const metadata of [{}, { duration: NaN }, { duration: Infinity }, { duration: '79' }, { duration: 0 },
    { duration: -1 }, { duration: 7201 }, { duration: 79, is_live: true }]) assert.throws(() => validateYoutubeMetadata(metadata));
});

test('choose a smaller rendition when merged video and audio exceed the size limit', () => {
  const formats = [
    { format_id: '140', ext: 'm4a', vcodec: 'none', filesize: 40 * 1024 * 1024 },
    { format_id: '135', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 480, filesize: 250 * 1024 * 1024 },
    { format_id: '136', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 720, filesize: 480 * 1024 * 1024 },
  ];
  assert.equal(youtubeDownloadFormat({ duration: 2657, formats }), '135+140');
  formats[2]!.filesize = 400 * 1024 * 1024;
  assert.equal(youtubeDownloadFormat({ duration: 2657, formats }), '136+140');
});

test('estimate format size from bitrate and reject videos without a fitting rendition', () => {
  const format = { format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360, tbr: 1000 };
  assert.equal(youtubeDownloadFormat({ duration: 2657, formats: [format] }), '18');
  assert.throws(() => youtubeDownloadFormat({ duration: 7200, formats: [format] }), /500 MB/);
});
