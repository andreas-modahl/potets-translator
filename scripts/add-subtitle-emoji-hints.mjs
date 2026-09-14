// node --import tsx scripts/add-subtitle-emoji-hints.mjs
// Saves optional hints without changing translations, word timings or phrase links.
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { emojiHints } from '../src/subtitle-hints.ts';
import { validateSaved } from '../src/subtitle-store.ts';
import { sentencePages, mappedChunks, validEmojiHint } from '../public/subtitles-format.js';

const root = new URL('../storybook-translations/', import.meta.url);
async function generateBatch(inputs) {
  try { return await emojiHints(inputs); }
  catch (error) {
    if (!/Missing emoji hints|truncated/.test(error.message)) throw error;
    if (inputs.length <= 1) {
      console.warn(`Leaving optional hint empty: ${inputs[0].target}`);
      return [{ emoji: '', suffixes: [] }];
    }
    const middle = Math.ceil(inputs.length / 2);
    return [...await generateBatch(inputs.slice(0, middle)), ...await generateBatch(inputs.slice(middle))];
  }
}
async function addHints(filename) {
  const file = new URL(filename, root);
  let previous = await readFile(file, 'utf8');
  const data = JSON.parse(previous);
  const pending = sentencePages(data.cues).flatMap(page => mappedChunks(page).filter(chunk => !validEmojiHint(chunk.hint)).map(chunk => ({
    chunk, input: { native: chunk.text, context: page.turkish, target: page.words.filter(word => word.start >= chunk.start && word.end <= chunk.end).map(word => word.text).join(' ') },
  })));
  if (!pending.length) { console.log(`Hints ready: ${filename}`); return; }
  console.log(`Adding ${pending.length} hints: ${filename}`);
  for (let at = 0; at < pending.length; at += 20) {
    const batch = pending.slice(at, at + 20);
    const hints = await generateBatch(batch.map(item => item.input));
    batch.forEach((item, index) => { item.chunk.hint = hints[index]; });
    validateSaved(data);
    assert.equal(await readFile(file, 'utf8'), previous, 'Story changed while generating hints');
    previous = JSON.stringify(data, null, 2) + '\n';
    await writeFile(file, previous);
    console.log(`Saved ${Math.min(at + 20, pending.length)}/${pending.length}: ${filename}`);
  }
}
const files = (await readdir(root)).filter(file => file.endsWith('.translation.json')).sort();
for (let at = 0; at < files.length; at += 2) {
  const results = await Promise.allSettled(files.slice(at, at + 2).map(addHints));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}
