import { audioClip, SUBTITLE_CHUNK_MS } from './subtitle-chunks.js';
import type { SubtitleCue, SubtitlePhrase } from './subtitles.js';
import { SubtitleError } from './subtitles.js';

export interface SubtitleSection {
  start: number; end: number;
  state: 'pending' | 'loading' | 'done' | 'error';
  attempts: number;
  error?: string;
}
export function makeSections(duration: number): SubtitleSection[] {
  return Array.from({ length: Math.ceil(duration / SUBTITLE_CHUNK_MS) }, (_, index) => ({
    start: index * SUBTITLE_CHUNK_MS, end: Math.min((index + 1) * SUBTITLE_CHUNK_MS, duration),
    state: 'pending', attempts: 0,
  }));
}

/** Start at the viewer, continue forward, then fill earlier unfinished sections. */
export function nextSection(sections: SubtitleSection[], position: number): SubtitleSection | undefined {
  const index = sections.findIndex(section => section.end > position);
  const current = index < 0 ? Math.max(0, sections.length - 1) : index;
  for (let offset = 0; offset < sections.length; offset++) {
    const section = sections[(current + offset) % sections.length]!;
    if (section.state === 'pending') return section;
  }
}

/** Midpoint ownership plus clipping lets adjacent sections finish in any order. */
export async function sectionPhrases(pcm: Buffer, section: SubtitleSection,
  transcribe: (wav: Buffer) => Promise<SubtitlePhrase[]>, existing: SubtitleCue[]): Promise<SubtitlePhrase[]> {
  const offset = Math.max(0, section.start - 1000);
  const result = await transcribe(audioClip(pcm, offset, Math.min(pcm.length / 32, section.end + 1000)));
  const phrases: SubtitlePhrase[] = [];
  for (const phrase of result) {
    let group: SubtitlePhrase | undefined;
    for (const word of phrase.words) {
      const start = word.start + offset, end = word.end + offset, midpoint = (start + end) / 2;
      if (midpoint < section.start || midpoint >= section.end || existing.some(cue => start < cue.end && end > cue.start)) {
        group = undefined; continue;
      }
      const timed = { ...word, start: Math.max(section.start, start), end: Math.min(section.end, end) };
      if (timed.end <= timed.start) continue;
      if (!group) { group = { text: '', words: [] }; phrases.push(group); }
      group.words.push(timed); group.text = group.words.map(item => item.text).join(' ');
    }
  }
  return phrases;
}

/** Three sections in flight, at most three attempts per section across restarts. */
export async function fillSections(sections: SubtitleSection[], signal: AbortSignal,
  process: (section: SubtitleSection) => Promise<void>, changed: () => void,
  concurrency = 3, position: () => number = () => 0): Promise<void> {
  for (const section of sections) {
    if (section.state === 'loading') section.state = section.attempts >= 3 ? 'error' : 'pending';
  }
  let providerError: SubtitleError | undefined;
  async function worker() {
    while (!signal.aborted && !providerError) {
      const section = nextSection(sections, position());
      if (!section) return;
      section.state = 'loading'; section.attempts++; delete section.error; changed();
      try {
        await process(section);
        signal.throwIfAborted();
        section.state = 'done';
      } catch (error) {
        section.error = error instanceof Error ? error.message : 'Kunne ikke oversette delen.';
        if (error instanceof SubtitleError && error.status === 429) providerError = error;
        section.state = providerError || signal.aborted || section.attempts >= 3 ? 'error' : 'pending';
      }
      changed();
      if (section.state === 'pending') {
        // Back off on provider errors; abort still settles all workers before cleanup.
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, section.attempts * 2000);
          signal.addEventListener('abort', finish, { once: true });
          if (signal.aborted) finish();
        });
      }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  if (providerError) throw providerError;
}
