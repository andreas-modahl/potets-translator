import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.js';
import { downloadYoutube, youtubeAvailable, youtubeUrl } from './youtube.js';
import { translateSubtitlePhrase } from './subtitle-translation.js';
import { audioClip, subtitleChunks, SUBTITLE_CHUNK_MS } from './subtitle-chunks.js';
import { recoverTranscriptGaps } from './subtitle-recovery.js';
import { subtitleStore } from './subtitle-library.js';
import { MAX_SUBTITLE_BYTES, MAX_SUBTITLE_MS, SubtitleError, transcriptPhrases, type SubtitleCue } from './subtitles.js';

const execute = promisify(execFile);
const ffmpeg: string | null = process.env.FFMPEG_PATH || createRequire(import.meta.url)('ffmpeg-static');
const jobs = new Map<string, Job>();
let busy = false;
const TTL = 60 * 60 * 1000;
interface Job {
  owner: string;
  source: string;
  title?: string;
  savedId?: string;
  saveError?: string;
  state: 'downloading' | 'extracting' | 'transcribing' | 'translating' | 'done' | 'error';
  completed: number;
  total: number;
  cues: SubtitleCue[];
  readyThrough?: number;
  error?: string;
  controller: AbortController;
  expires: number;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function sweep(): void {
  for (const [id, job] of jobs) if (job.expires < Date.now()) {
    job.controller.abort();
    jobs.delete(id);
  }
}
setInterval(sweep, 60_000).unref();

async function run(job: Job, media: Buffer | string): Promise<void> {
  let directory: string | undefined;
  const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(60 * 60_000)]);
  try {
    directory = await mkdtemp(join(tmpdir(), 'languageballs-subtitles-'));
    let input = join(directory, 'upload');
    const output = join(directory, 'audio.pcm');
    if (!ffmpeg) throw new SubtitleError('Videobehandling er ikke tilgjengelig på serveren.', 503);
    if (typeof media === 'string') {
      job.state = 'downloading';
      const video = await downloadYoutube(media, job.owner, directory, ffmpeg, signal);
      input = video.file; job.title = video.title; job.source = video.source;
      job.state = 'extracting';
    } else await writeFile(input, media);
    try {
      await execute(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,wav,mp3,flac,ogg,aac,avi',
        '-i', input, '-map', '0:a:0', '-vn',
        '-t', String(MAX_SUBTITLE_MS / 1000 + 1), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', output],
      { signal, timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024 });
    } catch {
      throw new SubtitleError('Kunne ikke lese lydsporet. Prøv en MP4-, WebM-, MP3- eller WAV-fil.');
    }
    const audio = await readFile(output);
    // PCM is 16,000 samples/sec, two bytes/sample. Reject overlong media before a paid call.
    if (audio.length > MAX_SUBTITLE_MS / 1000 * 32000) {
      throw new SubtitleError('Opptaket må være på høyst 30 minutter.');
    }
    signal.throwIfAborted();
    job.state = 'transcribing';
    const transcribe = async (audio: Buffer, allowEmpty = false) => {
      const form = new FormData();
      form.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'audio.wav');
      form.append('definition', JSON.stringify({ locales: ['tr-TR'], profanityFilterMode: 'None' }));
      const result = await fetch(`https://${config.azureSpeechRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, {
        method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': config.azureSpeechKey! }, body: form,
        signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
      });
      if (!result.ok) {
        await result.body?.cancel();
        throw new SubtitleError(result.status === 401 || result.status === 403
          ? 'Azure Speech avviste tilgangen. Kontroller nøkkel, region og støtte for rask transkripsjon.'
          : `Talegjenkjenningen feilet (${result.status}). Prøv igjen senere.`, 502);
      }
      const raw = await result.json() as { durationMilliseconds: number; phrases?: unknown[] };
      return { duration: raw.durationMilliseconds,
        phrases: allowEmpty && Array.isArray(raw.phrases) && !raw.phrases.length ? [] : transcriptPhrases(raw) };
    };
    job.total = Math.ceil(audio.length / 32 / SUBTITLE_CHUNK_MS);
    for await (const chunk of subtitleChunks(audio, async wav => {
      job.state = 'transcribing';
      const initial = await transcribe(wav, true);
      const pcm = wav.subarray(44);
      return recoverTranscriptGaps(initial.phrases, pcm.length / 32, async (start, end) => {
        signal.throwIfAborted();
        return (await transcribe(audioClip(pcm, start, end), true)).phrases;
      });
    })) {
      job.state = 'translating';
      const translated: SubtitleCue[] = [];
      for (const phrase of chunk.phrases) {
        signal.throwIfAborted();
        translated.push(...await translateSubtitlePhrase(phrase, signal));
      }
      job.cues.push(...translated);
      job.readyThrough = chunk.end;
      job.completed += 1;
      if (subtitleStore && job.cues.length) {
        try {
          const title = (job.title || job.source).slice(0, 190) + (chunk.end < chunk.duration ? ' (delvis)' : '');
          job.savedId = subtitleStore.save(job.owner, { title, source: job.source, cues: job.cues }, job.savedId).id;
        }
        catch { job.saveError = 'Automatisk lagring feilet. Bruk Lagre-knappen for å prøve igjen.'; }
      }
    }
    if (!job.cues.length) throw new SubtitleError('Fant ingen tale i opptaket.');
    job.state = 'done';
  } catch (error) {
    job.state = 'error';
    job.error = signal.aborted ? 'Behandlingen ble avbrutt eller tok for lang tid.'
      : error instanceof SubtitleError ? error.message : 'Kunne ikke lage undertekstene. Prøv igjen.';
    if (!(error instanceof SubtitleError) && !signal.aborted) console.error('Subtitle generation failed:', error);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    job.expires = Date.now() + TTL;
    busy = false;
  }
}

/** A random job ID is the access token. Media is temporary; results expire after an hour. */
export async function handleSubtitles(request: IncomingMessage, response: ServerResponse, path: string, owner: string): Promise<void> {
  sweep();
  if (request.method === 'POST' && request.headers.origin) {
    let sameOrigin = false;
    try { sameOrigin = new URL(request.headers.origin).host === request.headers.host; } catch {}
    if (!sameOrigin) { send(response, 403, { error: 'Start importen fra undertekstsiden.' }); return; }
  }
  if (path === '/api/subtitles' && request.method === 'GET') {
    send(response, 200, { configured: Boolean(config.azureSpeechKey && config.azureSpeechRegion && ffmpeg),
      youtube: await youtubeAvailable(), maxBytes: MAX_SUBTITLE_BYTES, maxSeconds: MAX_SUBTITLE_MS / 1000, storage: Boolean(subtitleStore) });
    return;
  }
  if (path === '/api/subtitles/youtube' && request.method === 'POST') {
    if (!config.azureSpeechKey || !config.azureSpeechRegion || !ffmpeg || !subtitleStore || !await youtubeAvailable()) {
      send(response, 503, { error: 'YouTube-import er ikke konfigurert på serveren.' }); return;
    }
    if (busy) { send(response, 429, { error: 'En fil behandles allerede. Prøv igjen om litt.' }); return; }
    busy = true;
    try {
      const parts: Buffer[] = []; let size = 0;
      for await (const part of request) {
        size += part.length;
        if (size > 4096) throw new SubtitleError('Lenken er for lang.', 413);
        parts.push(part);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new SubtitleError('Ugyldig YouTube-lenke.', 400); }
      const source = youtubeUrl(data?.url);
      if (!source) throw new SubtitleError('Lim inn en gyldig YouTube-lenke.', 400);
      while (jobs.size >= 10) jobs.delete(jobs.keys().next().value!);
      const id = randomUUID();
      const job: Job = { owner, source, state: 'downloading', completed: 0, total: 0, cues: [], controller: new AbortController(), expires: Date.now() + TTL };
      jobs.set(id, job); void run(job, source); send(response, 202, { id });
    } catch (error) {
      busy = false;
      send(response, error instanceof SubtitleError ? error.status : 400, { error: error instanceof SubtitleError ? error.message : 'Kunne ikke lese lenken.' });
    }
    return;
  }
  if (path === '/api/subtitles' && request.method === 'POST') {
    send(response, 400, { error: 'Bruk en YouTube-lenke for å legge til en video.' }); return;
  }
  const id = path.slice('/api/subtitles/'.length);
  const candidate = jobs.get(id);
  const job = candidate?.owner === owner ? candidate : undefined;
  if (job && request.method === 'GET') {
    const since = Number(new URL(request.url!, 'http://localhost').searchParams.get('since') || 0);
    if (!Number.isSafeInteger(since) || since < 0 || since > job.cues.length) {
      send(response, 400, { error: 'Ugyldig undertekstposisjon.' }); return;
    }
    send(response, 200, { state: job.state, completed: job.completed, total: job.total,
      error: job.error, cues: job.cues.slice(since), cueCount: job.cues.length, readyThrough: job.readyThrough,
      savedId: job.savedId, saveError: job.saveError, title: job.title, source: job.source,
      audioUrl: job.savedId ? `/api/subtitle-library/${job.savedId}/audio` : undefined });
  } else if (job && request.method === 'DELETE') {
    job.controller.abort(); jobs.delete(id); send(response, 200, { ok: true });
  } else send(response, 404, { error: 'Jobben finnes ikke lenger. Last opp filen på nytt.' });
}
