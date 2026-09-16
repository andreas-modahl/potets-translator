import { cueText, serializeSubtitles, validateCues, wrapText, mappedChunks, sentencePages, captionPage, naturalSegments, pauseSegments, SUFFIX_HINTS, validEmojiHint, topVideoWords, normalizeWord, wordMeanings } from './subtitles-format.js';
import { zipFiles } from './subtitles-zip.js';
import { subtitlePlayer } from './subtitles-player.js';

const $ = id => document.getElementById(id);
const settingsKey = name => `subtitles:settings:v2:${name}`;
for (const id of ['show-sentence', 'show-gloss', 'norwegian-focus', 'turkish-focus', 'show-norwegian-badge', 'show-natural', 'show-focus', 'show-emoji', 'overlay-text', 'show-playback-buttons']) {
  const checkbox = $(id);
  const key = settingsKey(id);
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'true' || saved === 'false') checkbox.checked = saved === 'true';
  } catch { /* Keep the defaults when browser storage is unavailable. */ }
  checkbox.addEventListener('change', () => {
    try { localStorage.setItem(key, String(checkbox.checked)); }
    catch { /* The control still works when browser storage is unavailable. */ }
  });
}
const player = subtitlePlayer($('player'), $('youtube-player'));
const preview = $('preview');
const tvButton = $('tv-mode');
let tvControlsTimer;
let tvPointerDown = false;
function revealTvControls() {
  clearTimeout(tvControlsTimer);
  preview.classList.remove('tv-idle');
  player.controls = true;
  if (preview.hidden || (!preview.classList.contains('tv-mode') && document.fullscreenElement !== preview) || player.paused || player.ended) return;
  tvControlsTimer = setTimeout(() => {
    // Keep menus and keyboard-focused controls usable until interaction ends.
    if (tvPointerDown || preview.querySelector('details[open]') ||
        preview.querySelector('.playback-toolbar :focus-visible, #sentence-actions :focus-visible, #translation-coverage :focus-visible') || player.seeking) {
      revealTvControls(); return;
    }
    preview.classList.add('tv-idle');
    player.controls = false;
  }, 3000);
}
for (const event of ['pointermove', 'pointerup', 'pointercancel', 'keydown', 'focusin', 'wheel']) {
  document.addEventListener(event, () => {
    if (event === 'pointerup' || event === 'pointercancel') tvPointerDown = false;
    if (!preview.hidden) revealTvControls();
  }, { capture: true, passive: true });
}
preview.addEventListener('pointerdown', () => { tvPointerDown = true; revealTvControls(); }, { passive: true });
preview.addEventListener('toggle', revealTvControls, true);
for (const event of ['play', 'pause', 'ended', 'seeking', 'seeked', 'emptied', 'error']) {
  player.addEventListener(event, revealTvControls);
}
window.addEventListener('blur', () => { tvPointerDown = false; revealTvControls(); });
function setTvMode(enabled) {
  preview.classList.toggle('tv-mode', enabled);
  document.body.classList.toggle('tv-view', enabled);
  tvButton.setAttribute('aria-pressed', String(enabled));
  revealTvControls();
}
try { setTvMode(localStorage.getItem(settingsKey('tv-mode')) === 'true'); } catch {}
tvButton.onclick = () => {
  const enabled = !preview.classList.contains('tv-mode');
  setTvMode(enabled);
  try { localStorage.setItem(settingsKey('tv-mode'), String(enabled)); } catch {}
};
const fullscreenButton = $('player-fullscreen');
fullscreenButton.hidden = !document.fullscreenEnabled;
fullscreenButton.onclick = async () => {
  try {
    if (document.fullscreenElement === preview) await document.exitFullscreen();
    else await preview.requestFullscreen();
  } catch { $('preview-help').textContent = 'Fullskjerm er ikke tilgjengelig. Prøv TV-modus.'; }
};
document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent = document.fullscreenElement === preview ? 'Avslutt fullskjerm' : 'Fullskjerm';
  revealTvControls();
});
const status = $('status');
const track = player.addTextTrack('subtitles', 'Norsk i tyrkisk ordstilling', 'nb');
track.mode = 'hidden';
// Hidden metadata cues give us word-boundary events even for very short words.
const wordTrack = player.addTextTrack('metadata', 'Tyrkiske ord', 'tr');
wordTrack.mode = 'hidden';
let shownTurkish;
let highlightedWords = [];
let shownNatural;
let shownFocusHint;
let shownEmojiKey;
const emojiCache = new Map();
const pendingEmoji = new Map();
const failedEmoji = new Set();
try {
  const cached = JSON.parse(localStorage.getItem('subtitles:emoji-hints:v1') || '[]');
  if (Array.isArray(cached)) for (const entry of cached.slice(-100)) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && Array.isArray(entry[1]) && entry[1].every(validEmojiHint)) emojiCache.set(entry[0], entry[1]);
  }
} catch { /* Saved story hints also work without browser storage. */ }
function appendEmojiHints(element, chunks) {
  if (!$('show-emoji').checked) return;
  const hints = document.createElement('span'); hints.className = 'emoji-hints';
  const seen = new Set();
  function add(key, emoji, title, suffix = false) {
    if (seen.has(key)) return;
    seen.add(key);
    const icon = document.createElement('span'); icon.textContent = emoji; icon.title = title;
    icon.setAttribute('role', 'img'); icon.setAttribute('aria-label', title);
    if (suffix) icon.className = 'hint-suffix';
    hints.append(icon);
  }
  for (const chunk of chunks.filter(Boolean)) {
    if (!validEmojiHint(chunk.hint)) continue;
    if (chunk.hint.emoji) add(chunk.hint.emoji, chunk.hint.emoji, `Ordhint: ${chunk.text}`);
    for (const suffix of chunk.hint.suffixes) {
      const symbol = SUFFIX_HINTS[suffix.kind];
      add(suffix.kind + suffix.form, symbol.emoji, `${suffix.form}: ${symbol.label}`, true);
    }
  }
  if (hints.childNodes.length) element.prepend(hints);
}
function emojiStatus(text = '') {
  $('emoji-status').textContent = text;
  $('emoji-status').hidden = !text;
}
async function ensureEmojiHints(active) {
  if (!$('show-emoji').checked || !active || pendingPosition !== undefined) return;
  const chunks = mappedChunks(active);
  if (!chunks.length || chunks.every(chunk => validEmojiHint(chunk.hint))) { shownEmojiKey = undefined; emojiStatus(); return; }
  const input = { natural: active.turkish, chunks: chunks.map(chunk => ({
    target: active.words.filter(word => word.start >= chunk.start && word.end <= chunk.end).map(word => word.text).join(' '), native: chunk.text,
  })) };
  const key = JSON.stringify(input);
  shownEmojiKey = key;
  if (failedEmoji.has(key)) { emojiStatus('Emojihint kunne ikke hentes. Slå av og på for å prøve igjen.'); return; }
  if (pendingEmoji.has(key)) { emojiStatus('Henter emojihint …'); return; }
  const cached = emojiCache.get(key);
  if (cached?.length === chunks.length) {
    chunks.forEach((chunk, index) => { chunk.hint = cached[index]; });
    shownTurkish = shownNatural = undefined;
    updateTurkish();
    return;
  }
  emojiStatus('Henter emojihint …');
  const request = (async () => {
    const hints = [];
    for (let at = 0; at < chunks.length; at += 80) {
      const batch = input.chunks.slice(at, at + 80);
      const result = await json('/api/subtitle-hints', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, chunks: batch }), signal: AbortSignal.timeout(60000) });
      if (!Array.isArray(result.hints) || result.hints.length !== batch.length || !result.hints.every(validEmojiHint)) throw new Error('Invalid emoji hints');
      hints.push(...result.hints);
    }
    chunks.forEach((chunk, index) => { chunk.hint = hints[index]; });
    emojiCache.set(key, hints);
    if (emojiCache.size > 100) emojiCache.delete(emojiCache.keys().next().value);
    try { localStorage.setItem('subtitles:emoji-hints:v1', JSON.stringify([...emojiCache])); } catch {}
    if (shownEmojiKey === key && $('show-emoji').checked) {
      shownTurkish = shownNatural = undefined;
      updateTurkish();
    }
  })();
  pendingEmoji.set(key, request);
  try { await request; }
  catch {
    failedEmoji.add(key);
    if (shownEmojiKey === key && $('show-emoji').checked) emojiStatus('Emojihint kunne ikke hentes. Slå av og på for å prøve igjen.');
  } finally { pendingEmoji.delete(key); }
}
const naturalTranslations = new Map();
const pendingTranslations = new Map();
const naturalLinksCache = new Map();
const pendingLinks = new Map();
let naturalSpans = [];
try {
  const cached = JSON.parse(localStorage.getItem('subtitles:natural-links:v1') || '[]');
  if (Array.isArray(cached)) for (const entry of cached.slice(-200)) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && Array.isArray(entry[1])) naturalLinksCache.set(entry[0], entry[1]);
  }
} catch { /* Phrase links can still be loaded without browser storage. */ }
try {
  const cached = JSON.parse(localStorage.getItem('subtitles:natural-nb:v1') || '[]');
  if (Array.isArray(cached)) for (const entry of cached.slice(-200)) {
    if (Array.isArray(entry) && entry.length === 2 && entry.every(value => typeof value === 'string' && value.trim())) {
      naturalTranslations.set(...entry);
    }
  }
} catch { /* Translation still works without a browser cache. */ }
async function naturalTranslation(source) {
  if (naturalTranslations.has(source)) return naturalTranslations.get(source);
  if (pendingTranslations.has(source)) return pendingTranslations.get(source);
  const request = (async () => {
    const result = await json('/api/translate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: source, targets: ['Norwegian Bokmål'], explain: 'off' }),
      signal: AbortSignal.timeout(60000),
    });
    const text = result.translations?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('Missing Norwegian translation');
    naturalTranslations.set(source, text.trim());
    if (naturalTranslations.size > 200) naturalTranslations.delete(naturalTranslations.keys().next().value);
    try { localStorage.setItem('subtitles:natural-nb:v1', JSON.stringify([...naturalTranslations])); }
    catch { /* Keep the in-memory cache when browser storage is full or blocked. */ }
    return text.trim();
  })();
  pendingTranslations.set(source, request);
  try { return await request; }
  finally { pendingTranslations.delete(source); }
}
function highlightNatural(active) {
  const time = captionTime();
  const word = active?.words?.find(word => time >= word.start && time < word.end);
  const index = word ? mappedChunks(active).findIndex(chunk => word.start >= chunk.start && word.end <= chunk.end) : -1;
  for (const { element, chunks, badge } of naturalSpans) {
    const speaking = index >= 0 && chunks.includes(index);
    element.classList.toggle('speaking', speaking);
    badge.textContent = speaking ? word.text : '';
    if (speaking) appendEmojiHints(badge, [mappedChunks(active)[index]]);
  }
}
function renderNatural(active, text, links) {
  naturalSpans = [];
  const segments = naturalSegments(text, links, mappedChunks(active).length);
  $('natural-text').replaceChildren();
  if (!segments.length) { $('natural-text').textContent = text; return; }
  for (const segment of segments) {
    if (!segment.chunks.length) { $('natural-text').append(segment.text); continue; }
    const element = document.createElement('span');
    element.className = 'natural-phrase';
    const badge = document.createElement('span');
    badge.className = 'natural-word-badge'; badge.lang = 'tr'; badge.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.className = 'natural-phrase-text'; text.textContent = segment.text;
    element.append(badge, text);
    // Reserve space for every possible word so badges never push the sentence around.
    const groups = mappedChunks(active);
    const words = active.words.filter(word => segment.chunks.some(index =>
      word.start >= groups[index].start && word.end <= groups[index].end));
    for (const word of words) {
      const size = document.createElement('span'); size.className = 'natural-badge-size';
      size.textContent = word.text; size.lang = 'tr'; size.setAttribute('aria-hidden', 'true');
      appendEmojiHints(size, [groups.find(chunk => word.start >= chunk.start && word.end <= chunk.end)]);
      element.append(size);
    }
    naturalSpans.push({ element, chunks: segment.chunks, badge });
    $('natural-text').append(element);
  }
  highlightNatural(active);
}
async function loadNaturalLinks(active, text) {
  const chunks = mappedChunks(active);
  if (!chunks.length) return;
  const input = { natural: text, chunks: chunks.map(chunk => ({
    target: active.words.filter(word => word.start >= chunk.start && word.end <= chunk.end).map(word => word.text).join(' '), native: chunk.text,
  })) };
  const key = JSON.stringify(input);
  if (naturalSegments(text, naturalLinksCache.get(key), chunks.length).length) return naturalLinksCache.get(key);
  if (pendingLinks.has(key)) return pendingLinks.get(key);
  const request = (async () => {
    const { links } = await json('/api/subtitle-alignment', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: key, signal: AbortSignal.timeout(60000),
    });
    if (!naturalSegments(text, links, chunks.length).length) throw new Error('Invalid phrase links');
    naturalLinksCache.set(key, links);
    if (naturalLinksCache.size > 200) naturalLinksCache.delete(naturalLinksCache.keys().next().value);
    try { localStorage.setItem('subtitles:natural-links:v1', JSON.stringify([...naturalLinksCache])); }
    catch { /* Keep phrase links in memory when storage is unavailable. */ }
    return links;
  })();
  pendingLinks.set(key, request);
  try { return await request; }
  finally { pendingLinks.delete(key); }
}
async function showNatural(active, text) {
  const source = active.turkish.trim();
  if (shownNatural !== source) return;
  renderNatural(active, text, active.naturalLinks);
  if (naturalSpans.length || !mappedChunks(active).length) return;
  try {
    const links = await loadNaturalLinks(active, text);
    if (shownNatural === source) renderNatural(active, text, links);
  } catch {
    if (shownNatural === source) {
      $('retry-natural').textContent = 'Prøv ordkobling igjen';
      $('retry-natural').hidden = false;
    }
  }
}
function updateNatural(active) {
  const source = active?.turkish?.trim();
  highlightNatural(active);
  $('natural-caption').hidden = !source || !$('show-natural').checked;
  if ($('natural-caption').hidden || source === shownNatural) return;
  shownNatural = source;
  naturalSpans = [];
  $('retry-natural').hidden = true;
  $('retry-natural').textContent = 'Prøv igjen';
  if (active.natural) {
    void showNatural(active, active.natural);
    return;
  }
  $('natural-text').textContent = naturalTranslations.get(source) || 'Oversetter til naturlig norsk …';
  void naturalTranslation(source).then(text => {
    void showNatural(active, text);
  }).catch(() => {
    if (shownNatural !== source) return;
    $('natural-text').textContent = 'Kunne ikke hente norsk oversettelse.';
    $('retry-natural').hidden = false;
  });
}
$('retry-natural').onclick = () => { shownNatural = undefined; updateTurkish(); };
let configured = false;
let busy = false;
let jobId;
let controller;
let cues = [];
let pages = [];
let savedId;
let sharedStory = false;
let translationSections = [];
let sectionMonitorVersion = 0;
let sectionWorkActive = false;
let priorityJobId;
let lastPrioritySection;
let priorityTimer;
function updateSectionPriority() {
  if (!priorityJobId || preview.hidden) return;
  const id = priorityJobId;
  const position = Math.max(0, Math.min(7200000, (pendingPosition ?? player.currentTime) * 1000));
  const section = Math.floor(position / 60000);
  if (lastPrioritySection === `${id}:${section}`) return;
  lastPrioritySection = `${id}:${section}`;
  void fetch(`/api/subtitles/${id}/priority`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ position }) })
    .then(response => { if (!response.ok && priorityJobId === id) lastPrioritySection = undefined; })
    .catch(() => { if (priorityJobId === id) lastPrioritySection = undefined; });
}
player.addEventListener('timeupdate', updateSectionPriority);
player.addEventListener('seeked', () => {
  clearTimeout(priorityTimer);
  priorityTimer = setTimeout(updateSectionPriority, 150);
});
let sourceName = '';
let dirty = false;
let revision = 0;
let saving = false;
let storage = false;
let sentencePlayback;
let lastSentence;
let sentenceTimer;
let sentenceResumeTimer;
let waitingAfterSentence = false;
let singleSentence = false;
let heldSentence;
let pendingPosition;
let previousPlaybackTime;
let segmentBoundaryTimer;
let segmentResumeTimer;
let segmentTarget;
let heldSegment;
let playbackAudio;
let playbackGain;
let pauseFadeKey;
function smoothGainRamp(gain, from, to, start, duration) {
  gain.setValueAtTime(from, start);
  // Ease both ends of the fade to avoid an abrupt change in loudness.
  for (let step = 1; step <= 12; step++) {
    const position = step / 12;
    const eased = position * position * (3 - 2 * position);
    gain.linearRampToValueAtTime(from + (to - from) * eased, start + duration * position);
  }
}
function resetAudioFade(fadeIn = false) {
  pauseFadeKey = undefined;
  if (!playbackGain) return;
  const now = playbackAudio.currentTime;
  const gain = playbackGain.gain;
  gain.cancelAndHoldAtTime(now);
  if (player.paused) { gain.setValueAtTime(0, now); return; }
  smoothGainRamp(gain, fadeIn ? 0 : gain.value, 1, now, .04);
}
function schedulePauseFade() {
  if (!playbackGain || player.paused || player.seeking) return;
  const ends = [sentencePlayback?.end, segmentDelay > 0 ? segmentTarget?.end : undefined].filter(Number.isFinite);
  if (!ends.length) { if (pauseFadeKey !== undefined) resetAudioFade(); return; }
  const end = Math.min(...ends);
  const key = `${end}:${player.playbackRate}`;
  if (pauseFadeKey === key) return;
  pauseFadeKey = key;
  const now = playbackAudio.currentTime;
  const remaining = Math.max(0, (end / 1000 - player.currentTime) / player.playbackRate - .004);
  const gain = playbackGain.gain;
  // A longer eased fade softens the cut; short segments retain most of their speech.
  gain.cancelAndHoldAtTime(now);
  const fadeDuration = Math.min(.065, remaining / 3);
  const fadeStart = now + remaining - fadeDuration;
  smoothGainRamp(gain, gain.value, 1, now, Math.min(.04, Math.max(0, fadeStart - now)));
  gain.setValueAtTime(1, fadeStart);
  smoothGainRamp(gain, 1, 0, fadeStart, fadeDuration);
}
async function startPlaybackAudio() {
  if (player.embedded) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    playbackAudio ||= new AudioContext();
    if (playbackAudio.state === 'suspended') await playbackAudio.resume();
    // Leave native audio connected until the audio context can actually play.
    if (playbackAudio.state !== 'running' || player.paused) return;
    if (!playbackGain) {
      const gain = playbackAudio.createGain();
      gain.connect(playbackAudio.destination);
      playbackAudio.createMediaElementSource(player.native).connect(gain);
      playbackGain = gain;
    }
    resetAudioFade(true);
    schedulePauseFade();
  } catch { /* Browsers without Web Audio keep normal playback. */ }
}
player.addEventListener('play', startPlaybackAudio);
player.addEventListener('playing', () => { resetAudioFade(true); schedulePauseFade(); });
player.addEventListener('waiting', () => resetAudioFade());
player.addEventListener('pause', () => resetAudioFade());
player.addEventListener('seeking', () => resetAudioFade());
player.addEventListener('emptied', () => resetAudioFade());
const segmentPauseInput = $('segment-pause-seconds');
const sentencePauseInput = $('sentence-pause-seconds');
let sentenceDelay = 0;
try {
  const saved = Number(localStorage.getItem(settingsKey('sentence-delay-seconds')) ?? '0');
  if (Number.isFinite(saved) && saved >= 0 && saved <= 60) sentenceDelay = saved;
} catch { /* Leave sentence pauses off when storage is unavailable. */ }
sentencePauseInput.value = String(sentenceDelay);
function cancelSentenceWait() {
  clearTimeout(sentenceResumeTimer);
  waitingAfterSentence = false;
}
function resumeAfterSentence() {
  cancelSentenceWait();
  void player.play().catch(() => { cancelSentencePlayback(); updateTurkish(); });
}
function waitAfterSentence() {
  clearTimeout(sentenceResumeTimer);
  waitingAfterSentence = true;
  sentenceResumeTimer = setTimeout(resumeAfterSentence, sentenceDelay * 1000);
}
function applySentenceDelay() {
  sentenceDelay = sentencePauseInput.valueAsNumber;
  try { localStorage.setItem(settingsKey('sentence-delay-seconds'), String(sentenceDelay)); } catch {}
  if (waitingAfterSentence) {
    if (sentenceDelay === 0) resumeAfterSentence();
    else waitAfterSentence();
  } else if (sentenceDelay === 0 && !singleSentence) cancelSentencePlayback();
  else armAutoPause();
  schedulePauseFade();
}
sentencePauseInput.oninput = () => {
  if (Number.isFinite(sentencePauseInput.valueAsNumber) && sentencePauseInput.validity.valid) applySentenceDelay();
};
sentencePauseInput.onchange = () => {
  const value = sentencePauseInput.valueAsNumber;
  sentencePauseInput.value = String(Number.isFinite(value) ? Math.max(0, Math.min(60, Math.round(value * 10) / 10)) : sentenceDelay);
  applySentenceDelay();
};
let segmentDelay = 0;
try {
  const saved = Number(localStorage.getItem(settingsKey('segment-delay-seconds')) ?? '0');
  if (Number.isFinite(saved) && saved >= 0 && saved <= 10) segmentDelay = saved;
} catch { /* Leave segment pauses off when storage is unavailable. */ }
segmentPauseInput.value = String(segmentDelay);
function captionTime() {
  return heldSentence ? heldSentence.end - 1 : heldSegment ? heldSegment.end - 1 : player.currentTime * 1000;
}
function cancelSegmentPause() {
  clearTimeout(segmentBoundaryTimer);
  clearTimeout(segmentResumeTimer);
  segmentTarget = undefined;
  heldSegment = undefined;
}
function resumeAfterSegment() {
  cancelSegmentPause();
  void player.play().catch(() => { cancelSentencePlayback(); updateTurkish(); });
}
function waitAfterSegment() {
  clearTimeout(segmentResumeTimer);
  segmentResumeTimer = setTimeout(resumeAfterSegment, segmentDelay * 1000);
}
function stopAtSegmentEnd() {
  clearTimeout(segmentBoundaryTimer);
  if (segmentDelay <= 0 || player.paused || player.seeking) return;
  segmentTarget ||= pauseSegments(cues).find(segment => segment.end > player.currentTime * 1000 + 1);
  if (!segmentTarget) return;
  schedulePauseFade();
  const remaining = segmentTarget.end / 1000 - player.currentTime;
  if (remaining > .003) {
    segmentBoundaryTimer = setTimeout(stopAtSegmentEnd, Math.max(4, remaining * 1000 / player.playbackRate));
    return;
  }
  // An explicit sentence stop takes priority over automatically resuming the next segment.
  if (sentencePlayback && sentencePlayback.end <= segmentTarget.end + 1) { stopAtSentenceEnd(); return; }
  heldSegment = segmentTarget;
  segmentTarget = undefined;
  clearTimeout(sentenceTimer);
  player.pause();
  player.currentTime = heldSegment.end / 1000;
  updateTurkish();
  waitAfterSegment();
}
function applySegmentDelay() {
  segmentDelay = segmentPauseInput.valueAsNumber;
  try { localStorage.setItem(settingsKey('segment-delay-seconds'), String(segmentDelay)); } catch {}
  if (segmentDelay === 0) {
    const waiting = Boolean(heldSegment);
    cancelSegmentPause();
    if (waiting) resumeAfterSegment();
  } else if (heldSegment) waitAfterSegment();
  else stopAtSegmentEnd();
  schedulePauseFade();
}
segmentPauseInput.oninput = () => {
  if (Number.isFinite(segmentPauseInput.valueAsNumber) && segmentPauseInput.validity.valid) applySegmentDelay();
};
segmentPauseInput.onchange = () => {
  const value = segmentPauseInput.valueAsNumber;
  segmentPauseInput.value = String(Number.isFinite(value) ? Math.max(0, Math.min(10, Math.round(value * 10) / 10)) : segmentDelay);
  applySegmentDelay();
};
player.addEventListener('playing', stopAtSegmentEnd);
player.addEventListener('seeked', stopAtSegmentEnd);
player.addEventListener('ratechange', stopAtSegmentEnd);
player.addEventListener('play', cancelSegmentPause);
player.addEventListener('emptied', cancelSegmentPause);
player.addEventListener('ended', cancelSegmentPause);
function savePosition(milliseconds) {
  const url = new URL(location.href);
  if (url.searchParams.get('view') !== 'play' || !savedId || url.searchParams.get('subtitle') !== savedId) return;
  const value = String(Math.round(milliseconds) / 1000);
  if (url.searchParams.get('t') === value) return;
  url.searchParams.set('t', value);
  history.replaceState(history.state, '', url);
}
function restorePosition() {
  if (pendingPosition === undefined || player.readyState < 1 || !Number.isFinite(player.duration)) return;
  const time = Math.min(pendingPosition, player.duration);
  pendingPosition = undefined;
  player.currentTime = time;
  const completed = pages.find(page => Math.abs((page.words.at(-1)?.end ?? page.end) - time * 1000) < 2);
  heldSentence = completed ? { start: completed.words[0]?.start ?? completed.start, end: completed.words.at(-1)?.end ?? completed.end } : undefined;
  lastSentence = heldSentence;
  previousPlaybackTime = time * 1000;
  updateTurkish(); updatePlayButtons();
}
// Use complete display sentences, including pauses inside a sentence.
function sentenceAt(_cues, time) {
  return pages.map(page => ({ start: page.words[0]?.start ?? page.start, end: page.words.at(-1)?.end ?? page.end }))
    .find(sentence => sentence.end > time + 1);
}
function armAutoPause() {
  if (sentenceDelay > 0 && !player.paused && !sentencePlayback) {
    sentencePlayback = sentenceAt(cues, player.currentTime * 1000);
    lastSentence = sentencePlayback || lastSentence;
  }
  stopAtSentenceEnd();
}
$('show-sentence').onchange = updateTurkish;
$('show-gloss').onchange = updateTurkish;
for (const [id, other] of [['norwegian-focus', 'turkish-focus'], ['turkish-focus', 'norwegian-focus']]) {
  $(id).onchange = () => {
    if ($(id).checked) {
      $(other).checked = false;
      try { localStorage.setItem(settingsKey(other), 'false'); } catch {}
    }
    updateTurkish();
  };
}
$('show-norwegian-badge').onchange = updateTurkish;
$('show-natural').onchange = updateTurkish;
$('show-focus').onchange = updateTurkish;
$('show-playback-buttons').onchange = updatePlayButtons;
$('overlay-text').onchange = updateMediaLayout;
$('show-emoji').onchange = () => {
  shownTurkish = shownNatural = shownFocusHint = shownEmojiKey = undefined;
  failedEmoji.clear(); emojiStatus(); updateTurkish();
};
function releaseSentence() {
  cancelSentenceWait();
  heldSentence = undefined;
  updateTurkish();
}
function cancelSentencePlayback() {
  cancelSentenceWait();
  singleSentence = false;
  sentencePlayback = undefined;
  clearTimeout(sentenceTimer);
}
function stopAtSentenceEnd() {
  clearTimeout(sentenceTimer);
  if (!sentencePlayback || player.paused) return;
  schedulePauseFade();
  const remaining = sentencePlayback.end / 1000 - player.currentTime;
  if (remaining <= .003) {
    const end = sentencePlayback.end / 1000;
    heldSentence = sentencePlayback;
    lastSentence = sentencePlayback;
    savePosition(sentencePlayback.end);
    const resume = !singleSentence && sentenceDelay > 0 && Boolean(sentenceAt(cues, sentencePlayback.end));
    cancelSegmentPause(); cancelSentencePlayback(); player.pause(); player.currentTime = end;
    if (resume) waitAfterSentence();
    updateTurkish();
    updatePlayButtons();
  } else sentenceTimer = setTimeout(stopAtSentenceEnd, Math.max(4, remaining * 1000 / player.playbackRate));
}
async function playSentence(sentence, speed = player.playbackRate) {
  if (!sentence) return;
  lastSentence = sentence;
  heldSentence = undefined;
  cancelSegmentPause(); cancelSentencePlayback(); player.pause();
  player.playbackRate = speed;
  for (const button of document.querySelectorAll('[data-sentence-speed]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.sentenceSpeed) === speed));
  }
  player.currentTime = sentence.start / 1000;
  // Wait for the play event before arming, so the preceding pause can settle.
  try {
    await player.play();
    singleSentence = true;
    sentencePlayback = sentence;
    stopAtSentenceEnd();
  } catch { message('Kunne ikke spille av setningen. Velg videoen på nytt.', true); }
}
for (const button of document.querySelectorAll('[data-sentence-speed]')) {
  button.onclick = () => playSentence(lastSentence || sentenceAt(cues, player.currentTime * 1000), Number(button.dataset.sentenceSpeed));
}
$('play-sentence').onclick = () => playSentence(sentenceAt(cues, player.currentTime * 1000), 1);
player.addEventListener('pause', () => {
  if (heldSegment || waitingAfterSentence) return;
  cancelSegmentPause();
  cancelSentencePlayback();
});
player.addEventListener('emptied', cancelSentencePlayback);
player.addEventListener('emptied', releaseSentence);
player.addEventListener('play', releaseSentence);
player.addEventListener('ended', () => {
  const final = pages.at(-1);
  if (final) {
    heldSentence = { start: final.words[0]?.start ?? final.start, end: final.words.at(-1)?.end ?? final.end };
    savePosition(heldSentence.end);
    updateTurkish();
  }
  cancelSentencePlayback();
});
player.addEventListener('ratechange', stopAtSentenceEnd);
player.addEventListener('playing', armAutoPause);
player.addEventListener('seeked', armAutoPause);
player.addEventListener('seeking', () => {
  if (!heldSegment || Math.abs(player.currentTime * 1000 - heldSegment.end) > 1) cancelSegmentPause();
  previousPlaybackTime = undefined;
  // Keep the hold through our own seek to the exact sentence endpoint.
  if (heldSentence && Math.abs(player.currentTime * 1000 - heldSentence.end) > 1) releaseSentence();
  if (lastSentence && (player.currentTime * 1000 < lastSentence.start - 50 || player.currentTime * 1000 > lastSentence.end + 50)) lastSentence = undefined;
  if (sentencePlayback && (player.currentTime * 1000 < sentencePlayback.start || player.currentTime * 1000 >= sentencePlayback.end)) cancelSentencePlayback();
});

function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
let editorNeedsRender = false;
function showEditor(open) {
  if (open && busy) return;
  if (open && editorNeedsRender) { editorNeedsRender = false; renderCues(); }
  $('result').hidden = !open;
  $('toggle-editor').setAttribute('aria-expanded', String(open));
  const label = open ? 'Skjul redigering' : 'Rediger undertekster';
  $('toggle-editor').setAttribute('aria-label', label);
  $('toggle-editor').title = label;
  $('edit-label').textContent = label;
}
const actionMenu = $('subtitle-actions');
actionMenu.addEventListener('click', event => {
  if (event.target.closest('button')) actionMenu.open = false;
});
document.addEventListener('click', event => {
  if (!actionMenu.contains(event.target)) actionMenu.open = false;
});
actionMenu.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    actionMenu.open = false;
    actionMenu.querySelector('summary').focus();
  }
});
let routeVersion = 0;
function navigate(view, id, replace = false) {
  const url = new URL(location.href);
  url.searchParams.delete('view'); url.searchParams.delete('subtitle');
  url.searchParams.delete('t');
  if (view) url.searchParams.set('view', view);
  if (id) url.searchParams.set('subtitle', id);
  history[replace ? 'replaceState' : 'pushState']({ subtitleCard: Boolean(view) }, '', url);
  void showRoute();
}
async function showRoute() {
  const version = ++routeVersion;
  sectionMonitorVersion++;
  sectionWorkActive = false;
  priorityJobId = undefined; lastPrioritySection = undefined;
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  if (view !== 'play' && document.fullscreenElement === preview) {
    await document.exitFullscreen().catch(() => {});
    if (version !== routeVersion) return;
  }
  const id = params.get('subtitle');
  const position = Number(params.get('t'));
  pendingPosition = view === 'play' && params.has('t') && Number.isFinite(position) && position >= 0 ? position : undefined;
  cancelSegmentPause(); cancelSentencePlayback(); player.pause(); showEditor(false);
  $('recordings').hidden = view === 'play';
  $('video-picker').open = false;
  $('preview').hidden = true;
  if (view === 'play') {
    try {
      if (id && id !== savedId) {
        const saved = await json(`/api/subtitle-library/${encodeURIComponent(id)}`);
        if (version !== routeVersion) return;
        if (!canReplace()) { navigate('', undefined, true); return; }
        openSaved(saved);
      } else if (!savedId) { navigate('', undefined, true); return; }
      $('preview').hidden = false;
      if (!busy) void monitorSections(savedId, ++sectionMonitorVersion);
      restorePosition();
      $('playback-heading').focus();
    } catch (error) {
      if (version !== routeVersion) return;
      navigate('', undefined, true); message(error.message, true);
    }
  } else $('youtube-url').focus();
}
$('new-youtube').onclick = () => { if (canReplace()) navigate('new'); };
const videoPicker = $('video-picker');
document.addEventListener('click', event => { if (!videoPicker.contains(event.target)) videoPicker.open = false; });
videoPicker.addEventListener('keydown', event => {
  if (event.key === 'Escape') { videoPicker.open = false; videoPicker.querySelector('summary').focus(); }
});
for (const button of document.querySelectorAll('.close-card')) button.onclick = () => {
  if (history.state?.subtitleCard) history.back();
  else navigate('', undefined, true);
};
window.addEventListener('popstate', () => void showRoute());
$('toggle-editor').onclick = async () => {
  if (document.fullscreenElement === preview) await document.exitFullscreen().catch(() => {});
  showEditor($('result').hidden);
};
function edited() { dirty = true; revision += 1; $('save-status').textContent = 'Ulagrede endringer'; }
function canReplace() { return !busy && !saving && (!dirty || window.confirm('Du har ulagrede endringer. Fortsette uten å lagre?')); }
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
async function loadLibrary() {
  try {
    const data = await json('/api/subtitle-library');
    const videos = data.items.filter(item => isYoutubeVideo(item.source));
    storage = data.storage !== false;
    $('library-status').textContent = '';
    $('library').replaceChildren();
    $('translated-videos').replaceChildren();
    if (!videos.length) $('library-status').textContent = 'Ingen oversatte YouTube-videoer ennå.';
    for (const item of videos) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost';
      button.textContent = `${item.title} · ${new Date(item.updated).toLocaleDateString('nb-NO')}`;
      button.onclick = () => { if (!busy && !saving) navigate('play', item.id); };
      $('library').append(button);
      const choice = button.cloneNode(true);
      choice.textContent = item.title;
      choice.onclick = () => { if (!busy && !saving) navigate('play', item.id); };
      $('translated-videos').append(choice);
    }
  } catch (error) { $('library-status').textContent = error.message; }
  $('save-subtitles').disabled = !storage;
}
function isYoutubeVideo(source) {
  try { const url = new URL(source); return url.protocol === 'https:' && url.hostname === 'www.youtube.com' && url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') || ''); }
  catch { return false; }
}
function showPlaybackSelection(title, filename) {
  $('playback-selection').textContent = title || filename || 'Undertekster';
  $('selected-media').textContent = filename;
  $('selected-media').hidden = !filename || filename === title;

}
function openSaved(saved) {
  cancelSegmentPause(); cancelSentencePlayback(); player.pause(); player.removeAttribute('src'); player.load();
  savedId = saved.id; sourceName = saved.source; cues = saved.cues;
  sharedStory = Boolean(saved.shared) || saved.canEdit === false;
  translationSections = saved.sections || [];
  subtitleReadyThrough = undefined;
  sectionMonitorVersion++;
  $('save-subtitles').textContent = sharedStory ? 'Lagre egen kopi' : 'Lagre endringer';
  $('subtitle-title').value = saved.title;
  dirty = false; revision += 1;
  renderCues(); $('preview').hidden = false;
  showPlaybackSelection(saved.title, sourceName, Boolean(saved.audioUrl));
  if (isYoutubeVideo(saved.source)) player.src = saved.source;
  else if (saved.audioUrl) player.src = saved.audioUrl;
  $('preview-help').textContent = '';
  message('');
  $('save-status').textContent = 'Lagret';
  $('playback-heading').focus();
}
function updatePlayButtons() {
  $('sentence-actions').hidden = !cues.length || !$('show-playback-buttons').checked;
  $('play-sentence').disabled = !player.getAttribute('src') || player.readyState < 1 || Boolean(player.error) || !sentenceAt(cues, player.currentTime * 1000);
  for (const button of document.querySelectorAll('[data-sentence-speed]')) {
    button.disabled = !player.getAttribute('src') || player.readyState < 1 || Boolean(player.error) || !(lastSentence || sentenceAt(cues, player.currentTime * 1000));
  }
  for (const button of $('cues').querySelectorAll('.cue-top button')) {
    button.disabled = !player.getAttribute('src') || player.readyState < 1 || Boolean(player.error);
    button.title = button.disabled ? 'Velg en YouTube-video for å spille av' : 'Spill av denne underteksten';
  }
}
$('subtitle-title').oninput = edited;
$('save-subtitles').onclick = async () => {
  if (saving || busy || sectionWorkActive || !storage) return;
  try {
    validateCues(cues); saving = true;
    const version = revision;
    $('save-status').textContent = 'Lagrer …';
    const updateId = sharedStory ? undefined : savedId;
    const saved = await json('/api/subtitle-library' + (updateId ? `/${encodeURIComponent(updateId)}` : ''), {
      method: updateId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: $('subtitle-title').value, source: sourceName, cues }),
    });
    savedId = saved.id;
    sharedStory = false;
    $('save-subtitles').textContent = 'Lagre endringer';
    const url = new URL(location.href);
    if (url.searchParams.get('view') === 'play') {
      url.searchParams.set('subtitle', savedId);
      history.replaceState(history.state, '', url);
    }
    if (revision === version) { dirty = false; $('save-status').textContent = 'Lagret'; }
    else $('save-status').textContent = 'Ulagrede endringer';
    await loadLibrary();
  } catch (error) { $('save-status').textContent = error.message; }
  finally { saving = false; }
};
async function json(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Forespørselen feilet. Prøv igjen.');
  return data;
}
function clearTrack() {
  updateTranslationCoverage();
  cancelSegmentPause();
  pages = sentencePages(cues);
  cancelSentencePlayback();
  lastSentence = undefined;
  heldSentence = undefined;
  $('sentence-actions').hidden = !cues.length || !$('show-playback-buttons').checked;
  for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
  for (const cue of Array.from(wordTrack.cues || [])) wordTrack.removeCue(cue);
  shownTurkish = undefined;
  shownNatural = undefined;
  shownFocusHint = shownEmojiKey = undefined;
  emojiStatus();
  naturalSpans = [];
  $('natural-caption').hidden = true;
  $('natural-text').textContent = '';
  for (const word of highlightedWords) word.classList.remove('speaking');
  highlightedWords = [];
  $('turkish-caption').replaceChildren(); $('turkish-caption').hidden = true;
  $('reading-focus').hidden = true;
  $('focus-turkish').textContent = $('focus-norwegian').textContent = '';
  $('audio-caption').textContent = ''; $('audio-caption').hidden = true;
  $('word-repetitions').hidden = true;
  repetitionInput = undefined;
}
let highlightFrame;
function updateHighlightLayer() {
  cancelAnimationFrame(highlightFrame);
  const caption = $('turkish-caption');
  let layer = caption.querySelector('.focus-highlights');
  if (caption.hidden || !caption.matches('.norwegian-focus, .turkish-focus')) {
    layer?.remove();
    return;
  }
  const source = caption.querySelector('.source-words .spoken-word.speaking');
  const meaning = source?.closest('.word-translation').querySelector('.word-meaning.speaking');
  if (!source) {
    layer?.remove();
    return;
  }
  if (!layer) {
    layer = document.createElement('span'); layer.className = 'focus-highlights';
    layer.setAttribute('aria-hidden', 'true');
    layer.append(document.createElement('span'), document.createElement('span'));
    caption.append(layer);
  }
  const origin = caption.getBoundingClientRect();
  const targets = [source, caption.classList.contains('turkish-focus') ? meaning?.querySelector('.meaning-text') : meaning];
  targets.forEach((target, index) => {
    const box = layer.children[index];
    box.hidden = !target;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    box.style.left = `${rect.left - origin.left - caption.clientLeft + caption.scrollLeft}px`;
    box.style.top = `${rect.top - origin.top - caption.clientTop + caption.scrollTop}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  });
  // Follow the actual animated text bounds, including wrapping and resizing.
  highlightFrame = requestAnimationFrame(updateHighlightLayer);
}
let repetitionInput;
let knownWords = [];
let knownWordsReady = false;
let savingKnownWord = false;
function createVocabularyRow(group) {
  const known = knownWords.find(item => item.variants.some(form => group.variants.includes(form)));
  const row = document.createElement('div'); row.className = `repetition-count ${known ? 'is-known' : 'is-new'}`;
  const tooltip = [...(group.translations || []), ...(group.examples || []).map(example => `I uttrykk: ${example}`)].join('\n') || 'Ingen ordoversettelse ennå';
  row.title = tooltip;
  const label = document.createElement('span'); label.textContent = `${group.emoji || '💬'} ${group.word}`;
  const count = document.createElement('strong'); count.textContent = group.count === undefined ? '' : `×${group.count}`;
  const mark = document.createElement('button'); mark.type = 'button'; mark.className = 'mark-word-known';
  mark.textContent = 'Kan'; mark.setAttribute('aria-pressed', String(Boolean(known)));
  mark.setAttribute('aria-label', `Kan ${group.word}`);
  mark.setAttribute('aria-description', tooltip);
  mark.title = tooltip;
  mark.disabled = !knownWordsReady || savingKnownWord;
  mark.onclick = () => saveKnownWords(known || group, Boolean(known));
  row.append(label, count, mark); group.counter = count;
  return row;
}
let knownListState;
function renderKnownWords(time = captionTime()) {
  const forms = new Set(knownWords.flatMap(group => group.variants));
  const visible = (videoVocabulary?.cues === cues ? videoVocabulary.groups : [])
    .filter(group => group.times[0] <= time && group.variants.some(form => forms.has(form)))
    .sort((a, b) => wordOccurrencesSoFar(b, time) - wordOccurrencesSoFar(a, time) || a.word.localeCompare(b.word, 'tr'));
  const key = visible.map(group => group.word).join('\0');
  $('show-known-words').textContent = `Kjente ord (${visible.length})`;
  if (knownListState?.key !== key || knownListState.known !== knownWords || knownListState.cues !== cues) {
    const list = $('known-word-list'); list.replaceChildren();
    const groups = visible.map(group => ({ ...group }));
    knownListState = { key, known: knownWords, cues, groups };
    if (!groups.length) list.textContent = 'Ingen kjente ord hittil i videoen.';
    for (const group of groups) list.append(createVocabularyRow(group));
  }
  for (const group of knownListState.groups) {
    const value = `×${wordOccurrencesSoFar(group, time)}`;
    if (group.counter.textContent !== value) group.counter.textContent = value;
  }
}
async function saveKnownWords(group, remove = false) {
  if (savingKnownWord || !knownWordsReady) return;
  const focusedWordIndex = document.activeElement?.closest('#all-video-words .repetition-count')?.dataset.wordIndex;
  savingKnownWord = true;
  $('known-word-status').textContent = '';
  document.querySelectorAll('#word-repetitions button').forEach(button => { button.disabled = true; });
  try {
    const result = await json('/api/subtitle-known-words', { method: remove ? 'DELETE' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ word: group.word, variants: group.variants, emoji: group.emoji || '💬', translations: group.translations || [] }) });
    knownWords = result.words;
  } catch (error) { $('known-word-status').textContent = error.message; }
  finally {
    savingKnownWord = false;
    knownListState = undefined;
    $('show-known-words').disabled = false;
    repetitionInput = undefined; renderKnownWords(); renderAllVideoWords(true); updateTurkish(); updateTranslationCoverage();
    if (focusedWordIndex !== undefined) allWordRows.get(Number(focusedWordIndex))?.querySelector('button')?.focus({ preventScroll: true });
  }
}
$('show-known-words').onclick = () => {
  const list = $('known-word-list'); list.hidden = !list.hidden;
  $('show-known-words').setAttribute('aria-expanded', String(!list.hidden));
};
const allWordsPerPage = 10;
let allWordPage = 0;
let allWordData;
let videoVocabulary;
const allWordRows = new Map();
function wordOccurrencesSoFar(group, time) {
  let low = 0, high = group.times.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (group.times[mid] <= time) low = mid + 1;
    else high = mid;
  }
  return low;
}
function encounteredWords(time) {
  return allWordData.allGroups.map(group => ({ group, count: wordOccurrencesSoFar(group, time) }))
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.group.word.localeCompare(b.group.word, 'tr'))
    .map(item => item.group);
}
function renderAllVideoWords(force = false) {
  const list = $('all-video-words');
  if (list.hidden) return;
  if (!force && allWordRows.size && list.matches(':hover')) return;
  if (allWordData?.cues !== cues || allWordData.known !== knownWords) {
    if (allWordData?.cues !== cues) allWordPage = 0;
    if (videoVocabulary?.cues !== cues) videoVocabulary = { cues, groups: topVideoWords(cues, new Set(), Infinity) };
    const excluded = new Set(knownWords.flatMap(group => group.variants));
    allWordData = { cues, known: knownWords, allGroups: videoVocabulary.groups.filter(group => !group.variants.some(form => excluded.has(form))), groups: [] };
  }
  allWordData.groups = encounteredWords(captionTime());
  const groups = allWordData.groups;
  const pages = Math.max(1, Math.ceil(groups.length / allWordsPerPage));
  allWordPage = Math.min(allWordPage, pages - 1);
  list.replaceChildren(); allWordRows.clear();
  const rows = document.createElement('div'); rows.setAttribute('role', 'list');
  const start = allWordPage * allWordsPerPage;
  for (let index = start; index < Math.min(start + allWordsPerPage, groups.length); index++) {
    const row = createVocabularyRow(groups[index]);
    row.dataset.wordIndex = String(index);
    row.setAttribute('role', 'listitem'); row.setAttribute('aria-posinset', String(index + 1)); row.setAttribute('aria-setsize', String(groups.length));
    rows.append(row); allWordRows.set(index, row);
  }
  if (!groups.length) rows.textContent = 'Ingen ukjente ord hittil.';
  const navigation = document.createElement('div'); navigation.className = 'word-pagination';
  const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = 'Forrige'; previous.dataset.page = 'previous'; previous.disabled = allWordPage === 0;
  const position = document.createElement('span'); position.textContent = `Side ${allWordPage + 1} / ${pages}`; position.setAttribute('aria-live', 'polite');
  const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Neste'; next.dataset.page = 'next'; next.disabled = allWordPage === pages - 1;
  const turnPage = direction => {
    allWordPage += direction;
    renderAllVideoWords(true);
    updateRepetitions(captionTime());
    list.querySelector(`button[data-page="${direction > 0 ? 'next' : 'previous'}"]:not(:disabled)`)?.focus({ preventScroll: true });
  };
  previous.onclick = () => turnPage(-1); next.onclick = () => turnPage(1);
  navigation.append(previous, position, next); list.append(rows, navigation);
  list.scrollTop = 0;
}
$('all-video-words').addEventListener('mouseleave', () => {
  renderAllVideoWords();
  updateRepetitions(captionTime());
});
renderKnownWords();
void json('/api/subtitle-known-words').then(result => {
  knownWords = Array.isArray(result.words) ? result.words : [];
  knownWordsReady = true;
  repetitionInput = undefined; renderKnownWords(); updateTurkish(); updateTranslationCoverage();
}).catch(() => { $('known-word-status').textContent = 'Kunne ikke hente kjente ord. Last siden på nytt for å prøve igjen.'; });
function updateRepetitions(time) {
  const panel = $('word-repetitions');
  if (repetitionInput?.cues !== cues) {
    repetitionInput = { cues };
    renderAllVideoWords();
  } else if (allWordData && !$('all-video-words').matches(':hover')) {
    const visible = encounteredWords(time);
    if (visible.length !== allWordData.groups.length || visible.some((group, index) => group !== allWordData.groups[index])) renderAllVideoWords();
  }
  panel.hidden = !cues.length && !knownWords.length;
  renderKnownWords(time);
  for (const index of allWordRows.keys()) {
    const group = allWordData.groups[index];
    const value = `×${wordOccurrencesSoFar(group, time)}`;
    if (group.counter.textContent !== value) group.counter.textContent = value;
  }
}
function updateTurkish() {
  const time = captionTime();
  // Source word times stay tied to the speech when Norwegian cue times are edited.
  const active = captionPage(pages, time, player.paused);
  updateRepetitions(time);
  const caption = $('turkish-caption');
  void ensureEmojiHints(active);
  updateNatural(active);
  const hasWords = Boolean(active?.words?.length);
  caption.hidden = !hasWords || !$('show-sentence').checked;
  caption.classList.toggle('hide-gloss', !$('show-gloss').checked);
  caption.classList.toggle('norwegian-focus', $('norwegian-focus').checked && !$('turkish-focus').checked && $('show-gloss').checked);
  caption.classList.toggle('turkish-focus', $('turkish-focus').checked && $('show-gloss').checked);
  caption.classList.toggle('show-norwegian-badge', $('show-norwegian-badge').checked);
  $('reading-focus').hidden = !hasWords || !$('show-focus').checked;
  // Keep the last spoken group through brief pauses and single-sentence stops.
  const focusWord = active?.words.findLast(word => word.start <= time);
  const focusChunk = focusWord && mappedChunks(active).find(chunk => focusWord.start >= chunk.start && focusWord.end <= chunk.end);
  const focusSource = focusChunk
    ? active.words.filter(word => word.start >= focusChunk.start && word.end <= focusChunk.end).map(word => word.text).join(' ')
    : focusWord?.text || '';
  const focusMeaning = focusChunk?.text || '';
  const focusHint = JSON.stringify([focusSource, focusMeaning, $('show-emoji').checked, focusChunk?.hint]);
  if (shownFocusHint !== focusHint) {
    shownFocusHint = focusHint;
    $('focus-turkish').textContent = focusSource;
    appendEmojiHints($('focus-turkish'), [focusChunk]);
    $('focus-norwegian').textContent = focusMeaning;
  }
  if (shownTurkish !== active) {
    shownTurkish = active;
    caption.replaceChildren();
    caption.scrollTop = 0;
    const chunks = mappedChunks(active);
    let previousChunk;
    let group;
    for (const word of active?.words || []) {
      const chunk = chunks.find(chunk => word.start >= chunk.start && word.end <= chunk.end);
      if (!group || !chunk || chunk !== previousChunk) {
        group = document.createElement('span'); group.className = 'word-translation';
        group.dataset.segmentStart = String(chunk?.start ?? word.start);
        group.dataset.segmentEnd = String(chunk?.end ?? word.end);
        const source = document.createElement('span'); source.className = 'source-words';
        const translation = document.createElement('span'); translation.className = 'word-meaning spoken-word';
        translation.lang = 'nb';
        if (chunk?.text) {
          const meaningText = document.createElement('span'); meaningText.className = 'meaning-text';
          meaningText.textContent = chunk.text; translation.append(meaningText);
        }
        appendEmojiHints(source, [chunk]);
        group.append(source, translation); caption.append(group);
      }
      const span = document.createElement('span'); span.className = 'spoken-word'; span.textContent = word.text;
      const unit = document.createElement('span'); unit.className = 'source-word-unit';
      const badge = document.createElement('span'); badge.className = 'norwegian-word-badge';
      badge.lang = 'nb'; badge.textContent = chunk?.text || ''; badge.setAttribute('aria-hidden', 'true');
      unit.append(badge, span);
      group.firstChild.append(unit, ' ');
      previousChunk = chunk;
    }
  }
  for (const word of highlightedWords) word.classList.remove('speaking');
  highlightedWords = [];
  const known = new Set(knownWords.flatMap(item => item.variants));
  for (const group of caption.querySelectorAll('.word-translation')) {
    group.classList.toggle('segment-active', time >= Number(group.dataset.segmentStart) && time < Number(group.dataset.segmentEnd));
    const sourceWords = [...group.querySelectorAll('.source-words .spoken-word')];
    for (const word of sourceWords) word.classList.toggle('known-word', known.has(normalizeWord(word.textContent)));
    group.querySelector('.word-meaning')?.classList.toggle('known-word', sourceWords.length > 0 && sourceWords.every(word => word.classList.contains('known-word')));
  }
  const wordIndex = heldSentence ? -1 : active?.words.findIndex(word => time >= word.start && time < word.end) ?? -1;
  if (wordIndex >= 0) {
    const previewWord = caption.querySelectorAll('.source-words .spoken-word')[wordIndex];
    const meaning = previewWord?.closest('.word-translation').querySelector('.word-meaning');
    const word = active.words[wordIndex];
    const index = cues.findIndex(cue => cue.words?.includes(word));
    const editorWord = $('cues').children[index]?.querySelectorAll('.spoken-word')[cues[index]?.words.indexOf(word)];
    highlightedWords = [previewWord, meaning?.textContent ? meaning : undefined, editorWord].filter(Boolean);
    for (const word of highlightedWords) word.classList.add('speaking');
  }
  updateHighlightLayer();
  updateActiveCue();
}
wordTrack.addEventListener('cuechange', updateTurkish);
player.addEventListener('pause', updateTurkish);
player.addEventListener('seeked', updateTurkish);
function updateActiveCue() {
  const time = captionTime();
  const active = pages.find(cue => time >= cue.start && time < cue.end);
  const caption = $('audio-caption');
  caption.hidden = true;
  caption.replaceChildren();
  const chunks = mappedChunks(active);
  const speaking = !heldSentence && active?.words?.some(word => time >= word.start && time < word.end);
  const chunkIndex = speaking ? chunks.findIndex(chunk => time >= chunk.start && time < chunk.end) : -1;
  for (const element of $('cues').querySelectorAll('.native-chunks .speaking')) element.classList.remove('speaking');
  if (chunks.length) {
    chunks.forEach((chunk, i) => {
      const span = document.createElement('span'); span.className = 'spoken-word'; span.textContent = chunk.text;
      span.classList.toggle('speaking', i === chunkIndex); caption.append(span, ' ');
    });
    if (chunkIndex >= 0) {
      const chunk = chunks[chunkIndex];
      const index = cues.findIndex(cue => cue.chunks?.includes(chunk));
      $('cues').children[index]?.querySelector('.native-chunks')?.children[cues[index]?.chunks.indexOf(chunk)]?.classList.add('speaking');
    }
  } else caption.textContent = active ? wrapText(active.text) : '';
}
track.addEventListener('cuechange', updateActiveCue);
function updateTrack() {
  clearTrack();
  cues.forEach((cue, index) => {
    const preview = $('cues').children[index]?.querySelector('.native-chunks');
    if (!preview) return;
    preview.replaceChildren();
    const chunks = mappedChunks(cue);
    preview.hidden = !chunks.length;
    for (const chunk of chunks) {
      const span = document.createElement('span'); span.className = 'spoken-word'; span.textContent = chunk.text;
      preview.append(span, ' ');
    }
  });
  for (const cue of cues) for (const word of cue.words || []) {
    wordTrack.addCue(new VTTCue(word.start / 1000, word.end / 1000, word.text));
  }
  updateTurkish();
  try {
    validateCues(cues);
    for (const cue of pages) track.addCue(new VTTCue(cue.start / 1000, cue.end / 1000,
      wrapText(cue.text).split('\n').map(cueText).join('\n')));
    track.mode = 'hidden';
    updateActiveCue();
    const long = cues.filter(cue => wrapText(cue.text).split('\n').length > 2 || cue.end - cue.start < 800);
    $('edit-status').textContent = long.length ? `${long.length} undertekster er lange eller vises kort. Kontroller lesbarheten i avspilleren.` : '';
    if (cues.some(cue => cue.chunks?.length && !mappedChunks(cue).length)) {
      $('edit-status').textContent += ' Norsk delmarkering er slått av for endret tekst, siden ordkoblingen ikke lenger er sikker.';
    }
    $('download-zip').disabled = false;
  } catch (error) {
    $('edit-status').textContent = error.message;
    $('download-zip').disabled = true;
  }
}

function renderCues() {
  $('cues').replaceChildren();
  cues.forEach((cue, index) => {
    const row = document.createElement('div'); row.className = 'cue';
    const top = document.createElement('div'); top.className = 'cue-top';
    const seek = document.createElement('button'); seek.type = 'button'; seek.className = 'ghost';
    seek.textContent = `▶ ${index + 1}`; seek.setAttribute('aria-label', `Spill undertekst ${index + 1}`);
    seek.onclick = () => { cancelSentencePlayback(); player.currentTime = cue.start / 1000; void player.play().catch(() => {}); };
    top.append(seek);
    for (const [field, title] of [['start', 'Fra (sek.)'], ['end', 'Til (sek.)']]) {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '600'; input.step = '0.001';
      input.value = String(cue[field] / 1000); input.setAttribute('aria-label', `${title}, undertekst ${index + 1}`);
      input.oninput = () => { cue[field] = input.valueAsNumber * 1000; edited(); updateTrack(); };
      label.append(input); top.append(label);
    }
    const original = document.createElement('p'); original.lang = 'tr';
    if (cue.words?.length) for (const word of cue.words) {
      const span = document.createElement('span'); span.className = 'spoken-word'; span.textContent = word.text;
      original.append(span, ' ');
    } else original.textContent = cue.turkish;
    const text = document.createElement('textarea'); text.value = cue.text; text.setAttribute('aria-label', `Norsk undertekst ${index + 1}`);
    text.oninput = () => { cue.text = text.value; edited(); updateTrack(); };
    const native = document.createElement('p'); native.className = 'native-chunks'; native.lang = 'nb';
    native.setAttribute('aria-label', 'Norsk betydning, delen som uttales er markert');
    row.append(top, original, native, text); $('cues').append(row);
  });
  showEditor(false);
  $('subtitle-actions').hidden = false;
  updateTrack();
  updatePlayButtons();
}

player.addEventListener('error', () => {
  updatePlayButtons();
  $('preview-help').textContent = player.error?.message || 'Kan ikke spille av videoen. Velg en annen YouTube-video.';
});
player.addEventListener('autoplayblocked', () => { $('preview-help').textContent = 'Trykk spill av i YouTube-spilleren for å starte.'; });
function updateMediaLayout() {
  player.classList.toggle('audio-only', player.readyState >= 1 && player.videoWidth === 0 && player.videoHeight === 0);
  const overlay = $('overlay-text').checked && player.readyState >= 1 && player.videoWidth > 0;
  const text = $('subtitle-text');
  const parent = $(overlay ? 'video-stage' : 'subtitle-home');
  if (text.parentElement !== parent) parent.append(text);
  text.classList.toggle('video-overlay', overlay);
}
player.addEventListener('resize', updateMediaLayout);
player.addEventListener('emptied', updateMediaLayout);
player.addEventListener('loadedmetadata', () => {
  updateMediaLayout();
  restorePosition();
  updatePlayButtons();
  $('preview-help').textContent = '';
  updateActiveCue();
});
player.addEventListener('emptied', updatePlayButtons);
player.addEventListener('timeupdate', () => {
  const time = player.currentTime * 1000;
  if (!player.paused && !player.seeking && previousPlaybackTime !== undefined) {
    const completed = pages.findLast(page => {
      const end = page.words.at(-1)?.end ?? page.end;
      return end > previousPlaybackTime && end <= time;
    });
    if (completed) savePosition(completed.words.at(-1)?.end ?? completed.end);
  }
  previousPlaybackTime = player.seeking ? undefined : time;
  stopAtSentenceEnd();
  stopAtSegmentEnd();
  if (!player.paused) {
    lastSentence = sentencePlayback || sentenceAt(cues, player.currentTime * 1000) || lastSentence;
  }
  updatePlayButtons();
  updateTurkish();
  updateActiveCue();
  Array.from($('cues').children).forEach((row, index) => {
    const cue = cues[index];
    row.classList.toggle('active', Boolean(cue && player.currentTime * 1000 >= cue.start && player.currentTime * 1000 < cue.end));
  });
});

let youtubeConfigured = false;
let subtitleReadyThrough;
function updateSubtitleReadiness() {
  if (translationSections.length) {
    const section = translationSections.find(item => player.currentTime * 1000 >= item.start && player.currentTime * 1000 < item.end);
    $('preview-help').textContent = !section || section.state === 'done' ? '' : section.state === 'error'
      ? 'Oversettelsen for denne delen feilet. Prøv de røde delene igjen.' : 'Undertekstene for denne delen er ikke klare ennå.';
    return;
  }
  if (subtitleReadyThrough !== undefined) $('preview-help').textContent = player.currentTime * 1000 >= subtitleReadyThrough
    ? 'Undertekstene for denne delen er ikke klare ennå.' : '';
}
function coverageTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
async function monitorSections(id, version, retry = false) {
  if (!id || !youtubeConfigured || !isYoutubeVideo(sourceName)) return;
  const current = () => version === sectionMonitorVersion && savedId === id;
  let runningId;
  let revision = -1;
  try {
    while (current()) {
      if (dirty || saving || busy) return;
      if (!runningId) {
        const response = await fetch('/api/subtitles/ensure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ savedId: id, retry, position: Math.max(0, Math.min(7200000, (pendingPosition ?? player.currentTime) * 1000)) }) });
        if (!current()) return;
        if (response.status === 429) {
          $('coverage-status').textContent = 'Venter på at en annen video blir ferdig …';
          await new Promise(resolve => setTimeout(resolve, 5000)); continue;
        }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Kunne ikke kontrollere oversettelsene.');
        retry = false;
        if (result.complete) {
          const latest = await json(`/api/subtitle-library/${encodeURIComponent(id)}`);
          if (!current()) return;
          translationSections = latest.sections || result.sections || [];
          if (!dirty && !saving) { cues = latest.cues; editorNeedsRender = true; updateTrack(); updatePlayButtons(); }
          updateTranslationCoverage(); return;
        }
        runningId = result.id;
        priorityJobId = runningId; updateSectionPriority();
        sectionWorkActive = true;
        $('save-subtitles').disabled = true;
      }
      const job = await json(`/api/subtitles/${runningId}`);
      if (!current()) return;
      translationSections = job.sections || [];
      if (revision !== job.revision && !dirty && !saving) {
        cues = job.cues || []; revision = job.revision;
        editorNeedsRender = true; updateTrack(); updatePlayButtons();
        if (!player.getAttribute('src') && (job.playbackUrl || job.audioUrl)) player.src = job.playbackUrl || job.audioUrl;
      }
      updateTranslationCoverage();
      if (job.state === 'error' || job.state === 'done') {
        if (job.error) $('coverage-status').textContent = job.error;
        await loadLibrary(); return;
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (error) {
    if (current()) { $('coverage-status').textContent = error.message; $('preview-help').textContent = error.message; }
    if (current() && !translationSections.some(section => section.state === 'error')) {
      setTimeout(() => { if (current()) void monitorSections(id, version); }, 5000);
    }
  } finally {
    if (current()) { sectionWorkActive = false; priorityJobId = undefined; $('save-subtitles').disabled = !storage; }
  }
}
$('retry-sections').onclick = () => {
  if (sectionWorkActive || busy) return;
  void monitorSections(savedId, ++sectionMonitorVersion, true);
};
function updateCoveragePosition() {
  if ($('translation-coverage').hidden) return;
  const position = Math.max(0, Math.min(player.duration, player.currentTime));
  $('coverage-playhead').style.left = `${position / player.duration * 100}%`;
  $('coverage-position').textContent = `${coverageTime(position)} / ${coverageTime(player.duration)}`;
  $('coverage-current-time').textContent = coverageTime(position);
  $('coverage-bar').style.setProperty('--position', `${position / player.duration * 100}%`);
  $('coverage-bar').setAttribute('aria-valuemax', String(player.duration));
  $('coverage-bar').setAttribute('aria-valuenow', String(position));
  $('coverage-bar').setAttribute('aria-valuetext', `${coverageTime(position)} av ${coverageTime(player.duration)}`);
}
function seekCoverage(seconds, play = false) {
  if (!Number.isFinite(player.duration) || player.duration <= 0) return;
  pendingPosition = undefined;
  cancelSegmentPause(); cancelSentencePlayback();
  player.currentTime = Math.max(0, Math.min(player.duration, seconds));
  updateCoveragePosition(); updateSectionPriority(); updateTurkish();
  if (play) void player.play().catch(() => { $('preview-help').textContent = 'Trykk på spill av for å starte videoen.'; });
}
$('coverage-bar').onclick = event => {
  const bounds = $('coverage-bar').getBoundingClientRect();
  if (bounds.width > 0) seekCoverage((event.clientX - bounds.left) / bounds.width * player.duration, true);
};
$('coverage-bar').onkeydown = event => {
  const positions = { ArrowLeft: player.currentTime - 5, ArrowDown: player.currentTime - 5,
    ArrowRight: player.currentTime + 5, ArrowUp: player.currentTime + 5,
    PageDown: player.currentTime - 30, PageUp: player.currentTime + 30, Home: 0, End: player.duration };
  if (Object.hasOwn(positions, event.key)) { event.preventDefault(); seekCoverage(positions[event.key]); }
  else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); seekCoverage(player.currentTime, true); }
};
function updateTranslationCoverage() {
  const duration = player.duration * 1000;
  $('translation-coverage').hidden = !Number.isFinite(duration) || duration <= 0;
  const container = $('coverage-ranges');
  container.replaceChildren();
  if ($('translation-coverage').hidden) return;
  const ranges = [];
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    if (!cue.text?.trim() || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)) continue;
    const start = Math.max(0, cue.start);
    const end = Math.min(duration, cue.end);
    if (end <= start) continue;
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }
  const fragment = document.createDocumentFragment();
  let covered = 0;
  for (const { start, end } of ranges) {
    const span = document.createElement('span');
    span.className = 'coverage-range';
    span.style.left = `${start / duration * 100}%`;
    span.style.width = `${(end - start) / duration * 100}%`;
    fragment.append(span);
    covered += end - start;
  }
  for (const section of translationSections) {
    if (!['loading', 'done', 'error'].includes(section.state)) continue;
    const span = document.createElement('span');
    span.className = `coverage-range ${section.state}`;
    span.style.left = `${Math.max(0, section.start) / duration * 100}%`;
    span.style.width = `${Math.max(0, Math.min(duration, section.end) - Math.max(0, section.start)) / duration * 100}%`;
    span.title = `${coverageTime(section.start / 1000)}–${coverageTime(section.end / 1000)}: ${section.error || ({ done: 'Ferdig', loading: 'Behandles', error: 'Feil' })[section.state]}`;
    fragment.append(span);
  }
  const known = new Set(knownWords.flatMap(group => group.variants));
  const knownRanges = [];
  for (const word of cues.flatMap(cue => cue.words || []).filter(word => known.has(normalizeWord(word.text))).sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, word.start), end = Math.min(duration, word.end);
    if (end <= start) continue;
    const previous = knownRanges.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else knownRanges.push({ start, end });
  }
  for (const { start, end } of knownRanges) {
    const span = document.createElement('span'); span.className = 'coverage-range known';
    span.style.left = `${start / duration * 100}%`;
    span.style.width = `${(end - start) / duration * 100}%`;
    span.title = `${coverageTime(start / 1000)}–${coverageTime(end / 1000)}: Kjent ord`;
    fragment.append(span);
  }
  container.append(fragment);
  const done = translationSections.filter(section => section.state === 'done').length;
  const loading = translationSections.filter(section => section.state === 'loading').length;
  const errors = translationSections.filter(section => section.state === 'error').length;
  const complete = translationSections.length > 0 && done === translationSections.length;
  $('translation-coverage').querySelector('.coverage-legend').hidden = complete;
  $('coverage-status').hidden = complete;
  const summary = translationSections.length ? `${done} av ${translationSections.length} deler klare · ${loading} behandles · ${errors} med feil` : `Undertekster dekker ${Math.round(covered / duration * 100)} % av tidslinjen. Kontrollerer resten …`;
  $('coverage-status').textContent = summary;
  $('retry-sections').hidden = !errors;
  updateCoveragePosition();
}
for (const event of ['loadedmetadata', 'durationchange', 'emptied']) player.addEventListener(event, updateTranslationCoverage);
for (const event of ['timeupdate', 'seeking']) player.addEventListener(event, updateCoveragePosition);
player.addEventListener('timeupdate', updateSubtitleReadiness);
async function generateSubtitles(event) {
  event.preventDefault();
  if (!youtubeConfigured || !canReplace()) return;
  player.pause();
  busy = true;
  $('toggle-editor').disabled = true;
  $('generate-youtube').disabled = $('youtube-url').disabled = true;
  translationSections = []; sectionMonitorVersion++;
  cues = []; clearTrack(); showEditor(false); $('subtitle-actions').hidden = true;
  $('progress').hidden = false; $('progress').removeAttribute('value');
  controller = new AbortController();
  try {
    message('Henter YouTube-video …');
    savedId = undefined; sourceName = $('youtube-url').value.trim(); $('subtitle-title').value = sourceName; dirty = false;
    const created = await json('/api/subtitles/youtube', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: sourceName }), signal: controller.signal });
    jobId = created.id; $('cancel').hidden = false;
    priorityJobId = jobId; lastPrioritySection = undefined;
    let received = 0;
    let previewStarted = false;
    while (true) {
      controller.signal.throwIfAborted();
      const job = await json(`/api/subtitles/${jobId}`, { signal: controller.signal });
      subtitleReadyThrough = job.readyThrough;
      updateSubtitleReadiness();
      translationSections = job.sections || [];
      if (!previewStarted && job.savedId) {
        openSaved({ id: job.savedId, title: job.title || sourceName, source: job.source, cues: job.cues || [], audioUrl: job.audioUrl, sections: translationSections });
        previewStarted = true;
        $('recordings').hidden = true;
        const url = new URL(location.href);
        url.searchParams.set('view', 'play'); url.searchParams.set('subtitle', job.savedId); url.searchParams.delete('t');
        history.replaceState({ subtitleCard: true }, '', url);
      } else if (job.revision !== received) {
        cues = job.cues || [];
        pages = sentencePages(cues);
        editorNeedsRender = true;
        updateTrack(); updatePlayButtons();
      }
      received = job.revision;
      updateSectionPriority();
      updateTranslationCoverage();
      if (job.state === 'error') throw new Error(job.error);
      if (job.state === 'done') {
        subtitleReadyThrough = undefined; $('preview-help').textContent = '';
        savedId = job.savedId;
        dirty = !savedId;
        $('save-status').textContent = job.saveError || (savedId ? 'Lagret automatisk' : 'Ikke lagret. Bruk Lagre.');
        await loadLibrary();
        message(`Ferdig! ${cues.length} undertekster er klare.`); break;
      }
      $('save-status').textContent = previewStarted ? 'Lagrer nye undertekster fortløpende' : '';
      message(job.state === 'downloading' ? 'Henter YouTube-video …' : job.state === 'extracting' ? 'Henter lyden fra videoen …'
        : `Undertekster: ${job.completed} av ${job.total} deler klare${previewStarted ? '. Du kan spille av nå.' : ' …'}`);
      if (job.total) { $('progress').max = job.total; $('progress').value = job.completed; }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (error) {
    message(controller.signal.aborted ? 'Behandlingen er avbrutt.' : error.message, !controller.signal.aborted);
  } finally {
    if (jobId && controller.signal.aborted) void fetch(`/api/subtitles/${jobId}`, { method: 'DELETE' }).catch(() => {});
    jobId = undefined; busy = false;
    priorityJobId = undefined;
    $('toggle-editor').disabled = false;
    $('generate-youtube').disabled = !youtubeConfigured; $('youtube-url').disabled = false;
    $('cancel').hidden = true; $('progress').hidden = true;
    updateTranslationCoverage();
  }
}
$('youtube-form').addEventListener('submit', event => generateSubtitles(event));
$('cancel').onclick = () => controller?.abort();

$('download-zip').onclick = () => {
  try {
    const filename = sourceName.startsWith('https://www.youtube.com/') ? $('subtitle-title').value : sourceName;
    const name = (filename.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'undertekster') + '.nb';
    const archive = zipFiles(Object.fromEntries(['srt', 'vtt'].map(format => [name + '.' + format, serializeSubtitles(cues, format)])));
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a'); link.href = url;
    link.download = name + '.zip';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { $('edit-status').textContent = error.message; }
};

try {
  const settings = await json('/api/subtitles');
  youtubeConfigured = Boolean(settings.youtube && settings.configured && settings.storage);
  $('generate-youtube').disabled = !youtubeConfigured;
  $('generate-youtube').title = youtubeConfigured ? '' : 'YouTube-import er ikke konfigurert på serveren';
  configured = settings.configured;
  storage = Boolean(settings.storage);
  await loadLibrary();
  message(configured ? '' : 'Undertekster er ikke konfigurert ennå. Serveren trenger Azure Speech.', !configured);
} catch { message('Kunne ikke kontakte serveren. Last siden på nytt.', true); }
await showRoute();
