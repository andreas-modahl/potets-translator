import { type Message, MessageType } from 'discord.js';

/** Message types that carry real user prose. Joins, pins, boosts and the rest are noise. */
const TRANSLATABLE_TYPES = new Set<MessageType>([MessageType.Default, MessageType.Reply]);

const URL_PATTERN = /https?:\/\/\S+/gu;
const CUSTOM_EMOJI_PATTERN = /<a?:\w+:\d+>/gu;
const MENTION_PATTERN = /<(?:@[!&]?|#)\d+>|<t:\d+(?::[tTdDfFR])?>/gu;
/** Unicode emoji, variation selectors, zero-width joiners and skin-tone modifiers. */
const UNICODE_EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Emoji_Component}\uFE0F\u200D]/gu;

export type SkipReason = 'type' | 'bot' | 'empty' | 'command' | 'too-long';

export type FilterVerdict = { translate: true; text: string } | { translate: false; reason: SkipReason };

/**
 * Strips everything that survives translation unchanged, so a message that is
 * only links, mentions and emoji is recognised as having no prose in it.
 */
function proseOf(content: string): string {
  return content
    .replace(URL_PATTERN, ' ')
    .replace(CUSTOM_EMOJI_PATTERN, ' ')
    .replace(MENTION_PATTERN, ' ')
    .replace(UNICODE_EMOJI_PATTERN, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function inspect(message: Message, maxInputChars: number): FilterVerdict {
  // Ignoring bots and webhooks is what stops the bot translating its own
  // translations in an endless loop, since it posts them via a webhook.
  if (message.author.bot || message.webhookId) return { translate: false, reason: 'bot' };
  if (!TRANSLATABLE_TYPES.has(message.type)) return { translate: false, reason: 'type' };

  const content = message.content.trim();
  if (!content) return { translate: false, reason: 'empty' };
  // Leave other bots' prefix commands alone.
  if (/^[!?./$%&>~-]\w/u.test(content)) return { translate: false, reason: 'command' };
  if (content.length > maxInputChars) return { translate: false, reason: 'too-long' };
  if (!proseOf(content)) return { translate: false, reason: 'empty' };

  return { translate: true, text: content };
}
