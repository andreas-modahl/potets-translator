import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.js';
import { downloadYoutube, youtubeAvailable, youtubeUrl, youtubeMedia } from './youtube.js';
import { fileURLToPath } from 'node:url';
import { translateSubtitlePhrase } from './subtitle-translation.js';
import { audioClip } from './subtitle-chunks.js';
import { fillSections, makeSections, sectionPhrases, type SubtitleSection } from './subtitle-sections.js';
import { recoverTranscriptGaps } from './subtitle-recovery.js';
import { subtitleStore, subtitleWriters } from './subtitle-library.js';
import { validateSaved } from './subtitle-store.js';
import { SpeechRequests } from './speech-requests.js';
import { MAX_SUBTITLE_BYTES, MAX_SUBTITLE_MS, SubtitleError, transcriptPhrases, type SubtitleCue } from './subtitles.js';

const execute = promisify(execFile);
const speechRequests = new SpeechRequests();
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
  sections: SubtitleSection[];
  revision: number;
  priorityPosition?: number;
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
      let cached: URL | undefined;
      for (const mediaOwner of subtitleStore?.mediaOwners(media) || []) {
        cached = await youtubeMedia(media, mediaOwner);
        if (cached) break;
      }
      if (cached) input = fileURLToPath(cached);
      else {
        const video = await downloadYoutube(media, job.owner, directory, ffmpeg, signal);
        input = video.file; job.title ||= video.title; job.source = video.source;
      }
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
      const result = await speechRequests.run(() => fetch(`https://${config.azureSpeechRegion}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, {
        method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': config.azureSpeechKey! }, body: form,
        signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
      }), signal);
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
    if (!subtitleStore) throw new SubtitleError('Lagring er slått av.', 503);
    job.sections = subtitleStore.sections(job.savedId || '') || makeSections(audio.length / 32);
    job.total = job.sections.length;
    job.savedId ||= subtitleStore.createPending(job.owner, job.title || job.source, job.source);
    subtitleWriters.add(job.savedId);
    const baseTitle = (job.title || job.source).replace(/ \(delvis\)$/, '').slice(0, 190);
    const persist = () => {
      job.completed = job.sections.filter(section => section.state === 'done').length;
      job.readyThrough = 0;
      for (const section of job.sections) {
        if (section.state !== 'done') break;
        job.readyThrough = section.end;
      }
      job.title = baseTitle + (job.completed < job.total ? ' (delvis)' : '');
      subtitleStore!.saveProgress(job.owner, job.savedId!, { title: job.title, source: job.source, cues: job.cues }, job.sections);
      job.revision = job.cues.length;
    };
    persist();
    const existing = [...job.cues];
    await fillSections(job.sections, signal, async section => {
      const phrases = await sectionPhrases(audio, section, async wav => {
        const initial = await transcribe(wav, true);
        const pcm = wav.subarray(44);
        return recoverTranscriptGaps(initial.phrases, pcm.length / 32, async (start, end) => {
          signal.throwIfAborted();
          return (await transcribe(audioClip(pcm, start, end), true)).phrases;
        });
      }, existing);
      const translated: SubtitleCue[] = [];
      for (const phrase of phrases) {
        signal.throwIfAborted();
        translated.push(...await translateSubtitlePhrase(phrase, signal));
      }
      signal.throwIfAborted();
      const combined = [...job.cues, ...translated].sort((a, b) => a.start - b.start);
      if (combined.length) validateSaved({ title: job.title || job.source, source: job.source, cues: combined });
      job.cues = combined;
      job.state = 'translating';
    }, persist, 3, () => job.priorityPosition || 0);
    signal.throwIfAborted();
    if (job.sections.some(section => section.state !== 'done')) {
      throw new SubtitleError('Noen deler kunne ikke oversettes. Du kan prøve de røde delene igjen.');
    }
    job.state = 'done';
  } catch (error) {
    job.state = 'error';
    job.error = signal.aborted ? 'Behandlingen ble avbrutt eller tok for lang tid.'
      : error instanceof SubtitleError ? error.message : 'Kunne ikke lage undertekstene. Prøv igjen.';
    for (const section of job.sections) {
      if (section.state === 'loading' || (section.state === 'pending' && !(error instanceof SubtitleError && error.status === 429))) {
        section.state = 'error'; section.error = job.error;
      }
    }
    if (job.savedId && job.sections.length) {
      try { subtitleStore?.saveProgress(job.owner, job.savedId, { title: job.title || job.source, source: job.source, cues: job.cues }, job.sections); }
      catch { job.saveError = 'Kunne ikke lagre fremdriften. Prøv igjen.'; }
    }
    if (!(error instanceof SubtitleError) && !signal.aborted) console.error('Subtitle generation failed:', error);
  } finally {
    if (job.savedId) subtitleWriters.delete(job.savedId);
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
  if (path === '/api/subtitles/ensure' && request.method === 'POST') {
    try {
      const buffers: Buffer[] = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4096) throw new SubtitleError('Forespørselen er for stor.', 413);
        buffers.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(buffers).toString('utf8')) as { savedId?: string; retry?: boolean; position?: number };
      if (data.position !== undefined && (!Number.isFinite(data.position) || data.position < 0 || data.position > MAX_SUBTITLE_MS)) throw new SubtitleError('Ugyldig avspillingsposisjon.', 400);
      const saved = typeof data.savedId === 'string' ? subtitleStore?.getShared(owner, data.savedId) : undefined;
      if (!saved || !youtubeUrl(saved.source)) throw new SubtitleError('Fant ikke YouTube-videoen.', 404);
      for (const [id, active] of jobs) {
        if (active.savedId === saved.id && !['done', 'error'].includes(active.state)) {
          if (data.position !== undefined) active.priorityPosition = data.position;
          send(response, 200, { id }); return;
        }
      }
      const sections = subtitleStore!.sections(saved.id);
      if (sections && !sections.some(section => section.state === 'pending' || section.state === 'loading' || (data.retry && section.state === 'error'))) {
        send(response, 200, { complete: true, sections }); return;
      }
      if (!config.azureSpeechKey || !config.azureSpeechRegion || !ffmpeg || !await youtubeAvailable()) {
        throw new SubtitleError('YouTube-import er ikke konfigurert på serveren.', 503);
      }
      // Recheck after awaiting tool availability: concurrent viewers share one run.
      for (const [id, active] of jobs) {
        if (active.savedId === saved.id && !['done', 'error'].includes(active.state)) {
          if (data.position !== undefined) active.priorityPosition = data.position;
          send(response, 200, { id }); return;
        }
      }
      if (busy) throw new SubtitleError('En annen video behandles. Prøver igjen snart.', 429);
      if (data.retry && sections) {
        for (const section of sections) if (section.state === 'error') { section.state = 'pending'; section.attempts = 0; delete section.error; }
        subtitleStore!.saveProgress(subtitleStore!.recordOwner(saved.id)!, saved.id, saved, sections);
      }
      const id = randomUUID();
      const job: Job = { owner: subtitleStore!.recordOwner(saved.id)!, source: saved.source, title: saved.title,
        savedId: saved.id, state: 'extracting', completed: 0, total: 0, cues: saved.cues, sections: sections || [], revision: 0,
        priorityPosition: data.position, controller: new AbortController(), expires: Date.now() + TTL };
      busy = true; subtitleWriters.add(saved.id); jobs.set(id, job); void run(job, saved.source);
      send(response, 202, { id });
    } catch (error) {
      send(response, error instanceof SubtitleError ? error.status : 400, { error: error instanceof SubtitleError ? error.message : 'Ugyldig forespørsel.' });
    }
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
      const job: Job = { owner, source, state: 'downloading', completed: 0, total: 0, cues: [], sections: [], revision: 0, controller: new AbortController(), expires: Date.now() + TTL };
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
  if (path.endsWith('/priority') && request.method === 'POST') {
    const job = jobs.get(path.slice('/api/subtitles/'.length, -'/priority'.length));
    if (!job) { send(response, 404, { error: 'Jobben finnes ikke lenger.' }); return; }
    try {
      const buffers: Buffer[] = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024) throw new Error('size');
        buffers.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(buffers).toString('utf8')) as { position?: unknown };
      if (typeof data.position !== 'number' || !Number.isFinite(data.position) || data.position < 0 || data.position > MAX_SUBTITLE_MS) throw new Error('position');
      job.priorityPosition = data.position;
      send(response, 200, { ok: true });
    } catch { send(response, 400, { error: 'Ugyldig avspillingsposisjon.' }); }
    return;
  }
  const id = path.slice('/api/subtitles/'.length);
  const candidate = jobs.get(id);
  const job = request.method === 'GET' || candidate?.owner === owner ? candidate : undefined;
  if (job && request.method === 'GET') {
    const since = Number(new URL(request.url!, 'http://localhost').searchParams.get('since') || 0);
    if (!Number.isSafeInteger(since) || since < 0 || since > job.cues.length) {
      send(response, 400, { error: 'Ugyldig undertekstposisjon.' }); return;
    }
    send(response, 200, { state: job.state, completed: job.completed, total: job.total,
      error: job.error, cues: job.cues, replaceCues: true, revision: job.revision, sections: job.sections, cueCount: job.cues.length, readyThrough: job.readyThrough,
      savedId: job.savedId, saveError: job.saveError, title: job.title, source: job.source,
      audioUrl: job.savedId ? `/api/subtitle-library/${job.savedId}/audio` : undefined });
  } else if (job && request.method === 'DELETE') {
    job.controller.abort(); jobs.delete(id); send(response, 200, { ok: true });
  } else send(response, 404, { error: 'Jobben finnes ikke lenger. Last opp filen på nytt.' });
}
