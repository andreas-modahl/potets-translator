/** Only reuse the original meaning alignment while the wording still matches. */
export function mappedChunks(cue) {
  const normalize = text => text.replace(/\s+/gu, ' ').trim();
  return cue?.chunks?.length && normalize(cue.chunks.map(chunk => chunk.text).join(' ')) === normalize(cue.text)
    ? cue.chunks : [];
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
