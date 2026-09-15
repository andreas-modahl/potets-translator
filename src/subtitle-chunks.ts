import { MAX_SUBTITLE_MS, SubtitleError, type SubtitlePhrase } from './subtitles.js';

export const SUBTITLE_CHUNK_MS = 60_000;

/** Wrap a slice of mono 16 kHz signed 16-bit PCM for the speech service. */
export function audioClip(pcm: Buffer, start: number, end: number): Buffer {
  const samples = pcm.subarray(Math.round(start * 16) * 2, Math.round(end * 16) * 2);
  const wav = Buffer.alloc(44 + samples.length);
  wav.write('RIFF'); wav.writeUInt32LE(36 + samples.length, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples.length, 40); samples.copy(wav, 44);
  return wav;
}

export async function* subtitleChunks(pcm: Buffer, transcribe: (audio: Buffer) => Promise<SubtitlePhrase[]>) {
  const duration = pcm.length / 32;
  if (!duration || duration > MAX_SUBTITLE_MS) throw new SubtitleError('Velg en video på høyst 30 minutter.');
  let previousEnd = 0;
  for (let start = 0; start < duration; start += SUBTITLE_CHUNK_MS) {
    const end = Math.min(start + SUBTITLE_CHUNK_MS, duration);
    const clipStart = Math.max(0, start - 1000);
    const clipEnd = Math.min(duration, end + 1000);
    const result = await transcribe(audioClip(pcm, clipStart, clipEnd));
    const phrases: SubtitlePhrase[] = [];
    for (const phrase of result) {
      const words = phrase.words.map(word => ({ ...word, start: word.start + clipStart, end: word.end + clipStart }))
        .filter(word => {
          const midpoint = (word.start + word.end) / 2;
          if (midpoint < start || midpoint >= end || word.start < previousEnd || word.end > duration) return false;
          previousEnd = word.end; return true;
        });
      if (words.length) phrases.push({ text: words.map(word => word.text).join(' '), words });
    }
    yield { phrases, end, duration };
  }
}
