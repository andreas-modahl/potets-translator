import 'dotenv/config';

export type PostMode = 'webhook' | 'reply';

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

export const config = {
  discordToken: optional('DISCORD_TOKEN') ?? '',
  anthropicApiKey: optional('ANTHROPIC_API_KEY') ?? '',
  /** When set, slash commands register to this guild only, which is instant. */
  guildId: optional('DISCORD_GUILD_ID'),
  model: optional('CLAUDE_MODEL') ?? 'claude-sonnet-5',
  maxInputChars: positiveInt('MAX_INPUT_CHARS', 2000),
  defaultPostMode: (optional('DEFAULT_POST_MODE') === 'reply' ? 'reply' : 'webhook') as PostMode,
  dataFile: optional('DATA_FILE') ?? 'data/channels.json',
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
  if (missing.length === 0) return;

  throw new Error(
    `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.\n` +
      'Copy .env.example to .env and fill it in.',
  );
}
