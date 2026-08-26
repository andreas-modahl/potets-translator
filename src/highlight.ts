/**
 * Regions of a Discord message that must never be touched: bolding inside a
 * mention, a custom emoji, a URL or a code span would break it rather than
 * decorate it.
 */
const PROTECTED =
  /(```[\s\S]*?```|`[^`]*`|<a?:\w+:\d+>|<[@#][!&]?\d+>|<t:\d+(?::[tTdDfFR])?>|https?:\/\/\S+)/gu;

/** True when the position sits inside an already-emphasised span. */
function insideBold(text: string, index: number): boolean {
  const markers = text.slice(0, index).split('**').length - 1;
  return markers % 2 === 1;
}

/**
 * Wraps each chunk in bold the first time it appears in the text.
 *
 * Chunks are matched case-insensitively and applied longest first, so a longer
 * phrase wins over a shorter one nested inside it. A chunk that cannot be found
 * is skipped rather than forced, since the model occasionally reports a chunk
 * in a different form than it used in the sentence.
 */
export function highlight(text: string, chunks: string[]): string {
  const wanted = chunks.map((chunk) => chunk.trim()).filter(Boolean);
  if (wanted.length === 0) return text;

  const ordered = [...wanted].sort((a, b) => b.length - a.length);
  const done = new Set<string>();

  // split() with a capturing group keeps the protected regions, at odd indices.
  return text
    .split(PROTECTED)
    .map((part, index) => {
      if (index % 2 === 1) return part;

      let out = part;
      for (const chunk of ordered) {
        const key = chunk.toLowerCase();
        if (done.has(key)) continue;

        const at = out.toLowerCase().indexOf(key);
        if (at === -1 || insideBold(out, at)) continue;

        out = `${out.slice(0, at)}**${out.slice(at, at + chunk.length)}**${out.slice(at + chunk.length)}`;
        done.add(key);
      }
      return out;
    })
    .join('');
}
