/** Anything that is not a letter or a digit: spaces, commas, question marks. */
const NOISE_ONLY = /^[^\p{L}\p{N}]*$/u;
const EDGE_NOISE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

export interface Span {
  /** Index of the chunk in the sentence. */
  at: number;
  /** Index just past it. */
  end: number;
}

/**
 * Locates each chunk in the sentence, in order and without overlapping.
 *
 * The whole point of the side-by-side layout is that the column above a
 * Norwegian gloss really is the Turkish it glosses, so a breakdown that does
 * not line up with the sentence is worse than no breakdown at all: it teaches
 * the reader something false. This is the check that decides which it is.
 *
 * A breakdown passes only when the chunks, read in order, walk the whole
 * sentence from start to end. Anything skipped between two chunks must be
 * punctuation or spacing — a skipped *word* means the model dropped part of the
 * sentence, and the reader would never know it was missing.
 *
 * @returns one span per chunk, or `undefined` if the chunks do not fit.
 */
export function align(sentence: string, chunks: string[]): Span[] | undefined {
  if (chunks.length === 0) return undefined;

  const spans: Span[] = [];
  let cursor = 0;

  for (const chunk of chunks) {
    // The model sometimes hands back a chunk with the sentence's punctuation
    // attached, or with quotes around it. Retrying without the edges finds it
    // rather than failing the whole breakdown over a comma.
    const candidates = [chunk.trim(), chunk.trim().replace(EDGE_NOISE, '')];
    const found = candidates
      .filter(Boolean)
      .map((text) => ({ at: sentence.indexOf(text, cursor), length: text.length }))
      .find(({ at }) => at !== -1);
    if (!found) return undefined;

    // Text jumped over between the previous chunk and this one. Punctuation is
    // fine; a word is not.
    if (!NOISE_ONLY.test(sentence.slice(cursor, found.at))) return undefined;

    spans.push({ at: found.at, end: found.at + found.length });
    cursor = found.at + found.length;
  }

  return NOISE_ONLY.test(sentence.slice(cursor)) ? spans : undefined;
}
