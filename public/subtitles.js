import { cueText, serializeSubtitles, validateCues, wrapText, mappedChunks, sentencePages } from './subtitles-format.js';
import { zipFiles } from './subtitles-zip.js';

const $ = id => document.getElementById(id);
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
  const remaining = sentencePlayback.end / 1000 - player.currentTime;
  if (remaining <= .012) {
    const end = sentencePlayback.end / 1000;
    heldSentence = sentencePlayback;
    lastSentence = sentencePlayback;
    savePosition(sentencePlayback.end);
    cancelSentencePlayback(); player.pause(); player.currentTime = end;
    updateTurkish();
    updatePlayButtons();
  } else sentenceTimer = setTimeout(stopAtSentenceEnd, Math.max(10, remaining * 1000 / player.playbackRate));
}
async function playSentence(sentence, speed = player.playbackRate) {
  if (!sentence) return;
  lastSentence = sentence;
  heldSentence = undefined;
  cancelSentencePlayback(); player.pause();
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
player.addEventListener('pause', cancelSentencePlayback);
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
  player.pause(); showEditor(false);
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
  player.pause(); player.removeAttribute('src'); player.load();
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
  player.pause(); if (mediaUrl) URL.revokeObjectURL(mediaUrl);
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
  pages = sentencePages(cues);
  cancelSentencePlayback();
  lastSentence = undefined;
  heldSentence = undefined;
  $('sentence-actions').hidden = !cues.length;
  for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
  for (const cue of Array.from(wordTrack.cues || [])) wordTrack.removeCue(cue);
  shownTurkish = undefined;
  for (const word of highlightedWords) word.classList.remove('speaking');
  highlightedWords = [];
  $('turkish-caption').replaceChildren(); $('turkish-caption').hidden = true;
  $('reading-focus').hidden = true;
  $('focus-turkish').textContent = $('focus-norwegian').textContent = '';
  $('sentence-progress').value = 0;
  $('audio-caption').textContent = ''; $('audio-caption').hidden = true;
}
function updateTurkish() {
  const time = heldSentence ? heldSentence.end - 1 : player.currentTime * 1000;
  // Source word times stay tied to the speech when Norwegian cue times are edited.
  const active = pages.find(cue => cue.words?.length && time >= cue.words[0].start && time < cue.words.at(-1).end)
    || pages.findLast(cue => cue.words?.length && cue.words[0].start <= time)
    || pages.find(cue => cue.words?.length);
  const caption = $('turkish-caption');
  const hasWords = cues.some(cue => cue.words?.length);
  caption.hidden = !hasWords;
  $('reading-focus').hidden = !hasWords;
  $('sentence-progress').value = Number.isFinite(player.duration) && player.duration > 0
    ? Math.max(0, Math.min(1, player.currentTime / player.duration)) : 0;
  // Keep the last spoken group through brief pauses and single-sentence stops.
  const focusWord = active?.words.findLast(word => word.start <= time);
  const focusChunk = focusWord && mappedChunks(active).find(chunk => focusWord.start >= chunk.start && focusWord.end <= chunk.end);
  const focusSource = focusChunk
    ? active.words.filter(word => word.start >= focusChunk.start && word.end <= focusChunk.end).map(word => word.text).join(' ')
    : focusWord?.text || '';
  if ($('focus-turkish').textContent !== focusSource) $('focus-turkish').textContent = focusSource;
  const focusMeaning = focusChunk?.text || '';
  if ($('focus-norwegian').textContent !== focusMeaning) $('focus-norwegian').textContent = focusMeaning;
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
        group.append(source, translation); caption.append(group);
      }
      const span = document.createElement('span'); span.className = 'spoken-word'; span.textContent = word.text;
      group.firstChild.append(span, ' ');
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
  const time = heldSentence ? heldSentence.end - 1 : player.currentTime * 1000;
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
