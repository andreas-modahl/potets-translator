import 'dotenv/config';
import { parseTargets } from './languages.js';

export type PostMode = 'plain' | 'reply' | 'thread' | 'webhook';

const POST_MODES: readonly PostMode[] = ['plain', 'reply', 'thread', 'webhook'];

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

/** Comma-separated language list, used for the web app's initial targets. */
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

function postMode(name: string, fallback: PostMode): PostMode {
  const raw = optional(name)?.toLowerCase();
  if (!raw) return fallback;
  const match = POST_MODES.find((mode) => mode === raw);
  if (!match) {
    throw new Error(
      `Environment variable ${name} must be one of ${POST_MODES.join(', ')}, got "${raw}".`,
    );
  }
  return match;
}

export const config = {
  discordToken: optional('DISCORD_TOKEN') ?? '',
  anthropicApiKey: optional('ANTHROPIC_API_KEY') ?? '',
  /** When set, slash commands register to this guild only, which is instant. */
  guildId: optional('DISCORD_GUILD_ID'),
  model: optional('CLAUDE_MODEL') ?? 'claude-sonnet-5',
  maxInputChars: positiveInt('MAX_INPUT_CHARS', 2000),
  defaultPostMode: postMode('DEFAULT_POST_MODE', 'plain'),
  explainByDefault: explainMode('EXPLAIN_TRANSLATIONS', 'full'),
  dataFile: optional('DATA_FILE') ?? 'data/channels.json',
  webPort: positiveInt('WEB_PORT', 3000),
  /** The languages the web app starts with; the page can change them per request. */
  webTargets: languageList('WEB_TARGETS', ['English', 'Norwegian']),
  /** Azure Speech, for reading Turkish aloud on the learn page. Optional. */
  azureSpeechKey: optional('AZURE_SPEECH_KEY'),
  azureSpeechRegion: optional('AZURE_SPEECH_REGION'),
  azureSpeechVoice: optional('AZURE_SPEECH_VOICE') ?? 'tr-TR-EmelNeural',
  speechCacheDir: optional('SPEECH_CACHE_DIR') ?? 'data/speech',
} as const;

/**
 * Checked from `main` rather than at import time, so a missing key produces a
 * readable message naming every missing variable instead of a stack trace
 * naming only the first one.
 */
export function assertConfigured(): void {
  const missing: string[] = [];
  if (!config.discordToken) missing.push('DISCORD_TOKEN');
  if (!config.anthropicApiKey) missing.push('ANTHROPIC_API_KEY');
  report(missing);
}

/**
 * The web app's half of the check. It talks to Claude but not to Discord, so
 * refusing to start it over a missing bot token would be nonsense.
 */
export function assertTranslatorConfigured(): void {
  report(config.anthropicApiKey ? [] : ['ANTHROPIC_API_KEY']);
}

function report(missing: string[]): void {
  if (missing.length === 0) return;

  throw new Error(
    `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.\n` +
      'Copy .env.example to .env and fill it in.',
  );
}
