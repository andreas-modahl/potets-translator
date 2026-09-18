/** Match every spoken word to a lesson chunk, preserving repeated occurrences. */
export function speechTimeline(sentence, chunks, words, locale) {
  const letters = text => text.normalize('NFC').toLocaleLowerCase(locale).replace(/[^\p{L}\p{N}]/gu, '');
  const expected = letters(sentence);
  if (!Array.isArray(words) || words.map(word => letters(word.text)).join('') !== expected ||
      chunks.map(chunk => letters(chunk.target)).join('') !== expected) return [];
  let offset = 0;
  const spans = chunks.map(chunk => {
    const start = offset;
    offset += letters(chunk.target).length;
    return { start, end: offset };
  });
  offset = 0;
  return words.map(word => {
    const start = offset;
    offset += letters(word.text).length;
    const index = spans.findIndex(span => span.start <= start && span.end >= offset);
    return { start: word.start, end: word.end, index };
  });
}

export function spokenChunk(timeline, milliseconds) {
  return timeline.find(word => word.start <= milliseconds && milliseconds < word.end)?.index ?? -1;
}
