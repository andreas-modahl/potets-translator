import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { MAX_SUBTITLE_BYTES, MAX_SUBTITLE_MS, SubtitleError } from './subtitles.js';

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
    throw new SubtitleError('Velg en video på høyst 30 minutter, ikke en direktesending.', 400);
  }
}
export async function downloadYoutube(url: string, owner: string, temporary: string, ffmpeg: string, signal: AbortSignal) {
  const canonical = youtubeUrl(url);
  if (!canonical) throw new SubtitleError('Lim inn en gyldig YouTube-lenke.', 400);
  const final = mediaPath(canonical, owner);
  try {
    await access(final);
    const metadata = JSON.parse(await readFile(final + '.json', 'utf8'));
    return { file: final, title: String(metadata.title).slice(0, 200), source: canonical };
  } catch { /* Fetch clips that are not cached for this owner. */ }
  const args = ['--ignore-config', '--no-playlist', '--no-progress', '--no-warnings', '--no-plugin-dirs',
    '--js-runtimes', `node:${process.execPath}`, '--socket-timeout', '20', '--retries', '1', '--fragment-retries', '1'];
  try {
    const result = await execute(binary, [...args, '--skip-download', '--dump-single-json', '--', canonical],
      { signal, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    const metadata = JSON.parse(result.stdout);
    validateYoutubeMetadata(metadata);
    const output = join(temporary, 'youtube.mp4');
    await execute(binary, [...args, '--ffmpeg-location', ffmpeg, '--max-filesize', String(MAX_SUBTITLE_BYTES),
      '--match-filters', `duration <= ${MAX_SUBTITLE_MS / 1000} & !is_live`, '--abort-on-unavailable-fragments',
      '-f', 'bv*[height<=720][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][ext=mp4]',
      '--merge-output-format', 'mp4', '-o', output, '--', canonical],
      { signal, windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024 });
    if ((await stat(output)).size > MAX_SUBTITLE_BYTES) throw new SubtitleError('Videoen er for stor. Grensen er 500 MB.', 413);
    signal.throwIfAborted();
    await mkdir(directory, { recursive: true });
    // The media directory may be a mounted volume on a different filesystem.
    await copyFile(output, final + '.tmp');
    await rename(final + '.tmp', final);
    const title = String(metadata.title || 'YouTube-video').slice(0, 200);
    await writeFile(final + '.json', JSON.stringify({ title, source: canonical }));
    return { file: final, title, source: canonical };
  } catch (error) {
    await rm(final + '.tmp', { force: true }).catch(() => {});
    if (error instanceof SubtitleError || signal.aborted) throw error;
    throw new SubtitleError('Kunne ikke hente YouTube-videoen. Den kan være utilgjengelig, kreve innlogging eller være blokkert av YouTube. Prøv en annen lenke.', 502);
  }
}
