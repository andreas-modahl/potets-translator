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

export interface VoiceChoice {
  /** The Azure voice name, as the page asks for it. */
  id: string;
  /** The first name, as the menu shows it. */
  name: string;
}

/** The voices Azure has for each language, by first name. */
const KNOWN_VOICES: Record<SpeechLang, VoiceChoice[]> = {
  tr: [
    { id: 'tr-TR-AhmetNeural', name: 'Ahmet' },
    { id: 'tr-TR-EmelNeural', name: 'Emel' },
    { id: 'tr-TR-Elif:MAI-Voice-2', name: 'Elif' },
    { id: 'tr-TR-Aydın:MAI-Voice-2', name: 'Aydın' },
  ],
  nb: [
    { id: 'nb-NO-PernilleNeural', name: 'Pernille' },
    { id: 'nb-NO-FinnNeural', name: 'Finn' },
    { id: 'nb-NO-IselinNeural', name: 'Iselin' },
  ],
};

/** "tr-TR-AhmetNeural" -> "Ahmet", "tr-TR-Elif:MAI-Voice-2" -> "Elif". */
function firstName(id: string): string {
  return id.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/:.*$/, '').replace(/Neural$/, '');
}

/**
 * The voices the page may choose from, the configured one first so it is the
 * default, then the rest of the known ones.
 */
export function voiceChoices(lang: SpeechLang): VoiceChoice[] {
  const chosen = VOICES[lang].voice;
  const known = KNOWN_VOICES[lang].filter((voice) => voice.id !== chosen);
  return [{ id: chosen, name: firstName(chosen) }, ...known];
}

/** The voice to use: the one asked for when it is on the list, else the configured one. */
function voiceFor(lang: SpeechLang, requested = ''): string {
  return voiceChoices(lang).find((voice) => voice.id === requested)?.id ?? VOICES[lang].voice;
}

/**
 * The countryball delivery: pitched up so the ball sounds small and round,
 * slowed a touch so the words stay clear enough to learn from. Both are part
 * of the cache key, so changing them regenerates the audio.
 */
const PROSODY = { pitch: config.speechPitch, rate: config.speechRate };

/**
 * The generative MAI voices read a mood into the text and act it out, which
 * on a lone word can come out as a laugh. A style keeps them even. The older
 * neural voices take no style, so they get none.
 */
function styleFor(voice: string): string {
  return voice.includes(':MAI-') ? config.speechStyle : '';
}

/**
 * A short fingerprint of the voices and delivery. The page puts it in every
 * speech URL, so audio the browser cached under the old settings is never
 * replayed after the settings change.
 */
export const speechFingerprint = createHash('sha256')
  .update(
    `${VOICES.tr.voice}\n${VOICES.nb.voice}\n${PROSODY.pitch}\n${PROSODY.rate}\n${config.speechStyle}`,
  )
  .digest('hex')
  .slice(0, 8);

function cachePath(text: string, voice: string): string {
  const key = createHash('sha256')
    .update(`${voice}\n${PROSODY.pitch}\n${PROSODY.rate}\n${styleFor(voice)}\n${text}`)
    .digest('hex');
  return join(config.speechCacheDir, `${key}.mp3`);
}

/** The SSML for one voice: the text in its prosody, inside a style when the voice takes one. */
export function ssmlFor(text: string, voice: string, locale: string): string {
  const style = styleFor(voice);
  const spoken = `<prosody pitch="${PROSODY.pitch}" rate="${PROSODY.rate}">${escapeXml(text)}</prosody>`;
  const styled = style ? `<mstts:express-as style="${style}">${spoken}</mstts:express-as>` : spoken;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${locale}">` +
    `<voice name="${voice}">${styled}</voice></speak>`
  );
}

async function synthesise(text: string, lang: SpeechLang, voice: string): Promise<Buffer> {
  const { locale } = VOICES[lang];
  const url = `https://${config.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = ssmlFor(text, voice, locale);

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
export async function speak(text: string, lang: SpeechLang = 'tr', requestedVoice = ''): Promise<Buffer> {
  if (!speechConfigured) throw new SpeechUnavailable('Azure Speech is not configured.');
  const trimmed = text.trim();
  if (!trimmed) throw new SpeechUnavailable('Nothing to say.');
  if (trimmed.length > MAX_TEXT_CHARS) {
    throw new SpeechUnavailable(`Text is longer than the ${MAX_TEXT_CHARS} character limit.`);
  }

  const voice = voiceFor(lang, requestedVoice);
  const file = cachePath(trimmed, voice);
  try {
    return await readFile(file);
  } catch {
    // Not cached yet.
  }

  const audio = await synthesise(trimmed, lang, voice);
  await mkdir(config.speechCacheDir, { recursive: true });
  await writeFile(file, audio);
  return audio;
}
