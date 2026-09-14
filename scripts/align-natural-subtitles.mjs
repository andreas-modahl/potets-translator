// node --import tsx scripts/align-natural-subtitles.mjs
// Save phrase links for existing natural Norwegian without changing translations or timings.
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { alignNatural } from '../src/subtitle-alignment.ts';
import { validateSaved } from '../src/subtitle-store.ts';
import { sentencePages, mappedChunks, naturalSegments } from '../public/subtitles-format.js';

const root = new URL('../storybook-translations/', import.meta.url);
async function alignStory(filename) {
  const file = new URL(filename, root);
  const original = await readFile(file, 'utf8');
  const data = JSON.parse(original);
  const missing = sentencePages(data.cues).filter(page => page.natural && !naturalSegments(page.natural, page.naturalLinks, mappedChunks(page).length).length);
  if (!missing.length) { console.log(`Already linked: ${filename}`); return; }
  console.log(`Linking ${missing.length} sentences: ${filename}`);
  // Batches keep responses below the output limit. Save each batch so reruns reuse completed work.
  let previous = original;
  for (let at = 0; at < missing.length; at += 12) {
    const pages = missing.slice(at, at + 12);
    const inputs = pages.map(page => ({ natural: page.natural, chunks: mappedChunks(page).map(chunk => ({
      target: page.words.filter(word => word.start >= chunk.start && word.end <= chunk.end).map(word => word.text).join(' '), native: chunk.text,
    })) }));
    let results = await alignNatural(inputs);
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      for (let retry = 0; retry < 2 && !naturalSegments(page.natural, results[index], inputs[index].chunks.length).length; retry++) {
        console.log(`Retrying invalid links in ${filename} at ${page.start}`);
        [results[index]] = await alignNatural([inputs[index]]);
      }
      assert.ok(naturalSegments(page.natural, results[index], inputs[index].chunks.length).length, `Invalid links in ${filename} at ${page.start}`);
      data.cues.find(cue => cue.start === page.start).naturalLinks = results[index];
    }
    validateSaved(data);
    assert.equal(await readFile(file, 'utf8'), previous, 'Story changed during alignment');
    previous = JSON.stringify(data, null, 2) + '\n';
    await writeFile(file, previous);
    console.log(`Saved ${Math.min(at + 12, missing.length)}/${missing.length}: ${filename}`);
  }
}
const files = (await readdir(root)).filter(name => name.endsWith('.translation.json')).sort();
for (let at = 0; at < files.length; at += 2) {
  const results = await Promise.allSettled(files.slice(at, at + 2).map(alignStory));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}
