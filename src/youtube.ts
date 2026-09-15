import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { MAX_SUBTITLE_MS, SubtitleError } from './subtitles.js';

const execute = promisify(execFile);
const binary = process.env.YTDLP_PATH || (process.platform === 'win32' ? resolve('data/tools/ytdlp/Scripts/yt-dlp.exe') : 'yt-dlp');
const directory = resolve(process.env.YOUTUBE_MEDIA_DIR || 'data/youtube');
export function youtubeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    let id: string | null | undefined;
    if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else id = /^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
    }
    if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  } catch { /* Reject malformed URLs before running an extractor. */ }
}
function mediaPath(url: string, owner: string) {
  return join(directory, createHash('sha256').update(owner + '\0' + url).digest('hex') + '.mp4');
}
export async function youtubeMedia(source: string, owner: string): Promise<URL | undefined> {
  const url = youtubeUrl(source);
  if (!url) return;
  const file = mediaPath(url, owner);
  try { if ((await stat(file)).isFile()) return pathToFileURL(file); } catch {}
}
export async function youtubeAvailable(): Promise<boolean> {
  try { await execute(binary, ['--version'], { windowsHide: true, timeout: 5000 }); return true; } catch { return false; }
}
export function validateYoutubeMetadata(metadata: { duration?: unknown; is_live?: unknown }) {
  if (typeof metadata?.duration !== 'number' || !Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > MAX_SUBTITLE_MS / 1000 || metadata.is_live) {
    throw new SubtitleError('Velg en video på høyst 2 timer, ikke en direktesending.', 400);
  }
}
export interface YoutubeAudio { source: string; title: string; duration: number; audioUrl: string }
export async function youtubeAudio(source: string, signal: AbortSignal): Promise<YoutubeAudio> {
  const canonical = youtubeUrl(source);
  if (!canonical) throw new SubtitleError('Ugyldig YouTube-lenke.', 400);
  try {
    const result = await execute(binary, ['--ignore-config', '--no-playlist', '--no-warnings', '--no-plugin-dirs',
      '--js-runtimes', `node:${process.execPath}`, '--socket-timeout', '20', '--retries', '1',
      '--skip-download', '-f', 'bestaudio[ext=m4a]/bestaudio', '--dump-single-json', '--', canonical],
    { signal, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    const metadata = JSON.parse(result.stdout);
    validateYoutubeMetadata(metadata);
    const url = new URL(metadata.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com') || url.username || url.password) {
      throw new SubtitleError('YouTube ga en ukjent lydkilde.', 502);
    }
    return { source: canonical, title: String(metadata.title || 'YouTube-video').slice(0, 200),
      duration: metadata.duration * 1000, audioUrl: url.href };
  } catch (error) {
    if (error instanceof SubtitleError || signal.aborted) throw error;
    throw new SubtitleError('Kunne ikke hente lydinformasjon fra YouTube. Prøv igjen senere.', 502);
  }
}

/** Input seeking lets FFmpeg request only the audio range needed for this section. */
export async function youtubeAudioSection(audio: YoutubeAudio, start: number, end: number,
  ffmpeg: string, signal: AbortSignal): Promise<Buffer> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > audio.duration || end <= start || end - start > 62000) {
    throw new SubtitleError('Ugyldig lyddel.', 400);
  }
  try {
    const result = await execute(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error',
      '-rw_timeout', '20000000', '-protocol_whitelist', 'https,http,tcp,tls,crypto',
      '-ss', String(start / 1000), '-i', audio.audioUrl, '-t', String((end - start) / 1000),
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'],
    { signal, windowsHide: true, timeout: 120000, encoding: 'buffer', maxBuffer: 3 * 1024 * 1024 });
    const expected = Math.round((end - start) * 32);
    if (!result.stdout.length || result.stdout.length < expected - 3200) throw new Error('Incomplete audio section');
    return result.stdout.subarray(0, expected);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new SubtitleError('Kunne ikke hente denne lyddelen fra YouTube. Prøv delen igjen.', 502);
  }
}
