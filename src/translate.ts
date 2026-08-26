import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

export interface GlossPair {
  /** A chunk of the translation. */
  target: string;
  /** The chunk of the original it came from. */
  source: string;
}

export interface Translation {
  language: string;
  text: string;
  /** Present only when an explanation was asked for. */
  gloss?: GlossPair[];
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

const GLOSS_PROMPT = `
You have also been asked to explain the translation, for someone learning the
language. Along with each translation, break it into chunks and pair each chunk
with the part of the original it came from.

- Split on meaning, not on words. Languages do not line up one word to one word:
  a single word in one language is often several in another, and vice versa.
  Pair "geçiriyor musun" with "har du", rather than inventing a word each.
- Work through the translation in order, left to right, and cover all of it.
- Do not overlap. Each part of the translation belongs to at most one pair, so
  never pair a suffix separately from the word it is attached to.
- Skip pairs where both sides are the same text anyway: names, numbers, URLs,
  emoji, and mentions teach the reader nothing.
- Keep each chunk short. Prefer more small pairs over a few long ones, but never
  split a chunk so small that the pairing becomes wrong.
- At most 12 pairs. If the message is long enough that it would need more, give
  no gloss at all rather than a truncated one.`;

const GLOSS_SCHEMA = {
  type: 'object',
  properties: {
    target: { type: 'string', description: 'A chunk of your translation.' },
    source: { type: 'string', description: 'The chunk of the original it came from.' },
  },
  required: ['target', 'source'],
} as const;

function buildTool(explain: boolean): Anthropic.Tool {
  return {
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
              ...(explain
                ? {
                    gloss: {
                      type: 'array',
                      description:
                        'Chunk-by-chunk pairing of your translation back to the original wording, in order. Omit entirely if the message is too long to gloss in 12 pairs.',
                      items: GLOSS_SCHEMA,
                    },
                  }
                : {}),
            },
            required: ['language', 'text'],
          },
        },
      },
      required: ['source_language', 'translations'],
    },
  };
}

interface ToolInput {
  source_language?: unknown;
  translations?: unknown;
}

/**
 * @param translated the translation the pairs belong to, used to put them back
 *   into reading order. The model is asked for them in order but does not
 *   reliably comply, and a gloss that jumps around is hard to follow.
 */
function parseGloss(value: unknown, translated: string): GlossPair[] {
  if (!Array.isArray(value)) return [];
  const pairs: GlossPair[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { target, source } = entry as Record<string, unknown>;
    if (typeof target !== 'string' || typeof source !== 'string') continue;
    const cleanTarget = target.trim();
    const cleanSource = source.trim();
    if (!cleanTarget || !cleanSource) continue;
    // A pair that says a chunk translates to itself teaches nothing.
    if (cleanTarget.toLowerCase() === cleanSource.toLowerCase()) continue;
    pairs.push({ target: cleanTarget, source: cleanSource });
  }

  // Sort by where each chunk appears in the translation. Anything that cannot
  // be located keeps its original position relative to the rest.
  const haystack = translated.toLowerCase();
  return pairs
    .map((pair, index) => {
      const at = haystack.indexOf(pair.target.toLowerCase());
      return { pair, index, at: at === -1 ? Number.MAX_SAFE_INTEGER : at };
    })
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ pair }) => pair);
}

/**
 * Translates one message into every target language it is not already in.
 *
 * Returns an empty `translations` array when the message is already in all of
 * the target languages, or when there is nothing translatable in it.
 */
export async function translate(
  text: string,
  targets: string[],
  explain = false,
): Promise<TranslationResult> {
  const tool = buildTool(explain);
  const response = await client().messages.create({
    model: config.model,
    // A gloss roughly doubles the output, and long messages gloss long.
    max_tokens: explain ? 4096 : 2048,
    system: explain ? `${SYSTEM_PROMPT}\n${GLOSS_PROMPT}` : SYSTEM_PROMPT,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
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
    const { language, text: translated, gloss } = entry as Record<string, unknown>;
    if (typeof language !== 'string' || typeof translated !== 'string') continue;
    if (!translated.trim()) continue;

    const pairs = parseGloss(gloss, translated);
    translations.push({
      language,
      text: translated.trim(),
      ...(pairs.length > 0 ? { gloss: pairs } : {}),
    });
  }

  return {
    sourceLanguage: typeof input.source_language === 'string' ? input.source_language : 'unknown',
    translations,
  };
}
