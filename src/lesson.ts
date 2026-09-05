import type Anthropic from '@anthropic-ai/sdk';
import { align } from './align.js';
import { client } from './claude.js';
import { config } from './config.js';

/**
 * Which language is being learned. The other one is the learner's own, and is
 * the language every explanation is written in.
 */
export type Learning = 'tr' | 'nb';

export const LEARNINGS: readonly Learning[] = ['tr', 'nb'];

/** One piece of a word in the target language: the root, or a suffix glued onto it. */
export interface Morpheme {
  /** The piece as it is spelled inside the word. */
  form: string;
  /** What it contributes, in the learner's language. */
  means: string;
}

/** The word class of a piece's main word, named the same way in every direction. */
export type WordClass =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'pronoun'
  | 'adposition'
  | 'conjunction'
  | 'numeral'
  | 'determiner'
  | 'interjection'
  | 'particle';

export const WORD_CLASSES: readonly WordClass[] = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'adposition',
  'conjunction',
  'numeral',
  'determiner',
  'interjection',
  'particle',
];

export interface LessonChunk {
  /** A slice of the target sentence, exactly as it is spelled there. */
  target: string;
  /** What this piece means on its own, in the learner's language. */
  native: string;
  /** The word class of the piece's main word. */
  pos?: WordClass;
  /**
   * For a noun, its dictionary form in English: what the drawing of it is
   * asked for as, since the picture model knows English best.
   */
  english?: string;
  /**
   * A grammar note in the learner's language, present only when the piece has
   * something to teach: a case ending, a tense, a word order that surprises.
   */
  note?: string;
  /** The word broken into root and suffixes, for words that carry any. */
  morphemes?: Morpheme[];
}

export interface Lesson {
  learning: Learning;
  /** The sentence in the language being learned; the line the page is built around. */
  target: string;
  /** The natural sentence in the learner's language, not a word-for-word gloss. */
  native: string;
  /**
   * The sentence cut into pieces that line up under the target, left to right.
   * Empty when the model could not produce a breakdown that fits the sentence,
   * in which case the page shows the sentence pair without the columns.
   */
  chunks: LessonChunk[];
  /** The one grammar point this sentence is worth remembering for. */
  focus?: string;
}

export type Level = 'start' | 'nybegynner' | 'viderekommen' | 'avansert';

export const LEVELS: readonly Level[] = ['start', 'nybegynner', 'viderekommen', 'avansert'];

interface Direction {
  /** The language being learned, and the learner's own, as the prompt names them. */
  target: string;
  native: string;
  level: Record<Level, string>;
  /** How words in the target language are built, with examples for the split. */
  morphology: string;
  /** What the grammar notes should dwell on. */
  notes: string;
  /** Example focus phrases in the learner's language. */
  focus: string;
}

const DIRECTIONS: Record<Learning, Direction> = {
  tr: {
    target: 'Turkish',
    native: 'Norwegian (bokmål)',
    level: {
      start:
        'A very first sentence for someone who knows almost no Turkish: 2-4 words, present tense, only the most common words (I, you, this, a dog, to be, to have, to like, good, big), and no suffix beyond the one the sentence cannot do without. Keep any note to one short line.',
      nybegynner:
        'A first-year sentence: 4-7 words, present tense, everyday vocabulary, at most one suffix worth explaining.',
      viderekommen:
        'An intermediate sentence: 6-12 words. Use past or future tense, case endings, possessives, or a postposition.',
      avansert:
        'An advanced sentence: a subordinate clause built with a participle or verbal noun (-dığı, -acağı, -mesi), the constructions Turkish uses where Norwegian would use "at" or "som".',
    },
    morphology:
      'Turkish packs into single words what Norwegian spreads over several, and that is exactly what the student needs to see. ' +
      'Split every word that carries a suffix, which is most of them: root "oku" = "lese", suffix "-yor" = "presens, pågående", suffix "-um" = "jeg". ' +
      'Where the stem changes, give the changed form, not the dictionary one: "istiyorum" splits as "ist" + "iyor" + "um", never "iste" + "iyor" + "um", because the e is gone from the word. ' +
      'Skip the split for bare words that carry nothing: "ben", "çok", "ve".',
    notes:
      'which case a suffix is and what it does, why the vowel is "a" and not "e", why the verb is last, why a possessive shows up where Norwegian would use "sin"',
    focus: '"dativ -a/-e", "presens -iyor", "eiendomssuffiks"',
  },
  nb: {
    target: 'Norwegian (bokmål)',
    native: 'Turkish',
    level: {
      start:
        'A very first sentence for someone who knows almost no Norwegian: 2-4 words, present tense, only the most common words (jeg, du, dette, en hund, å være, å ha, å like, god, stor), and no ending beyond the one the sentence cannot do without. Keep any note to one short line.',
      nybegynner:
        'A first-year sentence: 4-7 words, present tense, everyday vocabulary, at most one grammar point worth explaining.',
      viderekommen:
        'An intermediate sentence: 6-12 words. Use past or perfect tense, a definite noun, a possessive, or a preposition that Turkish would express with a case ending.',
      avansert:
        'An advanced sentence: a subordinate clause with "at" or "som", inverted word order after a fronted adverbial, or a modal verb, the constructions Norwegian uses where Turkish would use a participle or verbal noun.',
    },
    morphology:
      'Norwegian spreads over several words what Turkish packs into one, and articles, prepositions and word order are what the student needs to see. ' +
      'Split a word only where it really carries an ending: "skolen" = "skole" (okul) + "n" (belirli tanımlık, -i hali değil), "bøkene" = "bøk" + "ene", "snakket" = "snakk" + "et" (geçmiş zaman). ' +
      'The forms joined together must spell the word exactly as it stands. Skip the split for words with no ending: "jeg", "og", "til".',
    notes:
      'why a noun takes -en or -et, what a preposition does that Turkish would mark with a suffix, why the verb comes second, why "det" or "der" appears where Turkish has no subject',
    focus: '"belirli tanımlık -en/-et", "geçmiş zaman -te", "ikinci sırada fiil"',
  },
};

function systemPrompt(learning: Learning): string {
  const d = DIRECTIONS[learning];
  return `You are a ${d.target} teacher writing material for a ${d.native} speaker.

Your student reads ${d.native} natively and is learning ${d.target}. Every
explanation you write is in ${d.native}. The ${d.target} is the thing being
learned, so it is never explained away in English.

You produce one sentence at a time, cut into pieces that can be printed in
columns underneath the ${d.target}, so the student can see which ${d.target}
word carries which piece of the meaning.

The breakdown is the whole point, so it must be exact:
- Each piece's "target" must be spelled exactly as it appears in the sentence,
  and be a contiguous run of it. Never normalise, never give a dictionary form,
  never write "..." to skip words.
- Read left to right through the ${d.target} sentence. The pieces in order must
  cover all of it, with nothing skipped and nothing repeated. Punctuation
  between pieces is fine to leave out; a word is not.
- One ${d.target} word per piece. Group two words into one piece only for a
  fixed expression that is learned as a unit, or for a word plus the particle
  or postposition that governs it.

For each piece:
- "native" is what that piece contributes, in ${d.native}. It may read as a
  fragment out of order, because the two languages arrange a sentence
  differently. That mismatch is the lesson.
- "morphemes" splits the ${d.target} word into its root and each ending, in
  the order they are spelled, with what each one does in ${d.native}.
  ${d.morphology}
- "pos" is the word class of the piece's main word: noun, verb, adjective,
  adverb, pronoun, adposition, conjunction, numeral, determiner, interjection
  or particle. For a word plus its postposition or particle, give the class of
  the word.
- "english" is given for nouns only: the noun's dictionary form in English, one
  or two words, as in "dog" or "school bag". Leave it out for every other class.
- "note" is one sentence of ${d.native} explaining the grammar, and only when
  there is something real to say: ${d.notes}. Leave it out entirely for a plain
  word. A note that only repeats the translation is worse than no note.

Give "target" — the whole sentence on one line — before you give the pieces.
It is the thing the pieces are checked against, so it is never left out, even
though the pieces repeat it.

"native" at the top level is the natural ${d.native} sentence: what a native
speaker would actually say, with normal word order, not a word-for-word gloss.

"focus" names the one thing this sentence teaches, in ${d.native}, in a short
phrase: ${d.focus}.`;
}

function tool(learning: Learning): Anthropic.Tool {
  const d = DIRECTIONS[learning];
  return {
    name: 'post_lesson',
    description: `Report one ${d.target} sentence, broken down for a ${d.native}-speaking learner.`,
    input_schema: lessonSchema(d) as Anthropic.Tool.InputSchema,
  };
}

/** Several lessons in one report, for filling a shelf. */
function batchTool(learning: Learning): Anthropic.Tool {
  const d = DIRECTIONS[learning];
  return {
    name: 'post_lessons',
    description: `Report several ${d.target} sentences, each broken down for a ${d.native}-speaking learner.`,
    input_schema: {
      type: 'object',
      properties: {
        lessons: {
          type: 'array',
          description: 'The sentences asked for, one entry each, all different.',
          items: lessonSchema(d),
        },
      },
      required: ['lessons'],
    },
  };
}

/** The shape of one lesson as the model reports it. */
function lessonSchema(d: Direction): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      target: { type: 'string', description: `The ${d.target} sentence, exactly as it reads.` },
      native: {
        type: 'string',
        description: `The natural ${d.native} sentence, in normal word order.`,
      },
      focus: {
        type: 'string',
        description: `The one grammar point this sentence teaches, named in ${d.native}.`,
      },
      chunks: {
        type: 'array',
        description: `The ${d.target} sentence cut into pieces, in the order they appear in it, covering all of it.`,
        items: {
          type: 'object',
          properties: {
            target: {
              type: 'string',
              description: `A contiguous slice of the ${d.target} sentence, spelled exactly as it is there.`,
            },
            native: { type: 'string', description: `What this piece contributes, in ${d.native}.` },
            pos: {
              type: 'string',
              enum: [...WORD_CLASSES],
              description: "The word class of the piece's main word.",
            },
            english: {
              type: 'string',
              description:
                'Nouns only: the dictionary form of the noun in English, one or two words. Omit for other classes.',
            },
            note: {
              type: 'string',
              description: `One sentence of grammar explanation in ${d.native}. Omit when the piece has nothing to teach.`,
            },
            morphemes: {
              type: 'array',
              description:
                'Root and endings in spelling order, whose forms joined together spell the word. Omit for words with no ending.',
              items: {
                type: 'object',
                properties: {
                  form: {
                    type: 'string',
                    description: 'The root or ending as spelled inside the word.',
                  },
                  means: {
                    type: 'string',
                    description: `What it contributes, in ${d.native}.`,
                  },
                },
                required: ['form', 'means'],
              },
            },
          },
          required: ['target', 'native', 'pos'],
        },
      },
    },
    required: ['target', 'native', 'chunks'],
  };
}

export interface LessonRequest {
  learning: Learning;
  /** A sentence the learner supplied, in either language. */
  text?: string;
  /** What a generated sentence should be about. */
  topic?: string;
  level: Level;
  /** Sentences the learner has already had, so the next one is not a repeat. */
  avoid?: string[];
  /** Words from the learner's chest worth meeting again, in the target language. */
  review?: string[];
}

/**
 * With no topic given, the model reaches for the same first-year sentence
 * every time. One of these is drawn at random instead, so consecutive lessons
 * wander through different corners of everyday life.
 */
const SITUATIONS = [
  'at the market buying fruit',
  'asking for directions in a city',
  'ordering food at a restaurant',
  'talking about the weather',
  'a phone call with a friend',
  'at the doctor',
  'looking for a flat to rent',
  'a birthday party',
  'on the bus or train',
  'cooking dinner at home',
  'at the airport',
  'meeting a neighbour',
  'a day at the beach',
  'walking the dog',
  'at work, a meeting',
  'shopping for clothes',
  'a football match',
  'visiting grandparents',
  'at the pharmacy',
  'planning a holiday',
  'in the library',
  'a rainy morning',
  'at the gym',
  'a wedding',
  'losing your keys',
  'at the hairdresser',
  'a picnic in the park',
  'a late night with friends',
  'the first day at a new job',
  'at the bank',
  'gardening',
  'a cat and a bird',
  'a broken phone',
  'a long queue',
  'cleaning the house',
  'a school trip',
  'a snowy day',
  'at the cinema',
  'writing a letter',
  'a trip to the mountains',
];

function randomSituation(): string {
  return SITUATIONS[Math.floor(Math.random() * SITUATIONS.length)] ?? SITUATIONS[0]!;
}

/** Several different situations, one per sentence asked for. */
function randomSituations(count: number): string[] {
  const picked = new Set<string>();
  while (picked.size < Math.min(count, SITUATIONS.length)) picked.add(randomSituation());
  return [...picked];
}

function brief({ learning, text, topic, level, avoid, review }: LessonRequest, count = 1): string {
  const d = DIRECTIONS[learning];
  if (text) {
    return (
      `Here is a sentence from the student. It may be written in ${d.native} or in ${d.target}.\n` +
      `If it is ${d.native}, translate it into natural ${d.target} and break that down.\n` +
      `If it is already ${d.target}, keep it as it is and break it down.\n\n` +
      `<sentence>\n${text}\n</sentence>`
    );
  }
  let about = `\n\nThe sentence should be about: ${topic ?? randomSituation()}`;
  if (count > 1) {
    about = topic
      ? `\n\nThe sentences should all be about: ${topic}, each from a different angle.`
      : `\n\nThe sentences should be about, one each:\n` +
        randomSituations(count)
          .map((situation) => `- ${situation}`)
          .join('\n');
  }
  const seen = avoid?.length
    ? `\n\nThe student has already had these sentences. Do not repeat or lightly reword any of them; use different vocabulary and a different structure:\n` +
      avoid.map((sentence) => `- ${sentence}`).join('\n')
    : '';
  // Words come back: the sentence is a chance to meet them again, as long as
  // they belong in it. One or two, never a list crammed in.
  const comeback = review?.length
    ? `\n\nThe student has met these ${d.target} words before and should meet them again. Work one or two of them into the sentence where they fit naturally, in whatever form the grammar needs. Leave out any that would make the sentence contrived:\n` +
      review.map((word) => `- ${word}`).join('\n')
    : '';
  if (count > 1) {
    return (
      `Write ${count} different ${d.target} sentences for the student and break each one down. ` +
      `Vary the vocabulary and the structure from one sentence to the next; no two should share their main verb.\n\n` +
      `Each sentence: ${d.level[level]}${about}${seen}${comeback}`
    );
  }
  return `Write one ${d.target} sentence for the student and break it down.\n\n${d.level[level]}${about}${seen}${comeback}`;
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
  target: string;
  native: string;
  pos?: WordClass;
  english?: string;
  note?: string;
  morphemes?: unknown;
}

function wordClass(value: unknown): WordClass | undefined {
  return WORD_CLASSES.find((candidate) => candidate === value);
}

/** A short English noun phrase, letters and spaces only; anything else is dropped. */
function englishNoun(value: unknown, pos: WordClass | undefined): string | undefined {
  if (pos !== 'noun' || typeof value !== 'string') return undefined;
  const word = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return /^[a-z][a-z' -]{0,39}$/.test(word) ? word : undefined;
}

/** Keeps the breakdown entries that have both sides filled in. */
function parseRawChunks(value: unknown): RawChunk[] {
  if (!Array.isArray(value)) return [];

  const chunks: RawChunk[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { target, native, pos, english, note, morphemes } = entry as Record<string, unknown>;
    if (typeof target !== 'string' || typeof native !== 'string') continue;
    if (!target.trim() || !native.trim()) continue;
    const kind = wordClass(pos);
    const gloss = englishNoun(english, kind);
    chunks.push({
      target: target.trim(),
      native: native.trim(),
      ...(kind ? { pos: kind } : {}),
      ...(gloss ? { english: gloss } : {}),
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
 * Each chunk's target text is replaced by the exact slice of the sentence it
 * matched, so what the page prints in the columns is the sentence itself.
 *
 * @returns the chunks, or an empty array when the breakdown does not fit, in
 *   which case the page shows the sentence without columns rather than showing
 *   a pairing that is wrong.
 */
function alignChunks(chunks: RawChunk[], sentence: string): LessonChunk[] {
  const spans = align(sentence, chunks.map(({ target }) => target));
  if (!spans) {
    console.warn(
      `Dropping breakdown: pieces do not reconstruct ${JSON.stringify(sentence)}: ` +
        chunks.map(({ target }) => JSON.stringify(target)).join(', '),
    );
    return [];
  }

  return chunks.map((chunk, index) => {
    const span = spans[index];
    const exact = span ? sentence.slice(span.at, span.end) : chunk.target;
    const morphemes = parseMorphemes(chunk.morphemes, exact);
    return {
      target: exact,
      native: chunk.native,
      ...(chunk.pos ? { pos: chunk.pos } : {}),
      ...(chunk.english ? { english: chunk.english } : {}),
      ...(chunk.note ? { note: chunk.note } : {}),
      ...(morphemes ? { morphemes } : {}),
    };
  });
}

/**
 * Builds one lesson: a sentence in the language being learned, its natural
 * counterpart in the learner's language, and the piece-by-piece breakdown that
 * lines the two up.
 *
 * A breakdown that does not fit the sentence is dropped rather than shown, so
 * the sentence is asked for twice before giving up: a second attempt usually
 * lands, and a lesson without its columns is barely a lesson.
 */
export async function lesson(request: LessonRequest, attempts = 2): Promise<Lesson> {
  let last: Lesson | undefined;
  const postLesson = tool(request.learning);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await client().messages.create({
      model: config.model,
      // A morpheme split for every word adds up, and an advanced sentence is
      // both longer and more heavily suffixed than a beginner's.
      max_tokens: 8192,
      system: systemPrompt(request.learning),
      tools: [postLesson],
      tool_choice: { type: 'tool', name: postLesson.name },
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

    const made = buildLesson(block.input, request.learning);
    if (!made) {
      console.warn('Claude returned a lesson with neither a sentence nor pieces; asking again.');
      continue;
    }
    last = made;
    if (last.chunks.length > 0) return last;
  }

  if (!last) throw new Error('Claude returned no usable lesson after two attempts.');
  return last;
}

/**
 * Builds several lessons in one call, for filling a shelf: the model spreads
 * the sentences out itself, which one call at a time never managed. Only the
 * lessons whose breakdown fits are returned; a bad one costs nothing but its
 * place in the batch.
 */
export async function lessons(request: LessonRequest, count: number): Promise<Lesson[]> {
  if (count <= 1) return [await lesson(request)];
  const postLessons = batchTool(request.learning);
  // Streamed, since the SDK will not wait on a plain call with this much room
  // for output; the whole message is still collected before it is read.
  const response = await client()
    .messages.stream({
      model: config.model,
      // Room for every sentence with its split; a cut-off batch loses only its tail.
      max_tokens: Math.min(32000, 6000 * count),
      system: systemPrompt(request.learning),
      tools: [postLessons],
      tool_choice: { type: 'tool', name: postLessons.name },
      messages: [{ role: 'user', content: brief(request, count) }],
    })
    .finalMessage();
  if (response.stop_reason === 'max_tokens') {
    console.warn(`A batch of ${count} lessons came back cut off at max_tokens.`);
  }

  const block = response.content.find((part) => part.type === 'tool_use');
  const input = block ? (block.input as Record<string, unknown>) : {};
  const entries = Array.isArray(input.lessons) ? input.lessons : [];
  const made: Lesson[] = [];
  for (const entry of entries) {
    const built = buildLesson(entry, request.learning);
    if (built && built.chunks.length > 0) made.push(built);
  }
  if (made.length < entries.length) {
    console.warn(`Batch of ${count}: ${made.length} of ${entries.length} lessons usable.`);
  }
  return made;
}

/** One lesson from what the model reported, or undefined when there is no sentence in it. */
function buildLesson(value: unknown, learning: Learning): Lesson | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const native = typeof input.native === 'string' ? input.native.trim() : '';
  const chunks = parseRawChunks(input.chunks);
  // On a long sentence the model sometimes skips the whole-sentence field and
  // gives only the pieces, which are the sentence anyway. Rebuilding it from
  // them costs a real check — the pieces then line up by construction — but
  // that beats refusing a lesson that is otherwise complete.
  const given = typeof input.target === 'string' ? input.target.trim() : '';
  const target = given || rejoin(chunks.map((chunk) => chunk.target));
  if (!target || !native) return undefined;

  return {
    learning,
    target,
    native,
    chunks: alignChunks(chunks, target),
    ...(typeof input.focus === 'string' && input.focus.trim() ? { focus: input.focus.trim() } : {}),
  };
}
