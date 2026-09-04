import type Anthropic from '@anthropic-ai/sdk';
import { align } from './align.js';
import { client } from './claude.js';
import { config } from './config.js';

/** One piece of a Turkish word: the root, or a suffix glued onto it. */
export interface Morpheme {
  /** The piece as it is spelled inside the word. */
  form: string;
  /** What it contributes, in Norwegian. */
  means: string;
}

export interface LessonChunk {
  /** A slice of the Turkish sentence, exactly as it is spelled there. */
  turkish: string;
  /** What this piece means on its own, in Norwegian. */
  norwegian: string;
  /**
   * A grammar note in Norwegian, present only when the piece has something to
   * teach: a case ending, a tense, vowel harmony, a word order that surprises.
   */
  note?: string;
  /** The word broken into root and suffixes, for words that carry any. */
  morphemes?: Morpheme[];
}

export interface Lesson {
  /** The Turkish sentence, which is the line the whole page is built around. */
  turkish: string;
  /** Natural Norwegian: how you would actually say it, not a word-for-word gloss. */
  norwegian: string;
  /**
   * The sentence cut into pieces that line up under the Turkish, left to right.
   * Empty when the model could not produce a breakdown that fits the sentence,
   * in which case the page shows the sentence pair without the columns.
   */
  chunks: LessonChunk[];
  /** The one grammar point this sentence is worth remembering for, in Norwegian. */
  focus?: string;
}

export type Level = 'nybegynner' | 'viderekommen' | 'avansert';

export const LEVELS: readonly Level[] = ['nybegynner', 'viderekommen', 'avansert'];

const LEVEL_BRIEF: Record<Level, string> = {
  nybegynner:
    'A first-year sentence: 4-7 words, present tense, everyday vocabulary, at most one suffix worth explaining.',
  viderekommen:
    'An intermediate sentence: 6-12 words. Use past or future tense, case endings, possessives, or a postposition.',
  avansert:
    'An advanced sentence: a subordinate clause built with a participle or verbal noun (-dığı, -acağı, -mesi), the constructions Turkish uses where Norwegian would use "at" or "som".',
};

const SYSTEM_PROMPT = `You are a Turkish teacher writing material for a Norwegian speaker.

Your student reads Norwegian (bokmål) natively and is learning Turkish. Every
explanation you write is in Norwegian. The Turkish is the thing being learned,
so it is never explained away in English.

You produce one sentence at a time, cut into pieces that can be printed in
columns underneath the Turkish, so the student can see which Turkish word
carries which piece of the meaning.

The breakdown is the whole point, so it must be exact:
- Each piece's "turkish" must be spelled exactly as it appears in the sentence,
  and be a contiguous run of it. Never normalise, never give a dictionary form,
  never write "..." to skip words.
- Read left to right through the Turkish sentence. The pieces in order must
  cover all of it, with nothing skipped and nothing repeated. Punctuation
  between pieces is fine to leave out; a word is not.
- One Turkish word per piece. Turkish packs into single words what Norwegian
  spreads over several, and that is exactly what the student needs to see.
  Group two words into one piece only for a fixed expression that is learned as
  a unit, or for a word plus the postposition that governs it ("okul için").

For each piece:
- "norwegian" is what that piece contributes, in Norwegian. It may read as a
  fragment out of order — "til skolen", "jeg går" — because Turkish and
  Norwegian arrange a sentence differently. That mismatch is the lesson.
- "morphemes" splits the Turkish word into its root and each suffix, in the
  order they are spelled, with what each one does in Norwegian: root "oku"
  = "lese", suffix "-yor" = "presens, pågående", suffix "-um" = "jeg". The
  forms joined together must spell the word exactly as it stands in the
  sentence, letter for letter. Where the stem changes, give the changed form,
  not the dictionary one: "istiyorum" splits as "ist" + "iyor" + "um", never
  "iste" + "iyor" + "um", because the e is gone from the word. Give this for
  every word that carries a suffix, which in Turkish is most of them. Skip it
  for bare words that carry nothing: "ben", "çok", "ve".
- "note" is one sentence of Norwegian explaining the grammar, and only when
  there is something real to say: which case a suffix is and what it does, why
  the vowel is "a" and not "e", why the verb is last, why a possessive shows up
  where Norwegian would use "sin". Leave it out entirely for a plain word. A
  note that only repeats the translation is worse than no note.

Give "turkish" — the whole sentence on one line — before you give the pieces.
It is the thing the pieces are checked against, so it is never left out, even
though the pieces repeat it.

"norwegian" at the top level is the natural Norwegian sentence: what a Norwegian
would actually say, with normal word order, not a word-for-word gloss.

"focus" names the one thing this sentence teaches, in Norwegian, in a short
phrase: "dativ -a/-e", "presens -iyor", "eiendomssuffiks".`;

const MORPHEME_SCHEMA = {
  type: 'object',
  properties: {
    form: {
      type: 'string',
      description: 'The root or suffix as spelled inside the word, e.g. "oku" or "yor".',
    },
    means: { type: 'string', description: 'What it contributes, in Norwegian.' },
  },
  required: ['form', 'means'],
} as const;

const TOOL: Anthropic.Tool = {
  name: 'post_lesson',
  description: 'Report one Turkish sentence, broken down for a Norwegian-speaking learner.',
  input_schema: {
    type: 'object',
    properties: {
      turkish: { type: 'string', description: 'The Turkish sentence, exactly as it reads.' },
      norwegian: {
        type: 'string',
        description: 'The natural Norwegian sentence, in normal Norwegian word order.',
      },
      focus: {
        type: 'string',
        description: 'The one grammar point this sentence teaches, named in Norwegian.',
      },
      chunks: {
        type: 'array',
        description:
          'The Turkish sentence cut into pieces, in the order they appear in it, covering all of it.',
        items: {
          type: 'object',
          properties: {
            turkish: {
              type: 'string',
              description: 'A contiguous slice of the Turkish sentence, spelled exactly as it is there.',
            },
            norwegian: { type: 'string', description: 'What this piece contributes, in Norwegian.' },
            note: {
              type: 'string',
              description:
                'One sentence of grammar explanation in Norwegian. Omit when the piece has nothing to teach.',
            },
            morphemes: {
              type: 'array',
              description:
                'Root and suffixes in spelling order, whose forms joined together spell the word. Omit for words with no suffix.',
              items: MORPHEME_SCHEMA,
            },
          },
          required: ['turkish', 'norwegian'],
        },
      },
    },
    required: ['turkish', 'norwegian', 'chunks'],
  },
};

export interface LessonRequest {
  /** A sentence the learner supplied, in Norwegian or in Turkish. */
  text?: string;
  /** What a generated sentence should be about. */
  topic?: string;
  level: Level;
}

function brief({ text, topic, level }: LessonRequest): string {
  if (text) {
    return (
      'Here is a sentence from the student. It may be written in Norwegian or in Turkish.\n' +
      'If it is Norwegian, translate it into natural Turkish and break that down.\n' +
      'If it is already Turkish, keep it as it is and break it down.\n\n' +
      `<sentence>\n${text}\n</sentence>`
    );
  }
  const about = topic ? `\n\nThe sentence should be about: ${topic}` : '';
  return `Write one Turkish sentence for the student and break it down.\n\n${LEVEL_BRIEF[level]}${about}`;
}

function parseMorphemes(value: unknown, word: string): Morpheme[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const morphemes: Morpheme[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { form, means } = entry as Record<string, unknown>;
    if (typeof form !== 'string' || typeof means !== 'string') continue;
    const cleanForm = form.trim().replace(/^-+|-+$/gu, '');
    if (!cleanForm || !means.trim()) continue;
    morphemes.push({ form: cleanForm, means: means.trim() });
  }
  if (morphemes.length < 2) return undefined;

  const forms = morphemes.map(({ form }) => form);
  if (spellsWord(forms, word)) return morphemes;

  console.warn(
    `Dropping morphemes for ${JSON.stringify(word)}: ${JSON.stringify(forms.join('-'))} does not spell it.`,
  );
  return undefined;
}

/**
 * True when the pieces, joined up, really do spell the word.
 *
 * The pieces are printed as a spelling of the word, so a split that does not
 * spell it would be a lie about how the word is built, and gets dropped.
 *
 * The comparison folds together the consonants Turkish swaps when a suffix
 * follows: kitap becomes kitab-ı, gitmek becomes gid-iyor. The root really is
 * spelled the other way on its own, so a split giving "git" for the "gid" in
 * "gidiyorum" is right rather than wrong and must survive the check. Case is
 * folded with Turkish rules, so that a capital İ is not mangled on the way.
 */
export function spellsWord(forms: string[], word: string): boolean {
  const spelled = forms.join('');
  return spelled.length > 0 && devoice(spelled) === devoice(word);
}

function devoice(word: string): string {
  return word
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLocaleLowerCase('tr')
    .replace(/b/gu, 'p')
    .replace(/c/gu, 'ç')
    .replace(/d/gu, 't')
    .replace(/[gğ]/gu, 'k');
}

interface RawChunk {
  turkish: string;
  norwegian: string;
  note?: string;
  morphemes?: unknown;
}

/** Keeps the breakdown entries that have both sides filled in. */
function parseRawChunks(value: unknown): RawChunk[] {
  if (!Array.isArray(value)) return [];

  const chunks: RawChunk[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { turkish, norwegian, note, morphemes } = entry as Record<string, unknown>;
    if (typeof turkish !== 'string' || typeof norwegian !== 'string') continue;
    if (!turkish.trim() || !norwegian.trim()) continue;
    chunks.push({
      turkish: turkish.trim(),
      norwegian: norwegian.trim(),
      ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
      morphemes,
    });
  }
  return chunks;
}

/** Puts the pieces back into a sentence, without a space before punctuation. */
function rejoin(pieces: string[]): string {
  return pieces.join(' ').replace(/\s+([,.;:!?…])/gu, '$1').trim();
}

/**
 * Checks the breakdown against the sentence with `align`, rather than trusting
 * the model's spelling of it.
 *
 * Each chunk's Turkish is replaced by the exact slice of the sentence it
 * matched, so what the page prints in the columns is the sentence itself.
 *
 * @returns the chunks, or an empty array when the breakdown does not fit, in
 *   which case the page shows the sentence without columns rather than showing
 *   a pairing that is wrong.
 */
function alignChunks(chunks: RawChunk[], sentence: string): LessonChunk[] {
  const spans = align(sentence, chunks.map(({ turkish }) => turkish));
  if (!spans) {
    console.warn(
      `Dropping breakdown: pieces do not reconstruct ${JSON.stringify(sentence)}: ` +
        chunks.map(({ turkish }) => JSON.stringify(turkish)).join(', '),
    );
    return [];
  }

  return chunks.map((chunk, index) => {
    const span = spans[index];
    const exact = span ? sentence.slice(span.at, span.end) : chunk.turkish;
    const morphemes = parseMorphemes(chunk.morphemes, exact);
    return {
      turkish: exact,
      norwegian: chunk.norwegian,
      ...(chunk.note ? { note: chunk.note } : {}),
      ...(morphemes ? { morphemes } : {}),
    };
  });
}

/**
 * Builds one lesson: a Turkish sentence, its natural Norwegian, and the
 * piece-by-piece breakdown that lines the two up.
 *
 * A breakdown that does not fit the sentence is dropped rather than shown, so
 * the sentence is asked for twice before giving up: a second attempt usually
 * lands, and a lesson without its columns is barely a lesson.
 */
export async function lesson(request: LessonRequest, attempts = 2): Promise<Lesson> {
  let last: Lesson | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await client().messages.create({
      model: config.model,
      // A morpheme split for every word adds up, and an advanced sentence is
      // both longer and more heavily suffixed than a beginner's.
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: brief(request) }],
    });

    // A cut-off answer arrives as half-written JSON, which parses into a lesson
    // missing whatever came after the cut. Asking again is the only fix.
    if (response.stop_reason === 'max_tokens') {
      console.warn('Lesson came back cut off at max_tokens; asking again.');
      continue;
    }

    const block = response.content.find((part) => part.type === 'tool_use');
    if (!block) {
      console.warn('Claude returned no post_lesson tool call; asking again.');
      continue;
    }

    const input = block.input as Record<string, unknown>;
    const norwegian = typeof input.norwegian === 'string' ? input.norwegian.trim() : '';
    const chunks = parseRawChunks(input.chunks);
    // On a long sentence the model sometimes skips the whole-sentence field and
    // gives only the pieces, which are the sentence anyway. Rebuilding it from
    // them costs a real check — the pieces then line up by construction — but
    // that beats refusing a lesson that is otherwise complete.
    const given = typeof input.turkish === 'string' ? input.turkish.trim() : '';
    const turkish = given || rejoin(chunks.map((chunk) => chunk.turkish));
    if (!turkish || !norwegian) {
      console.warn('Claude returned a lesson with neither a sentence nor pieces; asking again.');
      continue;
    }

    last = {
      turkish,
      norwegian,
      chunks: alignChunks(chunks, turkish),
      ...(typeof input.focus === 'string' && input.focus.trim()
        ? { focus: input.focus.trim() }
        : {}),
    };
    if (last.chunks.length > 0) return last;
  }

  if (!last) throw new Error('Claude returned no usable lesson after two attempts.');
  return last;
}
