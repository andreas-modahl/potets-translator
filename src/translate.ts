import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

export interface Translation {
  language: string;
  text: string;
}

export interface TranslationResult {
  sourceLanguage: string;
  translations: Translation[];
}

let cached: Anthropic | undefined;

/** Built on first use so that an unconfigured process fails in `main`, with a readable message. */
function client(): Anthropic {
  cached ??= new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2 });
  return cached;
}

const SYSTEM_PROMPT = `You translate messages posted in a Discord chat channel.

You will be given one message and a list of target languages. Detect the language
the message is written in, then translate it into each target language.

Rules:
- Omit a target language from your output when the message is already written in
  that language. Never "translate" a message into its own language.
- Translate the meaning, not the words. Chat messages are informal: keep slang,
  humour, insults, and register intact rather than making them prim.
- Reproduce these verbatim, never translated and never reformatted:
  user mentions (<@123>), role mentions (<@&123>), channel links (<#123>),
  custom emoji (<:name:123> and <a:name:123>), timestamps (<t:123:R>), URLs, and
  the contents of code blocks and inline code.
- Keep markdown formatting (**bold**, *italic*, __underline__, ||spoilers||,
  > quotes, - lists) in the same places.
- Leave proper nouns, usernames, game names, and product names untranslated.
- Output only the translation. No notes, no explanations, no quotation marks
  wrapped around the result, no "Translation:" prefix.
- If the message is not translatable text at all (only emoji, only a URL, only
  punctuation), return no translations.`;

const TOOL: Anthropic.Tool = {
  name: 'post_translation',
  description: 'Report the detected source language and the requested translations.',
  input_schema: {
    type: 'object',
    properties: {
      source_language: {
        type: 'string',
        description:
          'English name of the language the original message is written in, e.g. "Norwegian". Use "unknown" if it cannot be determined.',
      },
      translations: {
        type: 'array',
        description:
          'One entry per requested target language, excluding any target that is the same language as the source.',
        items: {
          type: 'object',
          properties: {
            language: {
              type: 'string',
              description: 'The target language, spelled exactly as it was requested.',
            },
            text: { type: 'string', description: 'The message translated into that language.' },
          },
          required: ['language', 'text'],
        },
      },
    },
    required: ['source_language', 'translations'],
  },
};

interface ToolInput {
  source_language?: unknown;
  translations?: unknown;
}

/**
 * Translates one message into every target language it is not already in.
 *
 * Returns an empty `translations` array when the message is already in all of
 * the target languages, or when there is nothing translatable in it.
 */
export async function translate(text: string, targets: string[]): Promise<TranslationResult> {
  const response = await client().messages.create({
    model: config.model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [
      {
        role: 'user',
        content: `Target languages: ${targets.join(', ')}\n\nMessage:\n<message>\n${text}\n</message>`,
      },
    ],
  });

  const block = response.content.find((part) => part.type === 'tool_use');
  if (!block) {
    throw new Error('Claude returned no translation; expected a post_translation tool call.');
  }

  const input = block.input as ToolInput;
  const raw = Array.isArray(input.translations) ? input.translations : [];
  const translations: Translation[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { language, text: translated } = entry as Record<string, unknown>;
    if (typeof language !== 'string' || typeof translated !== 'string') continue;
    if (!translated.trim()) continue;
    translations.push({ language, text: translated.trim() });
  }

  return {
    sourceLanguage: typeof input.source_language === 'string' ? input.source_language : 'unknown',
    translations,
  };
}
