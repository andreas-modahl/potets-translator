/** Stable visual vocabulary for optional hints about Turkish endings. */
export const SUFFIX_HINTS = {
  past: { emoji: '⏪', label: 'Fortid' },
  future: { emoji: '🔮', label: 'Framtid' },
  reported: { emoji: '🗣️', label: 'Gjenfortalt / indirekte erfart' },
  plural: { emoji: '👥', label: 'Flertall' },
  negative: { emoji: '🚫', label: 'Nektelse' },
  question: { emoji: '❓', label: 'Spørsmål' },
  possession: { emoji: '🔗', label: 'Eieforhold' },
  to: { emoji: '➡️', label: 'Til / mot' },
  from: { emoji: '⬅️', label: 'Fra' },
  location: { emoji: '📍', label: 'I / på / ved' },
  with: { emoji: '🤝', label: 'Med / sammen med' },
  ability: { emoji: '💪', label: 'Kan / evne til' },
};

export function validEmojiHint(value) {
  return Boolean(value && typeof value === 'object' && typeof value.emoji === 'string' && value.emoji.length <= 24 &&
    (value.emoji === '' || /^[0-9#*]\uFE0F?\u20E3$/u.test(value.emoji) || (/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(value.emoji) && !/[\p{L}\p{N}]/u.test(value.emoji))) &&
    Array.isArray(value.suffixes) && value.suffixes.length <= 3 && value.suffixes.every(suffix => suffix &&
      Object.hasOwn(SUFFIX_HINTS, suffix.kind) && typeof suffix.form === 'string' && suffix.form.trim().length > 0 && suffix.form.length <= 40));
}

/** Only reuse the original meaning alignment while the wording still matches. */
export function mappedChunks(cue) {
  const normalize = text => text.replace(/\s+/gu, ' ').trim();
  return cue?.chunks?.length && normalize(cue.chunks.map(chunk => chunk.text).join(' ')) === normalize(cue.text)
    ? cue.chunks : [];
}

/** Pause after complete meaning groups; use the cue's spoken range if alignment was edited away. */
export function pauseSegments(cues) {
  return cues.flatMap(cue => {
    const chunks = mappedChunks(cue);
    return chunks.length ? chunks : [{ start: cue.words?.[0]?.start ?? cue.start, end: cue.words?.at(-1)?.end ?? cue.end }];
  });
}

/** Keep natural wording intact; only highlight verified, non-overlapping substrings. */
export function naturalSegments(text, links, chunkCount) {
  if (typeof text !== 'string' || !Array.isArray(links) || !links.length || !chunkCount) return [];
  const segments = [];
  const occurrences = new Map();
  const located = [];
  const word = char => char && /[\p{L}\p{N}]/u.test(char);
  for (const link of links) {
    if (!link || typeof link.text !== 'string' || !link.text.trim() || !Array.isArray(link.chunks) ||
        !link.chunks.every(index => Number.isInteger(index) && index >= 0 && index < chunkCount)) return [];
    let start = text.indexOf(link.text, occurrences.get(link.text) || 0);
    while (start >= 0 && ((word(text[start - 1]) && word(link.text[0])) ||
      (word(link.text.at(-1)) && word(text[start + link.text.length])) ||
      located.some(part => start < part.start + part.link.text.length && start + link.text.length > part.start))) {
      start = text.indexOf(link.text, start + 1);
    }
    if (start < 0) return [];
    occurrences.set(link.text, start + link.text.length);
    located.push({ link, start });
  }
  let at = 0;
  for (const { link, start } of located.sort((a, b) => a.start - b.start)) {
    if (start < at) return [];
    // Never highlight part of a word or silently skip untranslated words.
    if ((word(text[start - 1]) && word(link.text[0])) ||
        (word(link.text.at(-1)) && word(text[start + link.text.length])) ||
        /[\p{L}\p{N}]/u.test(text.slice(at, start))) return [];
    if (start > at) segments.push({ text: text.slice(at, start), chunks: [] });
    segments.push({ text: link.text, chunks: link.chunks });
    at = start + link.text.length;
  }
  if (/[\p{L}\p{N}]/u.test(text.slice(at))) return [];
  if (at < text.length) segments.push({ text: text.slice(at), chunks: [] });
  return segments.some(segment => segment.chunks.length) ? segments : [];
}

/** Keep brief timing gaps smooth, but never leave an old subtitle over a long gap. */
export function captionPage(pages, time, preview = false) {
  const timed = pages.filter(page => page.words?.length);
  const active = timed.find(page => time >= page.words[0].start && time < page.words.at(-1).end);
  if (active) return active;
  const previous = timed.findLast(page => page.words.at(-1).end <= time);
  if (previous && time - previous.words.at(-1).end <= 300) return previous;
  if (preview && !previous && time < timed[0]?.words[0].start) return timed[0];
}

/** Display complete sentences even when subtitle length limits created several cues. */
export function sentencePages(cues) {
  const pages = [];
  for (const cue of cues) {
    const previous = pages.at(-1);
    if (previous && !/[.!?…]["'»”’)]*$/u.test(previous.turkish.trim())) {
      previous.end = cue.end;
      previous.text += ' ' + cue.text;
      previous.turkish += ' ' + cue.turkish;
      if (cue.natural) {
        previous.naturalLinks = previous.naturalLinks && cue.naturalLinks
          ? [...previous.naturalLinks, ...cue.naturalLinks.map(link => ({ ...link, chunks: link.chunks.map(index => index + previous.chunks.length) }))]
          : undefined;
        previous.natural = [previous.natural, cue.natural].filter(Boolean).join(' ');
      }
      previous.words.push(...(cue.words || []));
      previous.chunks = previous.chunks.length && mappedChunks(cue).length
        ? [...previous.chunks, ...mappedChunks(cue)] : [];
    } else pages.push({ ...cue, words: [...(cue.words || [])], chunks: [...mappedChunks(cue)] });
  }
  return pages.flatMap(page => {
    if (page.words.length <= 20 && page.end - page.start <= 14000) return [page];
    const chunks = mappedChunks(page);
    if (!chunks.length) return [page];
    const sections = [];
    let section;
    for (const chunk of chunks) {
      const words = page.words.filter(word => word.start >= chunk.start && word.end <= chunk.end);
      if (!words.length) return [page];
      const previous = section?.words.at(-1);
      const split = section && (section.words.length + words.length > 12 || chunk.end - section.start > 8000 ||
        /[.!?…]["'»”’)]*$/u.test(previous.text) || (words[0].start - previous.end >= 600 && section.words.length >= 4));
      if (!section || split) {
        // A whole-sentence translation cannot be reused for just one of its parts.
        section = { start: words[0].start, end: chunk.end, text: '', turkish: '', words: [], chunks: [] };
        sections.push(section);
      }
      section.end = chunk.end;
      section.words.push(...words);
      section.chunks.push(chunk);
      section.text = section.chunks.map(part => part.text).join(' ');
      section.turkish = section.words.map(word => word.text).join(' ');
    }
    return sections.reduce((count, part) => count + part.words.length, 0) === page.words.length ? sections : [page];
  });
}

/** Sentence punctuation and long pauses define short, repeatable speech units. */
export function sentenceAt(cues, time) {
  const words = cues.flatMap(cue => cue.words || []);
  if (!words.length) return cues.find(cue => cue.end > time + 1);
  const sentences = [];
  let sentence;
  let previous;
  for (const word of words) {
    if (!sentence || word.start - previous.end >= 800 || /[.!?…]["'»”’)]*$/u.test(previous.text)) {
      sentence = { start: word.start, end: word.end };
      sentences.push(sentence);
    } else sentence.end = word.end;
    previous = word;
  }
  return sentences.find(sentence => sentence.end > time + 1);
}

/** Subtitle files are plain text: prevent user text being interpreted as cue markup. */
export function cueText(text) {
  return text.replace(/\s+/gu, ' ').trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function timestamp(milliseconds, separator = ',') {
  const value = Math.round(milliseconds);
  const pad = (number, length = 2) => String(number).padStart(length, '0');
  return `${pad(Math.floor(value / 3600000))}:${pad(Math.floor(value / 60000) % 60)}:${pad(Math.floor(value / 1000) % 60)}${separator}${pad(value % 1000, 3)}`;
}

export function wrapText(text) {
  const words = text.replace(/\s+/gu, ' ').trim().split(' ');
  const lines = [''];
  for (const word of words) {
    const last = lines.length - 1;
    if (lines[last] && lines[last].length + word.length + 1 > 42) lines.push(word);
    else lines[last] += (lines[last] ? ' ' : '') + word;
  }
  return lines.join('\n');
}

export function validateCues(cues) {
  if (!cues.length) throw new Error('Ingen undertekster å laste ned.');
  let end = 0;
  for (const [index, cue] of cues.entries()) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < end ||
        Math.round(cue.end) <= Math.round(cue.start) || cue.end > 600000 || !cue.text.trim()) {
      throw new Error(`Rett tekst eller tider i undertekst ${index + 1}. Tidene må være i rekkefølge, uten overlapp.`);
    }
    end = cue.end;
  }
}

export function serializeSubtitles(cues, format) {
  validateCues(cues);
  const separator = format === 'vtt' ? '.' : ',';
  const body = cues.map((cue, index) => `${index + 1}\n${timestamp(cue.start, separator)} --> ${timestamp(cue.end, separator)}\n${wrapText(cue.text).split('\n').map(cueText).join('\n')}\n`).join('\n');
  return (format === 'vtt' ? 'WEBVTT\n\n' : '') + body;
}
