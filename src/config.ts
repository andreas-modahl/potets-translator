import 'dotenv/config';
import { parseTargets } from './languages.js';

/**
 * How much of an explanation rides along with each translation.
 *
 * `full` breaks the whole translation down chunk by chunk. `beginner` picks out
 * only a handful of core words worth learning first, highlights them in the
 * translation, and explains just those.
 */
export type ExplainMode = 'off' | 'full' | 'beginner';

const EXPLAIN_MODES: readonly ExplainMode[] = ['off', 'full', 'beginner'];

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function positiveInt(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}".`);
  }
  return parsed;
}

/** Comma-separated language list, used for the translator page's initial targets. */
function languageList(name: string, fallback: string[]): string[] {
  const raw = optional(name);
  if (!raw) return fallback;
  const targets = parseTargets(raw);
  if (targets.length === 0) {
    throw new Error(`Environment variable ${name} must list at least one language, got "${raw}".`);
  }
  return targets;
}

function explainMode(name: string, fallback: ExplainMode): ExplainMode {
  const raw = optional(name)?.toLowerCase();
  if (!raw) return fallback;
  // The boolean spellings are accepted because this setting used to be one.
  if (['off', 'false', '0', 'no', 'none'].includes(raw)) return 'off';
  if (['full', 'true', '1', 'yes', 'on'].includes(raw)) return 'full';
  if (raw === 'beginner') return 'beginner';
  throw new Error(
    `Environment variable ${name} must be one of ${EXPLAIN_MODES.join(', ')}, got "${raw}".`,
  );
}

export const config = {
  anthropicApiKey: optional('ANTHROPIC_API_KEY') ?? '',
  model: optional('CLAUDE_MODEL') ?? 'claude-sonnet-5',
  maxInputChars: positiveInt('MAX_INPUT_CHARS', 2000),
  explainByDefault: explainMode('EXPLAIN_TRANSLATIONS', 'full'),
  webPort: positiveInt('WEB_PORT', 3000),
  /** The languages the translator page starts with; the page can change them per request. */
  webTargets: languageList('WEB_TARGETS', ['English', 'Norwegian']),
  /** Azure Speech, for reading Turkish aloud on the learn page. Optional. */
  azureSpeechKey: optional('AZURE_SPEECH_KEY'),
  azureSpeechRegion: optional('AZURE_SPEECH_REGION'),
  azureSpeechVoice: optional('AZURE_SPEECH_VOICE') ?? 'tr-TR-AhmetNeural',
  azureSpeechVoiceNb: optional('AZURE_SPEECH_VOICE_NB') ?? 'nb-NO-PernilleNeural',
  speechCacheDir: optional('SPEECH_CACHE_DIR') ?? 'data/speech',
  /**
   * Recraft, drawing nouns that neither the emoji set nor the pictograms
   * cover. Off unless RECRAFT_ENABLED is set, since each drawing costs money.
   */
  recraftEnabled: optional('RECRAFT_ENABLED') === 'true',
  recraftApiKey: optional('RECRAFT_API_KEY'),
  recraftModel: optional('RECRAFT_MODEL') ?? 'recraftv4_1_vector',
  /** A style made from reference images in Recraft, so every drawing matches. */
  recraftStyleId: optional('RECRAFT_STYLE_ID'),
  pictureCacheDir: optional('PICTURE_CACHE_DIR') ?? 'data/pictures',
  /** New drawings a day, at most; each costs a few cents. */
  pictureDailyCap: positiveInt('PICTURE_DAILY_CAP', 300),
  /**
   * The SQLite file: the lesson pool and, when login is on, users and their
   * synced state. "off" turns the pool off and disables login.
   */
  lessonDb: optional('LESSON_DB') ?? 'data/lessons.db',
  /** Sign in with Google. Both from the OAuth client in Google Cloud; optional. */
  googleClientId: optional('GOOGLE_CLIENT_ID') ?? '',
  googleClientSecret: optional('GOOGLE_CLIENT_SECRET') ?? '',
  /** Signs session cookies. Unset means logins do not survive a restart. */
  sessionSecret: optional('SESSION_SECRET') ?? '',
  /** SSML prosody for the ball voice: pitch and rate as Azure accepts them. */
  speechPitch: optional('SPEECH_PITCH') ?? '+0%',
  speechRate: optional('SPEECH_RATE') ?? '-15%',
  /**
   * A speaking style for voices that take one (the MAI voices). "serious"
   * keeps Elif from laughing at a lone word; empty means none.
   */
  speechStyle: optional('SPEECH_STYLE') ?? 'serious',
} as const;

/**
 * Checked from `main` rather than at import time, so a missing key produces a
 * readable message instead of a stack trace.
 */
export function assertConfigured(): void {
  if (config.anthropicApiKey) return;

  throw new Error(
    'Missing required environment variable: ANTHROPIC_API_KEY.\n' +
      'Copy .env.example to .env and fill it in.',
  );
}
