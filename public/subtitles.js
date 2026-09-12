import { cueText, serializeSubtitles, validateCues, wrapText } from './subtitles-format.js';

const $ = id => document.getElementById(id);
const fileInput = $('media-file');
const generate = $('generate');
const player = $('player');
const status = $('status');
const track = player.addTextTrack('subtitles', 'Norsk i tyrkisk ordstilling', 'nb');
track.mode = 'showing';
let configured = false;
let busy = false;
let mediaUrl;
let jobId;
let controller;
let cues = [];
let maxBytes = 100 * 1024 * 1024;

function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
async function json(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Forespørselen feilet. Prøv igjen.');
  return data;
}
function clearTrack() {
  for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
  $('audio-caption').textContent = ''; $('audio-caption').hidden = true;
}
function updateActiveCue() {
  const active = cues.find(cue => player.currentTime * 1000 >= cue.start && player.currentTime * 1000 < cue.end);
  // Browsers often render audio-only files without a native subtitle surface.
  $('audio-caption').hidden = player.videoWidth > 0 || !cues.length;
  $('audio-caption').textContent = active ? wrapText(active.text) : '';
}
track.addEventListener('cuechange', updateActiveCue);
function updateTrack() {
  clearTrack();
  try {
    validateCues(cues);
    for (const cue of cues) track.addCue(new VTTCue(cue.start / 1000, cue.end / 1000,
      wrapText(cue.text).split('\n').map(cueText).join('\n')));
    track.mode = 'showing';
    updateActiveCue();
    const long = cues.filter(cue => wrapText(cue.text).split('\n').length > 2 || cue.end - cue.start < 800);
    $('edit-status').textContent = long.length ? `${long.length} undertekster er lange eller vises kort. Kontroller lesbarheten i avspilleren.` : '';
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
      input.oninput = () => { cue[field] = input.valueAsNumber * 1000; updateTrack(); };
      label.append(input); top.append(label);
    }
    const original = document.createElement('p'); original.lang = 'tr'; original.textContent = cue.turkish;
    const text = document.createElement('textarea'); text.value = cue.text; text.setAttribute('aria-label', `Norsk undertekst ${index + 1}`);
    text.oninput = () => { cue.text = text.value; updateTrack(); };
    row.append(top, original, text); $('cues').append(row);
  });
  $('result').hidden = false;
  updateTrack();
}

fileInput.addEventListener('change', () => {
  cues = []; clearTrack(); $('result').hidden = true;
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  const file = fileInput.files[0];
  $('preview').hidden = !file;
  if (file) { mediaUrl = URL.createObjectURL(file); player.src = mediaUrl; }
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
  updateActiveCue();
  Array.from($('cues').children).forEach((row, index) => row.classList.toggle('active',
    player.currentTime * 1000 >= cues[index].start && player.currentTime * 1000 < cues[index].end));
});

$('upload-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !configured) return;
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
    const created = await json('/api/subtitles', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file, signal: controller.signal });
    jobId = created.id; $('cancel').hidden = false;
    while (true) {
      controller.signal.throwIfAborted();
      const job = await json(`/api/subtitles/${jobId}`, { signal: controller.signal });
      if (job.state === 'error') throw new Error(job.error);
      if (job.state === 'done') {
        cues = job.cues; renderCues();
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
    link.download = (fileInput.files[0]?.name.replace(/\.[^.]+$/, '') || 'undertekster') + '.nb.' + format;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { $('edit-status').textContent = error.message; }
};

try {
  const settings = await json('/api/subtitles');
  configured = settings.configured; maxBytes = settings.maxBytes; generate.disabled = !configured;
  message(configured ? 'Velg et opptak for å komme i gang.' : 'Undertekster er ikke konfigurert ennå. Serveren trenger Azure Speech.', !configured);
} catch { message('Kunne ikke kontakte serveren. Last siden på nytt.', true); }
