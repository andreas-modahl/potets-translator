// Run against your existing local dev server: node scripts/translate-storybook.mjs
// Existing translations are reused; only missing stories call the paid services.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { serializeSubtitles } from '../public/subtitles-format.js';
const root = new URL('../storybook/', import.meta.url);
const sources = JSON.parse(await readFile(new URL('sources.json', root), 'utf8'));
const base = 'http://localhost:3000/api/subtitles';
async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
for (const filename of (await readdir(root)).filter(name => name.endsWith('.mp3')).sort()) {
  const stem = filename.slice(0, -4);
  const output = new URL(`${stem}.translation.json`, root);
  let translation;
  try { translation = JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!translation) {
    console.log(`Generating ${filename}`);
    const { id } = await request(base, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(filename) }, body: await readFile(new URL(filename, root)) });
    try {
      let progress;
      while (true) {
        const job = await request(`${base}/${id}`);
        const next = `${stem}: ${job.state} ${job.completed}/${job.total}`;
        if (next !== progress) { console.log(next); progress = next; }
        if (job.state === 'error') throw new Error(job.error);
        if (job.state === 'done') {
          translation = { title: sources.find(s => s.stem === stem)?.title || stem, source: filename, sourceLanguage: 'tr', targetLanguage: 'nb', wordOrder: 'tr', cues: job.cues };
          await writeFile(output, JSON.stringify(translation, null, 2) + '\n', { flag: 'wx' });
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } finally { await fetch(`${base}/${id}`, { method: 'DELETE' }); }
  }
  for (const format of ['srt', 'vtt']) await writeFile(new URL(`${stem}.nb.${format}`, root), serializeSubtitles(translation.cues, format));
  console.log(`Ready ${stem}: ${translation.cues.length} cues`);
}
