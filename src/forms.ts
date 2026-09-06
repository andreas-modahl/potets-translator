import type Anthropic from '@anthropic-ai/sdk';
import { client } from './claude.js';
import { config } from './config.js';
import { spellsWord, type Learning } from './lesson.js';

/**
 * The forms of one word: everything the language makes of it, laid out so the
 * page can show a table. A Turkish verb gives persons by tenses, a Turkish
 * noun cases by number, a Norwegian verb its tenses in a row, a Norwegian
 * noun the definite and indefinite in singular and plural.
 *
 * The model is asked once per word, and the answer is kept in the pool
 * database, since a word's forms never change.
 */

export interface WordForm {
  /** What this form is: the person, the case, the tense. In the learner's language, with the target-language pronoun where there is one. */
  label: string;
  /** The form itself, spelled exactly. */
  word: string;
  /** The word cut into root and endings, in spelling order; the root alone for a bare form. */
  pieces: string[];
}

export interface FormGroup {
  /** The tense, the number, or whatever the column is: in the learner's language. */
  name: string;
  /** The ending that makes this group, such as "-iyor", when there is one. */
  hint?: string;
  forms: WordForm[];
}

export interface Forms {
  learning: Learning;
  /** The word as asked for. */
  word: string;
  /** The dictionary form: the infinitive, the bare noun. */
  base: string;
  /** What the base means, in the learner's language. */
  meaning: string;
  /** The columns of the table. Empty for a word that does not inflect. */
  groups: FormGroup[];
}

export interface FormsRequest {
  learning: Learning;
  word: string;
  /** The word class the page knows for the word, if it knows one. */
  pos?: string;
}

interface Guide {
  target: string;
  native: string;
  /** What to lay out, per word class, and how to label it. */
  layout: string;
}

const GUIDES: Record<Learning, Guide> = {
  tr: {
    target: 'Turkish',
    native: 'Norwegian (bokmål)',
    layout: `For a verb, give four groups, one per tense, in this order, named "presens", "preteritum",
"futurum" and "aorist", with the tense ending as the hint: "-iyor", "-di", "-ecek", "-ir", spelled as it
comes out for this word. Each group has six forms, in this order, labelled with the Turkish pronoun and
its Norwegian in brackets: "ben (jeg)", "sen (du)", "o (han/hun)", "biz (vi)", "siz (dere)",
"onlar (de)". Give the positive forms only.
For a noun, give two groups, "entall" and "flertall", each with six forms, in this order, labelled with
the case in Norwegian and the ending in brackets: "nominativ", "akkusativ (-i)", "dativ (-e)",
"lokativ (-de)", "ablativ (-den)", "genitiv (-in)". Use the endings as they come out for this word after
vowel harmony and consonant changes.
For an adjective or an adverb, give one group "grader" with the plain form and "daha" and "en" forms.
For a pronoun or anything else that does not inflect, give no groups.`,
  },
  nb: {
    target: 'Norwegian (bokmål)',
    native: 'Turkish',
    layout: `For a verb, give one group named "zamanlar" with five forms, in this order, labelled in Turkish
with the Norwegian name in brackets: "mastar (infinitiv)", "şimdiki zaman (presens)",
"geçmiş zaman (preteritum)", "yakın geçmiş (perfektum)", "emir (imperativ)". Write the infinitive with "å".
For a noun, give two groups, "belirsiz (ubestemt)" and "belirli (bestemt)", each with two forms labelled
"tekil (entall)" and "çoğul (flertall)". Put the article in the indefinite singular form, as in "en hund".
For an adjective, give one group "dereceler" with the positive, comparative and superlative, and one group
"uyum" with the forms after "en", "et" and in plural.
For a pronoun or anything else that does not inflect, give no groups.`,
  },
};

function systemPrompt(learning: Learning): string {
  const g = GUIDES[learning];
  return `You lay out the forms of one ${g.target} word for a ${g.native}-speaking learner: a small
table of what the language makes of it.

${g.layout}

"base" is the dictionary form: the infinitive of a verb, the bare singular of a noun. "meaning" is what
it means, in ${g.native}, a word or two.

"pieces" cuts each form into its root and each ending, in the order they are spelled, so that the pieces
joined together spell the form exactly. Give the changed root where the word changes it: "gidiyorum" is
"gid" + "iyor" + "um", "köpeğim" is "köpeğ" + "im". A bare form is one piece. Every group name, label and
meaning is in ${g.native}; every form is in ${g.target}.`;
}

function tool(): Anthropic.Tool {
  return {
    name: 'post_forms',
    description: 'Report the forms of the word, laid out in groups.',
    input_schema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'The dictionary form of the word.' },
        meaning: { type: 'string', description: "What the base means, in the learner's language." },
        groups: {
          type: 'array',
          description: 'The columns of the table: tenses for a verb, numbers for a noun. Empty when the word does not inflect.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: "The group's name, in the learner's language." },
              hint: { type: 'string', description: 'The ending that makes this group, such as "-iyor". Omit when there is none.' },
              forms: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'The person, case or tense of this form.' },
                    word: { type: 'string', description: 'The form, spelled exactly.' },
                    pieces: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Root and endings in spelling order, joining to spell the form.',
                    },
                  },
                  required: ['label', 'word', 'pieces'],
                },
              },
            },
            required: ['name', 'forms'],
          },
        },
      },
      required: ['base', 'meaning', 'groups'],
    },
  };
}

function text(value: unknown, limit = 80): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

/**
 * Reads the model's report into a table, keeping only what holds together: a
 * form is kept when it has a label and a word, and its pieces only when they
 * spell it, else the word stands as one piece.
 */
export function buildForms(input: unknown, request: FormsRequest): Forms {
  const raw = (input ?? {}) as Record<string, unknown>;
  const groups: FormGroup[] = [];
  for (const entry of Array.isArray(raw.groups) ? raw.groups : []) {
    const group = (entry ?? {}) as Record<string, unknown>;
    const name = text(group.name);
    if (!name) continue;
    const forms: WordForm[] = [];
    for (const item of Array.isArray(group.forms) ? group.forms : []) {
      const form = (item ?? {}) as Record<string, unknown>;
      const label = text(form.label);
      const word = text(form.word);
      if (!label || !word) continue;
      const given = Array.isArray(form.pieces) ? form.pieces.map((piece) => text(piece)).filter(Boolean) : [];
      const pieces = given.length > 0 && spellsWord(given, word) ? given : [word];
      forms.push({ label, word, pieces });
    }
    if (forms.length === 0) continue;
    const hint = text(group.hint, 20);
    groups.push({ name, ...(hint ? { hint } : {}), forms });
  }
  return {
    learning: request.learning,
    word: request.word,
    base: text(raw.base) || request.word,
    meaning: text(raw.meaning),
    groups,
  };
}

export async function forms(request: FormsRequest): Promise<Forms> {
  const postForms = tool();
  const ask = request.pos ? `The word: "${request.word}", a ${request.pos}.` : `The word: "${request.word}".`;
  const response = await client().messages.create({
    model: config.model,
    max_tokens: 4096,
    system: systemPrompt(request.learning),
    tools: [postForms],
    tool_choice: { type: 'tool', name: postForms.name },
    messages: [{ role: 'user', content: ask }],
  });
  const block = response.content.find((part) => part.type === 'tool_use');
  if (!block) throw new Error('Claude returned no post_forms tool call.');
  return buildForms(block.input, request);
}
