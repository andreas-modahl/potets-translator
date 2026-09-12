import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.js';
import { lesson } from './lesson.js';
import { MAX_SUBTITLE_BYTES, MAX_SUBTITLE_MS, phraseCues, SubtitleError, transcriptPhrases, type SubtitleCue } from './subtitles.js';

const execute = promisify(execFile);
const ffmpeg: string | null = process.env.FFMPEG_PATH || createRequire(import.meta.url)('ffmpeg-static');
const jobs = new Map<string, Job>();
let busy = false;
const TTL = 60 * 60 * 1000;
interface Job {
  state: 'extracting' | 'transcribing' | 'translating' | 'done' | 'error';
  completed: number;
  total: number;
  cues: SubtitleCue[];
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

async function run(job: Job, media: Buffer): Promise<void> {
  let directory: string | undefined;
  const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(20 * 60_000)]);
  try {
    directory = await mkdtemp(join(tmpdir(), 'languageballs-subtitles-'));
    const input = join(directory, 'upload');
    const output = join(directory, 'audio.wav');
    await writeFile(input, media);
    if (!ffmpeg) throw new SubtitleError('Videobehandling er ikke tilgjengelig på serveren.', 503);
    try {
      await execute(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,wav,mp3,flac,ogg,aac,avi',
        '-i', input, '-map', '0:a:0', '-vn',
        '-t', '601', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output],
      { signal, timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024 });
    } catch {
      throw new SubtitleError('Kunne ikke lese lydsporet. Prøv en MP4-, WebM-, MP3- eller WAV-fil.');
    }
    const audio = await readFile(output);
    // PCM is 16,000 samples/sec, two bytes/sample. Reject overlong media before a paid call.
    if (audio.length > MAX_SUBTITLE_MS / 1000 * 32000 + 1024) {
      throw new SubtitleError('Opptaket må være på høyst 10 minutter.');
    }
    signal.throwIfAborted();
    job.state = 'transcribing';
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
    const phrases = transcriptPhrases(await result.json());
    job.state = 'translating';
    job.total = phrases.length;
    for (const phrase of phrases) {
      signal.throwIfAborted();
      const translated = await lesson({ learning: 'tr', level: 'avansert', text: phrase.text, signal });
      job.cues.push(...phraseCues(phrase, translated));
      job.completed += 1;
    }
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
export async function handleSubtitles(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  sweep();
  if (path === '/api/subtitles' && request.method === 'GET') {
    send(response, 200, { configured: Boolean(config.azureSpeechKey && config.azureSpeechRegion && ffmpeg),
      maxBytes: MAX_SUBTITLE_BYTES, maxSeconds: MAX_SUBTITLE_MS / 1000 });
    return;
  }
  if (path === '/api/subtitles' && request.method === 'POST') {
    if (!config.azureSpeechKey || !config.azureSpeechRegion || !ffmpeg) {
      send(response, 503, { error: 'Undertekster krever Azure Speech på serveren.' }); return;
    }
    if (busy) { send(response, 429, { error: 'En fil behandles allerede. Prøv igjen om litt.' }); return; }
    if (request.headers['content-type'] !== 'application/octet-stream') {
      send(response, 415, { error: 'Last opp en lyd- eller videofil.' }); return;
    }
    if (Number(request.headers['content-length']) > MAX_SUBTITLE_BYTES) {
      send(response, 413, { error: 'Filen er for stor. Grensen er 100 MB.' }); return;
    }
    busy = true;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_SUBTITLE_BYTES) throw new SubtitleError('Filen er for stor. Grensen er 100 MB.', 413);
        chunks.push(chunk);
      }
      if (!size) throw new SubtitleError('Filen er tom.', 400);
      // Bound retained results even if many tiny files are processed in an hour.
      while (jobs.size >= 10) jobs.delete(jobs.keys().next().value!);
      const id = randomUUID();
      const job: Job = { state: 'extracting', completed: 0, total: 0, cues: [], controller: new AbortController(), expires: Date.now() + TTL };
      jobs.set(id, job);
      void run(job, Buffer.concat(chunks));
      send(response, 202, { id });
    } catch (error) {
      busy = false;
      if (error instanceof SubtitleError) send(response, error.status, { error: error.message });
      else if (!response.destroyed) send(response, 400, { error: 'Opplastingen ble avbrutt.' });
    }
    return;
  }
  const id = path.slice('/api/subtitles/'.length);
  const job = jobs.get(id);
  if (job && request.method === 'GET') {
    send(response, 200, { state: job.state, completed: job.completed, total: job.total,
      error: job.error, ...(job.state === 'done' ? { cues: job.cues } : {}) });
  } else if (job && request.method === 'DELETE') {
    job.controller.abort(); jobs.delete(id); send(response, 200, { ok: true });
  } else send(response, 404, { error: 'Jobben finnes ikke lenger. Last opp filen på nytt.' });
}
