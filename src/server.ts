import { execFileSync } from 'node:child_process';
import { readFileSync, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { assertTranslatorConfigured, config, type ExplainMode } from './config.js';
import { parseTargets } from './languages.js';
import { LEARNINGS, LEVELS, lesson, type Learning, type Lesson, type LessonRequest, type Level } from './lesson.js';
import { Limiter } from './limiter.js';
import { LessonPool, POOL_TARGET, topicKey } from './pool.js';
import { speak, speechConfigured, speechFingerprint, SpeechUnavailable } from './speech.js';
import { translate } from './translate.js';

interface Asset {
  file: string;
  type: string;
}

const HTML = 'text/html; charset=utf-8';

/**
 * The files the site is made of, keyed by the path each is served at.
 *
 * An explicit list rather than a directory served wholesale: it is a handful of
 * files, and nothing can be reached that was not deliberately put here. The URL
 * resolves against `public/` from either `src/` under tsx or `dist/` after a
 * build, since both sit one level below the repository root.
 */
const ASSETS = new Map<string, Asset>(
  (
    [
      // The learn page is the front page; the translator moved to /translate.
      // /learn stays so old links and bookmarks keep working.
      ['/', 'learn.html', HTML],
      ['/learn', 'learn.html', HTML],
      ['/learn.html', 'learn.html', HTML],
      ['/translate', 'index.html', HTML],
      ['/index.html', 'index.html', HTML],
      ['/app.css', 'app.css', 'text/css; charset=utf-8'],
    ] satisfies Array<[string, string, string]>
  ).map(([path, file, type]) => [
    path,
    { file: fileURLToPath(new URL(`../public/${file}`, import.meta.url)), type },
  ]),
);

/**
 * Live reload while developing: open tabs are told to refresh when a file in
 * `public/` changes. A restart of the server itself (tsx watch, on a change
 * under `src/`) drops the connection, and the page reloads when it comes back,
 * so both kinds of edit show up without touching the browser. Off in
 * production, where the script the pages load is served empty.
 */
const LIVE_RELOAD = process.env.NODE_ENV !== 'production';

const RELOAD_CLIENT = `(() => {
  let wasOpen = false;
  const source = new EventSource('/dev/reload');
  source.onopen = () => {
    if (wasOpen) location.reload();
    wasOpen = true;
  };
  source.onmessage = () => location.reload();
})();
`;

const reloadListeners = new Set<ServerResponse>();

function notifyReload(): void {
  for (const listener of reloadListeners) listener.write('data: reload\n\n');
}

if (LIVE_RELOAD) {
  // Editors save in more than one write; one reload per burst is enough.
  let settle: NodeJS.Timeout | undefined;
  watch(fileURLToPath(new URL('../public/', import.meta.url)), () => {
    clearTimeout(settle);
    settle = setTimeout(notifyReload, 80);
  });
}

function handleReloadStream(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  response.write('retry: 500\n\n');
  reloadListeners.add(response);
  request.on('close', () => reloadListeners.delete(response));
}

/**
 * What is running: the package version plus the short commit, so the page
 * title says which build it is. Render provides the commit as an environment
 * variable; locally it is asked of git, and left out if that fails.
 */
const VERSION = (() => {
  let version = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    if (typeof pkg.version === 'string') version = pkg.version;
  } catch {
    // Fall back to the placeholder.
  }
  let commit = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? '';
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      // Not a checkout, or no git: version alone will do.
    }
  }
  return commit ? `${version}+${commit.slice(0, 7)}` : version;
})();

/** Refuse a body far enough over the input limit that it cannot be a sentence. */
const MAX_BODY_BYTES = 64 * 1024;

const EXPLAIN_MODES: readonly ExplainMode[] = ['off', 'full', 'beginner'];

/** The same cap the bot uses, so one browser tab cannot monopolise the API key. */
const limiter = new Limiter(5);

interface TranslateRequest {
  text?: unknown;
  targets?: unknown;
  explain?: unknown;
}

class BadRequest extends Error {}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BadRequest('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

/**
 * Reads the form the page submitted, rejecting anything Claude should not be
 * asked to translate before it costs a request.
 */
function parseRequest(raw: string): { text: string; targets: string[]; explain: ExplainMode } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequest('Expected a JSON body.');
  }
  if (!parsed || typeof parsed !== 'object') throw new BadRequest('Expected a JSON object.');

  const { text, targets, explain } = parsed as TranslateRequest;
  if (typeof text !== 'string' || !text.trim()) {
    throw new BadRequest('Type something to translate.');
  }
  if (text.length > config.maxInputChars) {
    throw new BadRequest(`That is longer than the ${config.maxInputChars} character limit.`);
  }

  // Accepted either as a list or as the comma-separated string the input holds,
  // so the page can post whichever it has without reformatting.
  const list = Array.isArray(targets)
    ? targets.filter((entry): entry is string => typeof entry === 'string')
    : typeof targets === 'string'
      ? [targets]
      : [];
  const wanted = parseTargets(list.join(','));
  if (wanted.length === 0) throw new BadRequest('Name at least one language to translate into.');

  const mode = EXPLAIN_MODES.find((candidate) => candidate === explain) ?? config.explainByDefault;
  return { text: text.trim(), targets: wanted, explain: mode };
}

async function handleTranslate(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const { text, targets, explain } = parseRequest(await readBody(request));
  const result = await limiter.run(() => translate(text, targets, explain));
  send(response, 200, result);
}

async function handleAsset(response: ServerResponse, asset: Asset): Promise<void> {
  const body = await readFile(asset.file);
  response.writeHead(200, {
    'content-type': asset.type,
    'content-length': body.byteLength,
    // These are edited in place during development and are small enough that
    // re-fetching them costs nothing.
    'cache-control': 'no-cache',
  });
  response.end(body);
}

/**
 * Reads the learn page's form: either a sentence the learner typed, or the
 * topic and level to build one from.
 */
/** How many earlier sentences the prompt is told to steer clear of. */
const MAX_AVOID = 30;
const MAX_REVIEW = 5;

function parseLesson(raw: string): {
  learning: Learning;
  text?: string;
  topic?: string;
  level: Level;
  avoid?: string[];
  review?: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequest('Expected a JSON body.');
  }
  if (!parsed || typeof parsed !== 'object') throw new BadRequest('Expected a JSON object.');

  const { learning, text, topic, level, avoid, review } = parsed as Record<string, unknown>;
  const sentence = typeof text === 'string' ? text.trim() : '';
  if (sentence.length > config.maxInputChars) {
    throw new BadRequest(`Setningen er lengre enn grensen på ${config.maxInputChars} tegn.`);
  }
  const seen = Array.isArray(avoid)
    ? avoid
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim().slice(0, 300))
        .slice(-MAX_AVOID)
    : [];
  const comeback = Array.isArray(review)
    ? review
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => entry.trim().slice(0, 60))
        .slice(0, MAX_REVIEW)
    : [];

  return {
    learning: LEARNINGS.find((candidate) => candidate === learning) ?? 'tr',
    ...(sentence ? { text: sentence } : {}),
    ...(typeof topic === 'string' && topic.trim() ? { topic: topic.trim().slice(0, 200) } : {}),
    level: LEVELS.find((candidate) => candidate === level) ?? 'nybegynner',
    ...(seen.length ? { avoid: seen } : {}),
    ...(comeback.length ? { review: comeback } : {}),
  };
}

const pool = config.lessonDb === 'off' ? undefined : new LessonPool(config.lessonDb);

/** Shelves being topped up right now, so a burst of requests adds one lesson, not five. */
const toppingUp = new Set<string>();

/**
 * Adds one lesson to a shelf in the background, steering the model away from
 * what is already on it. Nothing waits for this; the learner who caused it
 * already has their sentence.
 */
function topUp(asked: LessonRequest): void {
  if (!pool) return;
  const key = `${asked.learning}/${asked.level}/${topicKey(asked.topic)}`;
  if (toppingUp.has(key)) return;
  toppingUp.add(key);
  // The shelf is for everyone, so the top-up is not steered by one learner's words.
  const { review: _review, ...shared } = asked;
  const request: LessonRequest = { ...shared, avoid: pool.targets(asked).slice(-MAX_AVOID) };
  limiter
    .run(() => lesson(request))
    .then((made) => {
      pool.store(request, made);
    })
    .catch((error: unknown) => {
      console.warn(`Topping up ${key} failed: ${(error as Error).message}`);
    })
    .finally(() => {
      toppingUp.delete(key);
    });
}

async function handleLesson(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const asked = parseLesson(await readBody(request));

  // A sentence of the learner's own is theirs; only generated ones are shared.
  let result: Lesson | undefined = asked.text ? undefined : pool?.pick(asked);
  if (result) {
    if (pool && pool.count(asked) < POOL_TARGET) topUp(asked);
  } else {
    result = await limiter.run(() => lesson(asked));
    if (!asked.text) pool?.store(asked, result);
  }
  send(response, 200, result);
}

/**
 * Turkish read aloud. The text rides in the query string so the browser can
 * point an audio element straight at it and cache the result like any file.
 */
async function handleSpeak(url: URL, response: ServerResponse): Promise<void> {
  if (!speechConfigured) {
    send(response, 503, { error: 'Speech is not configured on this server.' });
    return;
  }
  const text = url.searchParams.get('text') ?? '';
  const lang = url.searchParams.get('lang') === 'nb' ? 'nb' : 'tr';
  let audio: Buffer;
  try {
    audio = await speak(text, lang);
  } catch (error) {
    if (error instanceof SpeechUnavailable) throw new BadRequest(error.message);
    throw error;
  }
  response.writeHead(200, {
    'content-type': 'audio/mpeg',
    'content-length': audio.byteLength,
    'cache-control': 'private, max-age=31536000, immutable',
  });
  response.end(audio);
}

/**
 * The one address the site answers to. Any other custom domain that reaches
 * us (the .net spelling, a www prefix) is sent here so links and bookmarks all
 * end up in the same place. Empty means answer to anything, which is what
 * local development wants. The host's own name (onrender.com) is left alone,
 * because that is what its health checks arrive under.
 */
const CANONICAL_HOST = process.env.CANONICAL_HOST?.trim() ?? '';

function redirectHost(request: IncomingMessage, response: ServerResponse, path: string, search: string): boolean {
  if (!CANONICAL_HOST) return false;
  const host = request.headers.host?.split(':')[0] ?? '';
  if (host === CANONICAL_HOST || host === 'localhost' || host.endsWith('.onrender.com')) return false;
  response.writeHead(301, { location: `https://${CANONICAL_HOST}${path}${search}` });
  response.end();
  return true;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;
  if (redirectHost(request, response, path, url.search)) return;

  void (async () => {
    try {
      const asset = request.method === 'GET' ? ASSETS.get(path) : undefined;
      if (asset) {
        await handleAsset(response, asset);
        return;
      }
      if (request.method === 'GET' && path === '/dev/reload.js') {
        const body = LIVE_RELOAD ? RELOAD_CLIENT : '';
        response.writeHead(200, {
          'content-type': 'text/javascript; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'cache-control': 'no-cache',
        });
        response.end(body);
        return;
      }
      if (request.method === 'GET' && path === '/dev/reload' && LIVE_RELOAD) {
        handleReloadStream(request, response);
        return;
      }
      if (request.method === 'GET' && path === '/api/config') {
        send(response, 200, {
          targets: config.webTargets,
          explain: config.explainByDefault,
          maxInputChars: config.maxInputChars,
          version: VERSION,
          model: config.model,
        });
        return;
      }
      if (request.method === 'GET' && path === '/api/version') {
        send(response, 200, { version: VERSION, speech: speechFingerprint });
        return;
      }
      if (request.method === 'POST' && path === '/api/translate') {
        await handleTranslate(request, response);
        return;
      }
      if (request.method === 'POST' && path === '/api/lesson') {
        await handleLesson(request, response);
        return;
      }
      if (request.method === 'GET' && path === '/api/speak') {
        await handleSpeak(url, response);
        return;
      }
      send(response, 404, { error: 'Not found.' });
    } catch (error) {
      if (error instanceof BadRequest) {
        send(response, 400, { error: error.message });
        return;
      }
      console.error(`Request to ${path} failed:`, error);
      // The underlying error can carry API details, so the page gets a generic
      // message and the operator gets the stack trace above.
      send(response, 500, { error: 'Something went wrong. Check the server log.' });
    }
  })();
});

function main(): void {
  assertTranslatorConfigured();
  server.listen(config.webPort, () => {
    console.log(`Translator web app on http://localhost:${config.webPort} using model ${config.model}.`);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\nReceived ${signal}, shutting down.`);
    server.close(() => process.exit(0));
  });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
