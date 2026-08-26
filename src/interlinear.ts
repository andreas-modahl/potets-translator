import type { GlossPair } from './translate.js';

/** Between one column and the next. */
const COLUMN_GAP = '  ';

/**
 * The width at which a row is broken and continued underneath. Rows are kept
 * strictly below this, so the widest is 44 characters.
 *
 * Discord wraps long lines inside a code block rather than scrolling them, and
 * a wrapped line destroys the column alignment this whole layout depends on.
 * Breaking the rows ourselves keeps the pairing readable on narrow clients.
 */
const WRAP_AT = 45;

function tidy(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

/**
 * Lays the translation above the original in aligned columns:
 *
 *     hava güzel       ve  kuşlar ötüyor
 *     det er fint vær  og  fuglene synger
 *
 * The translation leads and keeps its own word order; the original follows
 * underneath, piece by piece, which means it can read out of order when the two
 * languages arrange things differently. Only one of the two can read straight
 * through, and it is the translation.
 *
 * Only meaningful in a monospace context — the padding is plain spaces, so it
 * lines up exactly when every character is the same width and not otherwise.
 */
export function interlinear(gloss: GlossPair[]): string {
  const columns = gloss
    .map(({ source, target }) => ({ source: tidy(source), target: tidy(target) }))
    .filter(({ source, target }) => source || target)
    .map(({ source, target }) => {
      const width = Math.max(source.length, target.length);
      return { source: source.padEnd(width), target: target.padEnd(width) };
    });

  if (columns.length === 0) return '';

  const rows: Array<{ source: string; target: string }> = [];
  let row: { source: string; target: string } | undefined;

  for (const column of columns) {
    if (!row) {
      row = { ...column };
      continue;
    }
    // A single column wider than the limit cannot be broken any further, so it
    // gets a row of its own and overflows rather than being cut apart.
    if (row.source.length + COLUMN_GAP.length + column.source.length >= WRAP_AT) {
      rows.push(row);
      row = { ...column };
      continue;
    }
    row = {
      source: row.source + COLUMN_GAP + column.source,
      target: row.target + COLUMN_GAP + column.target,
    };
  }
  if (row) rows.push(row);

  return rows
    .map(({ source, target }) => `${target.trimEnd()}\n${source.trimEnd()}`)
    .join('\n\n');
}
