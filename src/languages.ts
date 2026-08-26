/**
 * Display helpers for language names.
 *
 * The bot deliberately does not keep a closed list of supported languages —
 * Claude detects and translates whatever it is given. This map only decides
 * which flag decorates the posted translation, and anything missing from it
 * simply gets no flag.
 */
const FLAGS: Record<string, string> = {
  arabic: '🇸🇦',
  chinese: '🇨🇳',
  czech: '🇨🇿',
  danish: '🇩🇰',
  dutch: '🇳🇱',
  english: '🇬🇧',
  finnish: '🇫🇮',
  french: '🇫🇷',
  german: '🇩🇪',
  greek: '🇬🇷',
  hebrew: '🇮🇱',
  hindi: '🇮🇳',
  hungarian: '🇭🇺',
  icelandic: '🇮🇸',
  indonesian: '🇮🇩',
  italian: '🇮🇹',
  japanese: '🇯🇵',
  korean: '🇰🇷',
  norwegian: '🇳🇴',
  polish: '🇵🇱',
  portuguese: '🇵🇹',
  romanian: '🇷🇴',
  russian: '🇷🇺',
  spanish: '🇪🇸',
  swedish: '🇸🇪',
  thai: '🇹🇭',
  turkish: '🇹🇷',
  ukrainian: '🇺🇦',
  vietnamese: '🇻🇳',
};

/** Title-cases a user-supplied language name so stored config stays tidy. */
export function normalizeLanguage(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_match, prefix: string, letter: string) => prefix + letter.toUpperCase());
}

export function flagFor(language: string): string | undefined {
  const key = language.trim().toLowerCase();
  if (FLAGS[key]) return FLAGS[key];
  // "Brazilian Portuguese" -> "portuguese", "Simplified Chinese" -> "chinese".
  const lastWord = key.split(' ').at(-1);
  return lastWord ? FLAGS[lastWord] : undefined;
}

export function labelFor(language: string): string {
  const flag = flagFor(language);
  return flag ? `${flag} ${language}` : language;
}

/** Parses the comma-separated language list accepted by /translator enable. */
export function parseTargets(raw: string): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const part of raw.split(',')) {
    const normalized = normalizeLanguage(part);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(normalized);
  }
  return targets;
}
