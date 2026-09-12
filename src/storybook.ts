import { readdir, readFile, stat } from 'node:fs/promises';
import { validateSaved, type SavedSubtitles } from './subtitle-store.js';

const directory = new URL('../storybook/', import.meta.url);
export async function storybook(root = directory): Promise<Array<SavedSubtitles & { shared: true }>> {
  const stories: Array<SavedSubtitles & { shared: true }> = [];
  for (const filename of await readdir(root)) {
    if (!/^[a-z0-9-]+\.translation\.json$/.test(filename)) continue;
    const stem = filename.replace('.translation.json', '');
    const file = new URL(filename, root);
    const data = validateSaved(JSON.parse(await readFile(file, 'utf8')));
    if (data.source !== `${stem}.mp3`) throw new Error(`Story audio does not match ${filename}`);
    await stat(new URL(data.source, root));
    stories.push({ ...data, id: `storybook-${stem}`, updated: (await stat(file)).mtime.toISOString(), shared: true });
  }
  return stories.sort((a, b) => a.title.localeCompare(b.title, 'tr'));
}
export async function storyMedia(source: string): Promise<URL | undefined> {
  if (!/^[a-z0-9-]+\.mp3$/.test(source)) return;
  const file = new URL(source, directory);
  try { if ((await stat(file)).isFile()) return file; } catch {}
}
export function findStory(stories: Awaited<ReturnType<typeof storybook>>, id: string) {
  return stories.find(story => story.id === id.replace(/^example-/, 'storybook-'));
}
