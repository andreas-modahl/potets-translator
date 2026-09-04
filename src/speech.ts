import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

/**
 * Turkish read aloud by Azure Speech.
 *
 * Each sentence is synthesised once and kept as an MP3 on disk, keyed by a
 * hash of the voice and the text, so stepping back through the history replays
 * without another request. The cache directory is created on first use.
 */

export const speechConfigured = Boolean(config.azureSpeechKey && config.azureSpeechRegion);

/** Azure caps SSML at a few thousand characters; a sentence is far shorter. */
const MAX_TEXT_CHARS = 500;

export class SpeechUnavailable extends Error {}

function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}

export type SpeechLang = 'tr' | 'nb';

const VOICES: Record<SpeechLang, { voice: string; locale: string }> = {
  tr: { voice: config.azureSpeechVoice, locale: 'tr-TR' },
  nb: { voice: config.azureSpeechVoiceNb, locale: 'nb-NO' },
};

/**
 * The countryball delivery: pitched up so the ball sounds small and round,
 * slowed a touch so the words stay clear enough to learn from. Both are part
 * of the cache key, so changing them regenerates the audio.
 */
const PROSODY = { pitch: config.speechPitch, rate: config.speechRate };

function cachePath(text: string, lang: SpeechLang): string {
  const key = createHash('sha256')
    .update(`${VOICES[lang].voice}\n${PROSODY.pitch}\n${PROSODY.rate}\n${text}`)
    .digest('hex');
  return join(config.speechCacheDir, `${key}.mp3`);
}

async function synthesise(text: string, lang: SpeechLang): Promise<Buffer> {
  const { voice, locale } = VOICES[lang];
  const url = `https://${config.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${voice}">` +
    `<prosody pitch="${PROSODY.pitch}" rate="${PROSODY.rate}">${escapeXml(text)}</prosody>` +
    `</voice></speak>`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.azureSpeechKey ?? '',
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'potets-translator',
    },
    body: ssml,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Azure Speech returned ${response.status}: ${detail || response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** MP3 bytes for the text, from the cache when it has been asked for before. */
export async function speak(text: string, lang: SpeechLang = 'tr'): Promise<Buffer> {
  if (!speechConfigured) throw new SpeechUnavailable('Azure Speech is not configured.');
  const trimmed = text.trim();
  if (!trimmed) throw new SpeechUnavailable('Nothing to say.');
  if (trimmed.length > MAX_TEXT_CHARS) {
    throw new SpeechUnavailable(`Text is longer than the ${MAX_TEXT_CHARS} character limit.`);
  }

  const file = cachePath(trimmed, lang);
  try {
    return await readFile(file);
  } catch {
    // Not cached yet.
  }

  const audio = await synthesise(trimmed, lang);
  await mkdir(config.speechCacheDir, { recursive: true });
  await writeFile(file, audio);
  return audio;
}
