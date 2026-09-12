import { cueText, serializeSubtitles, validateCues, wrapText, mappedChunks } from './subtitles-format.js';

const $ = id => document.getElementById(id);
const fileInput = $('media-file');
const generate = $('generate');
const player = $('player');
const status = $('status');
const track = player.addTextTrack('subtitles', 'Norsk i tyrkisk ordstilling', 'nb');
track.mode = 'showing';
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
let savedId;
let sourceName = '';
let dirty = false;
let revision = 0;
let saving = false;
let storage = false;
let maxBytes = 100 * 1024 * 1024;

function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
function edited() { dirty = true; revision += 1; $('save-status').textContent = 'Ulagrede endringer'; }
function canReplace() { return !busy && !saving && (!dirty || window.confirm('Du har ulagrede endringer. Fortsette uten å lagre?')); }
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
async function loadLibrary() {
  try {
    const data = await json('/api/subtitle-library');
    storage = true;
    $('library-status').textContent = data.scope === 'local' ? 'Lagret på denne serveren.' : data.scope === 'account'
      ? 'Lagret på kontoen din.' : 'Lagret for denne nettleseren. Behold informasjonskapslene for å finne dem igjen.';
    $('library').replaceChildren();
    if (!data.items.length) $('library-status').textContent += ' Ingen undertekster ennå.';
    for (const item of data.items) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost';
      button.textContent = `${item.title} · ${new Date(item.updated).toLocaleDateString('nb-NO')}`;
      button.onclick = async () => {
        if (!canReplace()) return;
        busy = true;
        try { openSaved(await json(`/api/subtitle-library/${encodeURIComponent(item.id)}`)); }
        catch (error) { $('library-status').textContent = error.message; }
        finally { busy = false; }
      };
      $('library').append(button);
    }
  } catch (error) { $('library-status').textContent = error.message; }
  $('save-subtitles').disabled = !storage;
}
function openSaved(saved) {
  player.pause(); player.removeAttribute('src'); player.load();
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = undefined; fileInput.value = ''; $('playback-file').value = '';
  savedId = saved.id; sourceName = saved.source; cues = saved.cues;
  $('subtitle-title').value = saved.title;
  dirty = false; revision += 1;
  renderCues(); $('preview').hidden = false;
  $('playback-label').textContent = `Velg originalfilen «${sourceName}» for avspilling (ingen ny oversettelse)`;
  $('save-status').textContent = 'Lagret'; message('Undertekstene er åpnet. Du kan redigere og laste dem ned.');
}
$('playback-file').onchange = () => {
  const file = $('playback-file').files[0]; if (!file) return;
  player.pause(); if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  mediaUrl = URL.createObjectURL(file); player.src = mediaUrl;
};
$('subtitle-title').oninput = edited;
$('save-subtitles').onclick = async () => {
  if (saving || busy || !storage) return;
  try {
    validateCues(cues); saving = true;
    const version = revision;
    $('save-status').textContent = 'Lagrer …';
    const saved = await json('/api/subtitle-library' + (savedId ? `/${encodeURIComponent(savedId)}` : ''), {
      method: savedId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: $('subtitle-title').value, source: sourceName, cues }),
    });
    savedId = saved.id;
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
    openSaved(saved); await loadLibrary();
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
  for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
  for (const cue of Array.from(wordTrack.cues || [])) wordTrack.removeCue(cue);
  shownTurkish = undefined;
  for (const word of highlightedWords) word.classList.remove('speaking');
  highlightedWords = [];
  $('turkish-caption').replaceChildren(); $('turkish-caption').hidden = true;
  $('audio-caption').textContent = ''; $('audio-caption').hidden = true;
}
function updateTurkish() {
  const time = player.currentTime * 1000;
  // Source word times stay tied to the speech when Norwegian cue times are edited.
  const index = cues.findIndex(cue => cue.words?.length && time >= cue.words[0].start && time < cue.words.at(-1).end);
  const active = cues[index];
  const caption = $('turkish-caption');
  caption.hidden = !cues.some(cue => cue.words?.length);
  if (shownTurkish !== active) {
    shownTurkish = active;
    caption.replaceChildren();
    for (const word of active?.words || []) {
      const span = document.createElement('span'); span.className = 'spoken-word'; span.textContent = word.text;
      caption.append(span, ' ');
    }
  }
  for (const word of highlightedWords) word.classList.remove('speaking');
  highlightedWords = [];
  const wordIndex = active?.words.findIndex(word => time >= word.start && time < word.end) ?? -1;
  if (wordIndex >= 0) {
    const previewWord = caption.children[wordIndex];
    const editorWord = $('cues').children[index]?.querySelectorAll('.spoken-word')[wordIndex];
    highlightedWords = [previewWord, editorWord].filter(Boolean);
    for (const word of highlightedWords) word.classList.add('speaking');
  }
  updateActiveCue();
}
wordTrack.addEventListener('cuechange', updateTurkish);
player.addEventListener('seeked', updateTurkish);
function updateActiveCue() {
  const time = player.currentTime * 1000;
  const index = cues.findIndex(cue => time >= cue.start && time < cue.end);
  const active = cues[index];
  const caption = $('audio-caption');
  caption.hidden = !cues.length;
  caption.replaceChildren();
  const chunks = mappedChunks(active);
  const speaking = active?.words?.some(word => time >= word.start && time < word.end);
  const chunkIndex = speaking ? chunks.findIndex(chunk => time >= chunk.start && time < chunk.end) : -1;
  for (const element of $('cues').querySelectorAll('.native-chunks .speaking')) element.classList.remove('speaking');
  if (chunks.length) {
    chunks.forEach((chunk, i) => {
      const span = document.createElement('span'); span.className = 'spoken-word'; span.textContent = chunk.text;
      span.classList.toggle('speaking', i === chunkIndex); caption.append(span, ' ');
    });
    if (chunkIndex >= 0) $('cues').children[index]?.querySelector('.native-chunks')?.children[chunkIndex]?.classList.add('speaking');
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
    for (const cue of cues) track.addCue(new VTTCue(cue.start / 1000, cue.end / 1000,
      wrapText(cue.text).split('\n').map(cueText).join('\n')));
    track.mode = 'showing';
    updateActiveCue();
    const long = cues.filter(cue => wrapText(cue.text).split('\n').length > 2 || cue.end - cue.start < 800);
    $('edit-status').textContent = long.length ? `${long.length} undertekster er lange eller vises kort. Kontroller lesbarheten i avspilleren.` : '';
    if (cues.some(cue => cue.chunks?.length && !mappedChunks(cue).length)) {
      $('edit-status').textContent += ' Norsk delmarkering er slått av for endret tekst, siden ordkoblingen ikke lenger er sikker.';
    }
    $('download-srt').disabled = $('download-vtt').disabled = false;
  } catch (error) {
    $('edit-status').textContent = error.message;
    $('download-srt').disabled = $('download-vtt').disabled = true;
  }
}

function renderCues() {
  $('cues').replaceChildren();
  cues.forEach((cue, index) => {
    const row = document.createElement('div'); row.className = 'cue';
    const top = document.createElement('div'); top.className = 'cue-top';
    const seek = document.createElement('button'); seek.type = 'button'; seek.className = 'ghost';
    seek.textContent = `▶ ${index + 1}`; seek.setAttribute('aria-label', `Spill undertekst ${index + 1}`);
    seek.onclick = () => { player.currentTime = cue.start / 1000; void player.play().catch(() => {}); };
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
  $('result').hidden = false;
  updateTrack();
}

fileInput.addEventListener('change', () => {
  if (!canReplace()) { fileInput.value = ''; return; }
  savedId = undefined; dirty = false;
  cues = []; clearTrack(); $('result').hidden = true;
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  const file = fileInput.files[0];
  $('preview').hidden = !file;
  if (file) { sourceName = file.name; $('subtitle-title').value = file.name; mediaUrl = URL.createObjectURL(file); player.src = mediaUrl; }
  message('Klar til å lage undertekster.');
});
player.addEventListener('error', () => {
  $('preview-help').textContent = 'Nettleseren kan ikke spille av denne filtypen. Du kan fortsatt lage og laste ned undertekster.';
});
player.addEventListener('loadedmetadata', () => {
  $('preview-help').textContent = 'Spill av opptaket for å følge undertekstene.';
  updateActiveCue();
});
player.addEventListener('timeupdate', () => {
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
  cues = []; clearTrack(); $('result').hidden = true;
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

for (const format of ['srt', 'vtt']) $('download-' + format).onclick = () => {
  try {
    const content = serializeSubtitles(cues, format);
    const url = URL.createObjectURL(new Blob([content], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = (sourceName.replace(/\.[^.]+$/, '') || 'undertekster') + '.nb.' + format;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { $('edit-status').textContent = error.message; }
};

try {
  const settings = await json('/api/subtitles');
  configured = settings.configured; maxBytes = settings.maxBytes; generate.disabled = !configured;
  storage = Boolean(settings.storage);
  await loadLibrary();
  message(configured ? 'Velg et opptak for å komme i gang.' : 'Undertekster er ikke konfigurert ennå. Serveren trenger Azure Speech.', !configured);
} catch { message('Kunne ikke kontakte serveren. Last siden på nytt.', true); }
