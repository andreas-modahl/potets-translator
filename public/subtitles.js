import { cueText, serializeSubtitles, validateCues, wrapText, mappedChunks, sentencePages, naturalSegments, pauseSegments, SUFFIX_HINTS, validEmojiHint } from './subtitles-format.js';
import { zipFiles } from './subtitles-zip.js';

const $ = id => document.getElementById(id);
for (const id of ['auto-pause', 'show-sentence', 'show-gloss', 'show-norwegian-badge', 'show-natural', 'show-focus', 'show-emoji']) {
  const checkbox = $(id);
  const key = `subtitles:${id}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'true' || saved === 'false') checkbox.checked = saved === 'true';
  } catch { /* Keep the defaults when browser storage is unavailable. */ }
  checkbox.addEventListener('change', () => {
    try { localStorage.setItem(key, String(checkbox.checked)); }
    catch { /* The control still works when browser storage is unavailable. */ }
  });
}
const fileInput = $('media-file');
const generate = $('generate');
const player = $('player');
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
let mediaUrl;
let jobId;
let controller;
let cues = [];
let pages = [];
let savedId;
let sharedStory = false;
let sourceName = '';
let dirty = false;
let revision = 0;
let saving = false;
let storage = false;
let maxBytes = 100 * 1024 * 1024;
let sentencePlayback;
let lastSentence;
let sentenceTimer;
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
function resetAudioFade(fadeIn = false) {
  pauseFadeKey = undefined;
  if (!playbackGain) return;
  const now = playbackAudio.currentTime;
  const gain = playbackGain.gain;
  gain.cancelAndHoldAtTime(now);
  if (player.paused) { gain.setValueAtTime(0, now); return; }
  if (fadeIn) gain.setValueAtTime(0, now);
  gain.linearRampToValueAtTime(1, now + .02);
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
  // A brief audio-clock ramp softens the boundary without moving subtitle timings.
  gain.cancelAndHoldAtTime(now);
  const fadeDuration = Math.min(.025, remaining / 2);
  const fadeStart = now + remaining - fadeDuration;
  gain.linearRampToValueAtTime(1, Math.min(now + .015, fadeStart));
  gain.setValueAtTime(1, fadeStart);
  gain.linearRampToValueAtTime(0, now + remaining);
}
async function startPlaybackAudio() {
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
      playbackAudio.createMediaElementSource(player).connect(gain);
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
let segmentDelay = 0;
try {
  const enabled = localStorage.getItem('subtitles:pause-segments') ?? localStorage.getItem('subtitles:pause-words');
  const legacy = enabled === 'true' ? localStorage.getItem('subtitles:segment-pause-seconds') ?? localStorage.getItem('subtitles:word-pause-seconds') ?? '1' : '0';
  const saved = Number(localStorage.getItem('subtitles:segment-delay-seconds') ?? legacy);
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
  try { localStorage.setItem('subtitles:segment-delay-seconds', String(segmentDelay)); } catch {}
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
  if ($('auto-pause').checked && !player.paused && !sentencePlayback) {
    sentencePlayback = sentenceAt(cues, player.currentTime * 1000);
    lastSentence = sentencePlayback || lastSentence;
  }
  stopAtSentenceEnd();
}
$('auto-pause').onchange = () => {
  if ($('auto-pause').checked) armAutoPause();
  else cancelSentencePlayback();
  schedulePauseFade();
};
$('show-sentence').onchange = updateTurkish;
$('show-gloss').onchange = updateTurkish;
$('show-norwegian-badge').onchange = updateTurkish;
$('show-natural').onchange = updateTurkish;
$('show-focus').onchange = updateTurkish;
$('show-emoji').onchange = () => {
  shownTurkish = shownNatural = shownFocusHint = shownEmojiKey = undefined;
  failedEmoji.clear(); emojiStatus(); updateTurkish();
};
function releaseSentence() {
  heldSentence = undefined;
  updateTurkish();
}
function cancelSentencePlayback() {
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
    cancelSegmentPause(); cancelSentencePlayback(); player.pause(); player.currentTime = end;
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
    sentencePlayback = sentence;
    stopAtSentenceEnd();
  } catch { message('Kunne ikke spille av setningen. Velg lydfilen på nytt.', true); }
}
for (const button of document.querySelectorAll('[data-sentence-speed]')) {
  button.onclick = () => playSentence(lastSentence || sentenceAt(cues, player.currentTime * 1000), Number(button.dataset.sentenceSpeed));
}
$('play-sentence').onclick = () => playSentence(sentenceAt(cues, player.currentTime * 1000), 1);
player.addEventListener('pause', () => {
  if (heldSegment) return;
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
function showEditor(open) {
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
function showUpload(open) {
  $('add-recording').hidden = !open;
  $('toggle-upload').setAttribute('aria-expanded', String(open));
}
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
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  const id = params.get('subtitle');
  const position = Number(params.get('t'));
  pendingPosition = view === 'play' && params.has('t') && Number.isFinite(position) && position >= 0 ? position : undefined;
  cancelSegmentPause(); player.pause(); showEditor(false);
  $('recordings').hidden = view === 'upload' || view === 'play';
  showUpload(view === 'upload');
  $('preview').hidden = true;
  if (view === 'play') {
    try {
      if (id && id !== savedId) {
        const saved = await json(`/api/subtitle-library/${encodeURIComponent(id)}`);
        if (version !== routeVersion) return;
        if (!canReplace()) { navigate('', undefined, true); return; }
        openSaved(saved);
      } else if (!cues.length) { navigate('', undefined, true); return; }
      $('preview').hidden = false;
      restorePosition();
      $('playback-heading').focus();
    } catch (error) {
      if (version !== routeVersion) return;
      navigate('', undefined, true); message(error.message, true);
    }
  } else if (view === 'upload') $('upload-heading').focus();
  else $('toggle-upload').focus();
}
$('toggle-upload').onclick = () => navigate('upload');
for (const button of document.querySelectorAll('.close-card')) button.onclick = () => {
  if (history.state?.subtitleCard) history.back();
  else navigate('', undefined, true);
};
window.addEventListener('popstate', () => void showRoute());
$('toggle-editor').onclick = () => showEditor($('result').hidden);
function edited() { dirty = true; revision += 1; $('save-status').textContent = 'Ulagrede endringer'; }
function canReplace() { return !busy && !saving && (!dirty || window.confirm('Du har ulagrede endringer. Fortsette uten å lagre?')); }
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
async function loadLibrary() {
  try {
    const data = await json('/api/subtitle-library');
    storage = data.storage !== false;
    $('library-status').textContent = data.scope === 'local' ? '' : data.scope === 'account'
      ? 'Lagret på kontoen din.' : 'Lagret for denne nettleseren. Behold informasjonskapslene for å finne dem igjen.';
    $('library').replaceChildren();
    if (!data.items.length) $('library-status').textContent += ' Ingen undertekster ennå.';
    for (const item of data.items) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost';
      button.textContent = item.shared ? `${item.title} · Fortelling` : `${item.title} · ${new Date(item.updated).toLocaleDateString('nb-NO')}`;
      button.onclick = () => { if (!busy && !saving) navigate('play', item.id); };
      $('library').append(button);
    }
  } catch (error) { $('library-status').textContent = error.message; }
  $('save-subtitles').disabled = !storage;
}
function showSelection(id, label, name, suffix = '') {
  const value = document.createElement('strong');
  value.textContent = name;
  $(id).replaceChildren(label, value, suffix);
}
function openSaved(saved) {
  cancelSegmentPause(); player.pause(); player.removeAttribute('src'); player.load();
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = undefined; fileInput.value = ''; $('playback-file').value = '';
  savedId = saved.id; sourceName = saved.source; cues = saved.cues;
  sharedStory = Boolean(saved.shared);
  $('save-subtitles').textContent = sharedStory ? 'Lagre egen kopi' : 'Lagre endringer';
  $('subtitle-title').value = saved.title;
  dirty = false; revision += 1;
  renderCues(); $('preview').hidden = false;
  showSelection('playback-selection', 'Valgte undertekster: ', saved.title);
  $('selected-media').hidden = !saved.audioUrl;
  showSelection('selected-media', 'Valgt media: ', saved.audioUrl ? sourceName : '', saved.audioUrl ? ' (fra storybook)' : '');
  showUpload(false);
  $('playback-label').textContent = `Velg originalfilen «${sourceName}» for avspilling (ingen ny oversettelse)`;
  if (saved.audioUrl) {
    player.src = saved.audioUrl;
    $('playback-label').hidden = $('playback-file').hidden = true;
    $('preview-help').textContent = 'Laster lyd …';
    message('');
  } else {
    $('playback-label').hidden = $('playback-file').hidden = false;
    $('preview-help').textContent = 'Velg originalfilen ovenfor for å aktivere avspilling.';
    message('Undertekstene er åpnet. Velg original lyd/video under «Se og lytt» for å spille av.');
  }
  $('save-status').textContent = 'Lagret';
  $('playback-heading').focus();
}
function updatePlayButtons() {
  $('sentence-actions').hidden = !cues.length;
  $('play-sentence').disabled = !player.getAttribute('src') || player.readyState < 1 || Boolean(player.error) || !sentenceAt(cues, player.currentTime * 1000);
  for (const button of document.querySelectorAll('[data-sentence-speed]')) {
    button.disabled = !player.getAttribute('src') || player.readyState < 1 || Boolean(player.error) || !(lastSentence || sentenceAt(cues, player.currentTime * 1000));
  }
  for (const button of $('cues').querySelectorAll('.cue-top button')) {
    button.disabled = !player.getAttribute('src') || player.readyState < 1 || Boolean(player.error);
    button.title = button.disabled ? 'Velg original lyd/video for å spille av' : 'Spill av denne underteksten';
  }
}
$('playback-file').onchange = () => {
  const file = $('playback-file').files[0]; if (!file) return;
  cancelSegmentPause(); player.pause(); if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = URL.createObjectURL(file); player.src = mediaUrl;
  $('selected-media').hidden = false;
  showSelection('selected-media', 'Valgt media: ', file.name);
};
$('subtitle-title').oninput = edited;
$('save-subtitles').onclick = async () => {
  if (saving || busy || !storage) return;
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
$('import-subtitles').onchange = async () => {
  const file = $('import-subtitles').files[0];
  if (!file || !canReplace()) return;
  busy = true;
  try {
    if (file.size > 2_000_000) throw new Error('Filen er for stor (maks 2 MB).');
    const data = JSON.parse(await file.text());
    const saved = await json('/api/subtitle-library', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: data.title || data.source || file.name, source: data.source || '', cues: data.cues }) });
    openSaved(saved); navigate('play', saved.id, true); await loadLibrary();
  } catch (error) { $('library-status').textContent = error.message; }
  finally { busy = false; $('import-subtitles').value = ''; }
};
async function json(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Forespørselen feilet. Prøv igjen.');
  return data;
}
function clearTrack() {
  cancelSegmentPause();
  pages = sentencePages(cues);
  cancelSentencePlayback();
  lastSentence = undefined;
  heldSentence = undefined;
  $('sentence-actions').hidden = !cues.length;
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
}
function updateTurkish() {
  const time = captionTime();
  // Source word times stay tied to the speech when Norwegian cue times are edited.
  const active = pages.find(cue => cue.words?.length && time >= cue.words[0].start && time < cue.words.at(-1).end)
    || pages.findLast(cue => cue.words?.length && cue.words[0].start <= time)
    || pages.find(cue => cue.words?.length);
  const caption = $('turkish-caption');
  void ensureEmojiHints(active);
  updateNatural(active);
  const hasWords = cues.some(cue => cue.words?.length);
  caption.hidden = !hasWords || !$('show-sentence').checked;
  caption.classList.toggle('hide-gloss', !$('show-gloss').checked);
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
        const source = document.createElement('span'); source.className = 'source-words';
        const translation = document.createElement('span'); translation.className = 'word-meaning spoken-word';
        translation.lang = 'nb'; translation.textContent = chunk?.text || '';
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
  updateActiveCue();
}
wordTrack.addEventListener('cuechange', updateTurkish);
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

fileInput.addEventListener('change', () => {
  if (!canReplace()) { fileInput.value = ''; return; }
  savedId = undefined; sharedStory = false; dirty = false;
  cues = []; clearTrack(); showEditor(false); $('subtitle-actions').hidden = true;
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  const file = fileInput.files[0];
  $('preview').hidden = true;
  $('playback-selection').textContent = '';
  $('selected-media').hidden = !file;
  showSelection('selected-media', 'Valgt media: ', file?.name || '');
  $('playback-label').hidden = $('playback-file').hidden = true;
  if (file) { sourceName = file.name; $('subtitle-title').value = file.name; mediaUrl = URL.createObjectURL(file); player.src = mediaUrl; }
  message('Klar til å lage undertekster.');
});
player.addEventListener('error', () => {
  $('playback-label').hidden = $('playback-file').hidden = false;
  updatePlayButtons();
  $('preview-help').textContent = 'Nettleseren kan ikke spille av denne filtypen. Du kan fortsatt lage og laste ned undertekster.';
});
function updateMediaLayout() {
  player.classList.toggle('audio-only', player.readyState >= 1 && player.videoWidth === 0 && player.videoHeight === 0);
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

$('upload-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!configured || !canReplace()) return;
  const file = fileInput.files[0];
  if (!file || !file.size) { message('Velg en fil med lyd.', true); return; }
  if (file.size > maxBytes) { message('Filen er for stor. Grensen er 100 MB.', true); return; }
  if (Number.isFinite(player.duration) && player.duration > 600) { message('Opptaket må være på høyst 10 minutter.', true); return; }
  busy = true; generate.disabled = true; fileInput.disabled = true;
  cues = []; clearTrack(); showEditor(false); $('subtitle-actions').hidden = true;
  $('progress').hidden = false; $('progress').removeAttribute('value');
  controller = new AbortController();
  try {
    message('Laster opp opptaket …');
    savedId = undefined; sourceName = file.name; $('subtitle-title').value = file.name; dirty = false;
    const created = await json('/api/subtitles', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file, signal: controller.signal });
    jobId = created.id; $('cancel').hidden = false;
    while (true) {
      controller.signal.throwIfAborted();
      const job = await json(`/api/subtitles/${jobId}`, { signal: controller.signal });
      if (job.state === 'error') throw new Error(job.error);
      if (job.state === 'done') {
        cues = job.cues; renderCues();
        savedId = job.savedId;
        navigate('play', savedId, true);
        dirty = !savedId;
        $('save-status').textContent = job.saveError || (savedId ? 'Lagret automatisk' : 'Ikke lagret. Last ned filen eller bruk Lagre.');
        await loadLibrary();
        message(cues.length === 1 ? 'Ferdig! Én undertekst er klar til gjennomlesing.' : `Ferdig! ${cues.length} undertekster er klare til gjennomlesing.`); break;
      }
      message(job.state === 'extracting' ? 'Henter lyden fra opptaket …' : job.state === 'transcribing'
        ? 'Lytter til den tyrkiske talen …' : `Lager norsk tekst i tyrkisk rekkefølge: ${job.completed} av ${job.total} taledeler …`);
      if (job.total) { $('progress').max = job.total; $('progress').value = job.completed; }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (error) {
    message(controller.signal.aborted ? 'Behandlingen er avbrutt.' : error.message, !controller.signal.aborted);
  } finally {
    if (jobId) void fetch(`/api/subtitles/${jobId}`, { method: 'DELETE' }).catch(() => {});
    jobId = undefined; busy = false; generate.disabled = !configured; fileInput.disabled = false;
    $('cancel').hidden = true; $('progress').hidden = true;
  }
});
$('cancel').onclick = () => controller?.abort();

$('download-zip').onclick = () => {
  try {
    const name = (sourceName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'undertekster') + '.nb';
    const archive = zipFiles(Object.fromEntries(['srt', 'vtt'].map(format => [name + '.' + format, serializeSubtitles(cues, format)])));
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a'); link.href = url;
    link.download = name + '.zip';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { $('edit-status').textContent = error.message; }
};

try {
  const settings = await json('/api/subtitles');
  configured = settings.configured; maxBytes = settings.maxBytes; generate.disabled = !configured;
  storage = Boolean(settings.storage);
  await loadLibrary();
  message(configured ? '' : 'Undertekster er ikke konfigurert ennå. Serveren trenger Azure Speech.', !configured);
} catch { message('Kunne ikke kontakte serveren. Last siden på nytt.', true); }
await showRoute();
