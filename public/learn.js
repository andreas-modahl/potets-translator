import { DIRECTIONS } from './learn/strings.js';
import { fold, hintFold, sameWord } from './learn/fold.js';
import { rarityOf, rarityTier } from './learn/rarity.js';
import { BUILDER_ART, BUILDER_ICONS, BUILDER_VIEWS } from './learn/builder-art.js';

/* The page's elements ------------------------------------------------ */

const form = document.querySelector('#form');
const levelButton = document.querySelector('#level');
const levelName = document.querySelector('#level-name');
const bankEmpty = document.querySelector('#bank-empty');
const topicField = document.querySelector('#topic');
const topicIdeas = document.querySelector('#topic-ideas');
const classesButton = document.querySelector('#classes');
const classesName = document.querySelector('#classes-name');
const showFormsButton = document.querySelector('#show-forms');
const showFormsName = document.querySelector('#show-forms-name');
const submitButton = document.querySelector('#submit');
const steps = document.querySelector('.steps');
const stepLabel = document.querySelector('#step-label');
const log = document.querySelector('#log');
const logTitle = document.querySelector('#log-title');
const credits = document.querySelector('#credits');
const formsPanel = document.querySelector('#forms');
const formsTitle = document.querySelector('#forms-title');
const formsBody = document.querySelector('#forms-body');
const formsFlip = document.querySelector('#forms-flip');
const logList = document.querySelector('#log-list');
const logMore = document.querySelector('#log-more');
const statusLine = document.querySelector('#status');
const lessonCard = document.querySelector('#lesson');
const comparator = document.querySelector('#comparator');
const hintButton = document.querySelector('#hint');
const specialKeys = document.querySelector('#special-keys');
// The endings on offer for the segment in focus: one row, moved into
// the box of whichever blank is being built.
const choicesRow = document.createElement('div');
choicesRow.className = 'choices';
choicesRow.setAttribute('role', 'group');
choicesRow.hidden = true;
const naturalRow = document.querySelector('#natural-row');
const naturalLine = document.querySelector('#natural');
const streakPill = document.querySelector('#streak');
const speakButton = document.querySelector('#speak');
const speakBall = document.querySelector('#speak-ball');
const detail = document.querySelector('#detail');
const explanations = document.querySelector('#explanations');
const bank = document.querySelector('#bank');
const bankList = document.querySelector('#bank-list');
const bankCount = document.querySelector('#bank-count');
const chestStars = document.querySelector('#chest-stars');
const chestRow = document.querySelector('#group');
const chestToggle = document.querySelector('#chest-toggle');
const chestWrap = document.querySelector('.chest-wrap');
const chest = document.querySelector('#chest');
const fireworksBox = document.querySelector('#fireworks');
const flagFrom = document.querySelector('#flag-from');
const flagTo = document.querySelector('#flag-to');
const directionLabel = document.querySelector('#direction-label');
const flipButton = document.querySelector('#flip');
const loginButton = document.querySelector('#login');
const loginLabel = document.querySelector('#login-label');
const accountButton = document.querySelector('#account');
const accountLabel = document.querySelector('#account-label');
const avatar = document.querySelector('#avatar');
const menuButton = document.querySelector('#menu');
const menuPanel = document.querySelector('#menu-panel');

/** The logged-in learner, or null. Set before storage is touched. */
let account = null;

/* Direction ---------------------------------------------------------
   "tr": a Norwegian speaker learning Turkish. "nb": a Turkish speaker
   learning Norwegian. Everything on the page is written in the language
   the learner already knows, and the blanks are in the other one. The
   strings for each side live in learn/strings.js. */

const DIRECTION_KEY = 'potets.retning';
/** How many sentences are kept; the oldest fall off the front. */
const HISTORY_LIMIT = 100;

let learning = recall(DIRECTION_KEY) === 'nb' ? 'nb' : 'tr';
/** The strings and settings for the current direction. */
let D = DIRECTIONS[learning];

/** Storage is per direction, so each side keeps its own sentences and chest. */
function keyFor(name) {
  // The Turkish-learning keys keep their old names, so nothing saved
  // before there were two directions is lost.
  return learning === 'tr' ? `potets.tyrkisk.${name}` : `potets.norsk.${name}`;
}

/** The lesson on screen, and which of its chunks is open. */
let current = { chunks: [] };
let selected = -1;
/** Every sentence seen, oldest first, and which one is on screen. */
let history = [];
let cursor = -1;
/** Sequence number, so a slow answer cannot overwrite a newer one. */
let pending = 0;

/** A notice that should outlive the routine clearing done by a fetch. */
let stickyUntil = 0;

function setStatus(message, isError = false, { sticky = false } = {}) {
  if (!message && Date.now() < stickyUntil) return;
  stickyUntil = sticky ? Date.now() + 8000 : 0;
  statusLine.textContent = message ?? '';
  statusLine.hidden = !message;
  statusLine.classList.toggle('error', Boolean(isError));
}

/* Storage ---------------------------------------------------------- */

/** Reading and writing both throw in a browser set to block site data. */
function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A saved word is a convenience; the page works without one.
  }
  // Anything that belongs to a direction is worth carrying to the server.
  if (key.startsWith('potets.tyrkisk.') || key.startsWith('potets.norsk.')) scheduleSync();
}

function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Entries saved before the rename carried turkish/norwegian fields. */
function upgrade(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (entry.target !== undefined) return entry;
  if (entry.turkish === undefined) return entry;
  const { turkish, norwegian, chunks, ...rest } = entry;
  return {
    ...rest,
    target: turkish,
    native: norwegian,
    ...(Array.isArray(chunks) ? { chunks: chunks.map(upgrade) } : {}),
  };
}

function loadBank() {
  try {
    const parsed = JSON.parse(recall(keyFor('ordbank')) ?? '[]');
    return Array.isArray(parsed) ? parsed.map(upgrade).filter((entry) => entry?.target) : [];
  } catch {
    return [];
  }
}

function saveBank(words) {
  remember(keyFor('ordbank'), JSON.stringify(words));
  renderBank(words);
}

function loadHistory() {
  try {
    const parsed = JSON.parse(recall(keyFor('historikk')) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.map(upgrade).filter((entry) => entry?.target && Array.isArray(entry.chunks))
      : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  remember(keyFor('historikk'), JSON.stringify(history));
}

/* The sentences so far ------------------------------------------------
   Listed under the card, newest first, with a mark on the finished ones.
   A row brings its sentence back into the card to be done again; the
   next button always asks for a new one. */

const LOG_PEEK = 5;
let logOpen = false;

function updateSteps() {
  submitButton.setAttribute('aria-label', D.fresh);
  submitButton.title = D.fresh;
  renderLog();
}

function showAt(index, { read = false } = {}) {
  cursor = index;
  renderLesson(history[index], { read });
  setStatus('');
  updateSteps();
  // Back at the newest sentence, the one after it can be readied.
  if (cursor === history.length - 1) schedulePrefetch();
}

/** The sentence on screen is finished: remembered, so its row gets a mark. */
function markDone() {
  const entry = history[cursor];
  if (!entry) return;
  entry.done = true;
  // Which words came unaided, in order, so the row can show how it went.
  // Done again, the newest attempt is the one that counts.
  entry.words = [...comparator.children].map((box) => (box.classList.contains('helped') ? 0 : 1));
  saveHistory();
  renderLog();
}

/** A tick for a finished sentence, or one dot per word: full when it came
    unaided, hollow when it needed a hint. */
function scoreMark(entry) {
  const mark = document.createElement('span');
  mark.className = 'mark';
  const words = Array.isArray(entry.words) ? entry.words : [];
  if (words.length === 0) {
    mark.title = D.logDone;
    mark.textContent = '✓';
    return mark;
  }
  const unaided = words.filter(Boolean).length;
  mark.title = D.logScore(unaided, words.length);
  for (const hit of words) {
    const dot = document.createElement('span');
    dot.className = hit ? 'hit' : 'miss';
    dot.textContent = hit ? '●' : '○';
    mark.append(dot);
  }
  return mark;
}

/** Who the pictures are by. The pictogram licence asks for this on every page that shows them. */
function renderCredits() {
  const link = document.createElement('a');
  link.href = 'https://arasaac.org';
  link.rel = 'noopener';
  link.target = '_blank';
  link.textContent = 'ARASAAC';
  credits.replaceChildren(D.credits, link, D.creditsTail);
}

function renderLog() {
  logTitle.textContent = D.log;
  log.hidden = history.length === 0;
  const rows = history.map((entry, index) => [index, entry]).reverse();
  const shown = logOpen ? rows : rows.slice(0, LOG_PEEK);
  logList.replaceChildren(
    ...shown.map(([index, entry]) => {
      const item = document.createElement('li');
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'log-row';
      row.setAttribute('aria-label', D.logOpen(entry.target));
      if (index === cursor) row.setAttribute('aria-current', 'true');

      const target = document.createElement('span');
      target.className = 'tr';
      target.lang = D.target;
      target.textContent = entry.target;
      const native = document.createElement('span');
      native.className = 'no';
      native.lang = D.native;
      native.textContent = entry.native;
      row.append(target, native);

      if (entry.done) row.append(scoreMark(entry));
      row.addEventListener('click', () => {
        // The sentence on screen included: a click starts it over.
        showAt(index, { read: true });
        lessonCard.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      item.append(row);
      return item;
    }),
  );
  logMore.hidden = rows.length <= LOG_PEEK;
  logMore.textContent = logOpen ? D.logFewer : D.logAll;
  logMore.setAttribute('aria-expanded', String(logOpen));
  // The topic field offers the grammar points of these same sentences.
  renderTopicIdeas();
}

logMore.addEventListener('click', () => {
  logOpen = !logOpen;
  renderLog();
});

/* The comparator --------------------------------------------------- */

/** A word counts as solved once the field holds it, typed or hinted. */
function isSolved(index) {
  return Boolean(comparator.children[index]?.classList.contains('correct'));
}

/** One more letter of the answer than is already right at the start. */
function hint(index) {
  const chunk = current.chunks[index];
  const box = comparator.children[index];
  const field = box.querySelector('.tr');
  box.classList.add('helped');
  struggled(chunk);
  // A hint ends the run right away, not at the end of the sentence.
  if (streak > 0) {
    streak = 0;
    renderStreak();
  }
  const answer = chunk.target;
  // Keep a trailing space: in a multi-word chunk it is the letter that
  // was just given, and trimming it would hand out the same space again.
  const typed = field.textContent.replace(/\u00a0/g, ' ').trimStart();
  const same = (a, b) => (/\s/.test(a) ? /\s/.test(b) : fold(a) === fold(b));
  let right = 0;
  while (right < typed.length && right < answer.length && same(typed[right], answer[right])) {
    right += 1;
  }
  setFieldText(field, answer.slice(0, Math.min(answer.length, right + 1)));
  checkField(field, chunk);
  // The last letter of the last word leaves the focus on the next
  // button, where checkField put it; otherwise the caret stays here.
  if (!sentenceDone()) placeCaretAtEnd(field);
}

/* Segments ---------------------------------------------------------
   A blank whose word has pieces is split into one editable segment per
   piece: the root and each ending in its own tinted box, sized to the
   letters that belong there. The blank as a whole still reads as one
   text, the segments' texts run together, so the checking works on the
   word; only writing and the caret need to know about the segments. */

/** The segments of a blank, or none for a blank that is one field. */
function segmentsOf(field) {
  return [...field.querySelectorAll('.seg')];
}

/** The lengths of the pieces a blank was split for. */
function segmentLengths(field) {
  return segmentsOf(field).map((seg) => Number(seg.dataset.len) || 0);
}

/**
 * Writes text into a blank. A split blank has it dealt out over its
 * segments, by the given lengths or the pieces' own, with whatever is
 * left over going in the last one.
 */
function setFieldText(field, text, lengths = segmentLengths(field)) {
  const segs = segmentsOf(field);
  if (segs.length === 0) {
    field.textContent = text;
    return;
  }
  let at = 0;
  segs.forEach((seg, index) => {
    const take = index === segs.length - 1 ? text.length - at : Math.min(lengths[index] ?? 0, text.length - at);
    seg.textContent = text.slice(at, at + Math.max(0, take));
    at += Math.max(0, take);
  });
}

/** Puts the caret at the start or end of one editable element. */
function placeCaretIn(element, atEnd = true) {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(!atEnd);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The caret goes to the end of a blank: in a split blank, to the end of
    the first segment still short of its piece, else of the last. */
function placeCaretAtEnd(field) {
  const segs = segmentsOf(field);
  if (segs.length === 0) {
    placeCaretIn(field, true);
    return;
  }
  const open = segs.find((seg) => seg.textContent.length < (Number(seg.dataset.len) || 0));
  placeCaretIn(open ?? segs[segs.length - 1], true);
}

/** The segment the caret is in, or none. */
function caretSegment(field) {
  const active = document.activeElement;
  return active?.classList.contains('seg') && field.contains(active) ? active : null;
}

/** How far into an editable element the caret stands. */
function caretOffsetIn(element) {
  const selection = getSelection();
  if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return element.textContent.length;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(element);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}

function select(index) {
  // A new blank in focus has not been heard yet.
  if (index !== selected) heardInFocus = false;
  selected = index;
  for (const [at, box] of [...comparator.children].entries()) {
    box.classList.toggle('open', at === index);
  }
  renderDetail(current.chunks[index]);
  // The drawing helps only the blank it was opened from.
  if (helping && helping.chunk !== current.chunks[index]) setHelping(null);
  followWord(current.chunks[index]);
  // The word in focus is the word builder, solved or not: its root's forms
  // come in, and the arrows over its ending blocks pick the endings.
  const chunk = current.chunks[index];
  const field = comparator.children[index]?.querySelector('.tr');
  if (!chunk || !field) return;
  // The blank already being helped keeps what it has built: the focus
  // coming back to it, after a choice was pressed, is not a fresh start.
  if (helping?.field === field) return;
  if (isSolved(index)) {
    if (inflects(chunk.pos) && piecesOf(chunk)) setHelping({ field, chunk });
  } else {
    startBuilding(field, chunk);
  }
}

// The hint button works on the selected word, or failing that the
// first one still open, which is where the caret sits anyway.
hintButton.addEventListener('click', () => {
  let index = selected >= 0 && !isSolved(selected) ? selected : -1;
  if (index < 0) index = [...comparator.children].findIndex((box) => !box.classList.contains('correct'));
  if (index < 0 || !current.chunks[index]) return;
  select(index);
  hint(index);
  if (isSolved(index)) focusNextOpen();
});

/* Special letters ----------------------------------------------------
   The target language's own letters as keys, for a keyboard without
   them. Typing one lands in the blank in focus, or the first open one. */

function renderSpecialKeys() {
  specialKeys.replaceChildren();
  for (const letter of D.specials) {
    const key = document.createElement('button');
    key.type = 'button';
    key.className = 'special ghost';
    key.lang = D.target;
    key.textContent = letter;
    key.title = D.typeLetter(letter);
    key.setAttribute('aria-label', D.typeLetter(letter));
    // Keep the focus and caret where they are; the click types the letter.
    key.addEventListener('mousedown', (event) => event.preventDefault());
    key.addEventListener('click', () => typeLetter(letter));
    specialKeys.append(key);
  }
}

function typeLetter(letter) {
  const active = document.activeElement;
  let field = comparator.contains(active) ? active?.closest?.('.tr') : null;
  if (!field && selected >= 0 && !isSolved(selected)) field = comparator.children[selected]?.querySelector('.tr');
  if (!field) field = [...comparator.children].find((box) => !box.classList.contains('correct'))?.querySelector('.tr');
  if (!field) return;
  if (!field.contains(document.activeElement)) placeCaretAtEnd(field);
  // insertText goes through the same path as a keystroke, so the
  // field's input handler checks the word and moves on when it fits.
  if (!document.execCommand?.('insertText', false, letter)) {
    const target = caretSegment(field) ?? field;
    target.textContent += letter;
    placeCaretIn(target, true);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** After help, the caret goes to the first blank still to be done. */
function focusNextOpen() {
  const box = [...comparator.children].find((candidate) => !candidate.classList.contains('correct'));
  const field = box?.querySelector('.tr');
  if (field) placeCaretAtEnd(field);
}

/**
 * A letter that is nearly right is made right as it is typed: s for ş,
 * o for ø, i for ı, and k for K. Letter by letter against the answer, as
 * long as each one folds to the same; the first real miss ends it, and
 * the rest is left as typed. The caret goes to the end, which is where
 * it was, since this happens on the letter just typed.
 */
function straighten(field, answer) {
  const typed = field.textContent;
  let fixed = '';
  for (const [at, letter] of [...typed].entries()) {
    const wanted = [...answer][at];
    if (wanted === undefined || letter === wanted) {
      fixed += letter;
      continue;
    }
    const alike = fold(letter) !== '' && fold(letter) === fold(wanted);
    if (!alike) {
      fixed += typed.slice(fixed.length);
      break;
    }
    fixed += wanted;
  }
  if (fixed === typed) return;
  // The letters change in place, so a split blank keeps its segments as
  // they are, and the caret stays where the last letter went in.
  const seg = caretSegment(field);
  setFieldText(
    field,
    fixed,
    segmentsOf(field).map((part) => part.textContent.length),
  );
  placeCaretIn(seg ?? field, true);
}

/**
 * A stroke under each typed letter: green where it is the letter the word
 * has in that place, red where it is not. Letter by letter against the
 * answer, the way it is typed, so the miss is shown where it was made.
 */
function markLetters(box, typed, answer) {
  const check = box.querySelector('.check');
  if (!check) return;
  check.replaceChildren();
  if (box.classList.contains('correct') || !typed.trim()) return;
  const wanted = [...answer];
  const marks = [...typed].map((letter, at) => {
    const mark = document.createElement('span');
    const target = wanted[at];
    const right = target !== undefined && (letter === target || (fold(letter) !== '' && fold(letter) === fold(target)));
    mark.textContent = letter;
    return { mark, right };
  });
  const field = box.querySelector('.tr');
  const segs = segmentsOf(field);
  if (segs.length === 0) {
    check.append(...marks.map(({ mark }) => mark));
  } else {
    // The letters grouped as the segments group them, in boxes of the
    // same size, so each stroke still lands under its letter.
    let at = 0;
    for (const seg of segs) {
      const mirror = document.createElement('span');
      mirror.className = 'seg-mirror';
      mirror.style.minWidth = seg.style.minWidth;
      mirror.style.width = `${seg.getBoundingClientRect().width}px`;
      const count = seg.textContent.length;
      mirror.append(...marks.slice(at, at + count).map(({ mark }) => mark));
      at += count;
      check.append(mirror);
    }
  }
  check.append(strokesUnder(field, check, marks));
}

/**
 * The blank's line, redrawn in colour under each typed letter. The line is
 * a border with rounded ends, so its shape is traced from the blank's own
 * radii and border, and each letter shows the slice of it that lies under
 * that letter: the strokes then thin out at the ends just as the line does.
 */
function strokesUnder(field, check, marks) {
  const NS = 'http://www.w3.org/2000/svg';
  const style = getComputedStyle(field);
  const width = field.offsetWidth;
  const height = field.offsetHeight;
  const border = parseFloat(style.borderBottomWidth) || 0;
  const radius = (value) => {
    const [x, y = x] = value.split(/\s+/);
    const px = (part, along) => (part.endsWith('%') ? (parseFloat(part) / 100) * along : parseFloat(part)) || 0;
    return { x: px(x, width), y: px(y, height) };
  };
  const left = radius(style.borderBottomLeftRadius);
  const right = radius(style.borderBottomRightRadius);
  // Radii too big for the box are scaled down together, as the browser does.
  const scale = Math.min(1, width / (left.x + right.x || 1), height / (left.y || 1), height / (right.y || 1));
  for (const corner of [left, right]) {
    corner.x *= scale;
    corner.y *= scale;
  }
  const depth = Math.max(border, left.y, right.y);
  const inner = (corner) => Math.max(0, corner.y - border);
  const path =
    `M 0 ${depth - left.y} A ${left.x} ${left.y} 0 0 0 ${left.x} ${depth} ` +
    `L ${width - right.x} ${depth} A ${right.x} ${right.y} 0 0 0 ${width} ${depth - right.y} ` +
    `A ${right.x} ${inner(right)} 0 0 1 ${width - right.x} ${depth - border} ` +
    `L ${left.x} ${depth - border} A ${left.x} ${inner(left)} 0 0 1 0 ${depth - left.y} Z`;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'strokes');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(depth));
  svg.setAttribute('viewBox', `0 0 ${width} ${depth}`);
  svg.setAttribute('aria-hidden', 'true');
  const origin = field.getBoundingClientRect();
  svg.style.left = `${origin.left - check.getBoundingClientRect().left}px`;
  for (const { mark, right: ok } of marks) {
    const at = mark.getBoundingClientRect();
    const from = at.left - origin.left;
    const span = at.width;
    // A nested svg shows only what lies inside its own box.
    const slice = document.createElementNS(NS, 'svg');
    slice.setAttribute('x', String(from));
    slice.setAttribute('width', String(span));
    slice.setAttribute('height', String(depth));
    slice.setAttribute('viewBox', `${from} 0 ${span} ${depth}`);
    const stroke = document.createElementNS(NS, 'path');
    stroke.setAttribute('class', ok ? 'ok' : 'bad');
    stroke.setAttribute('d', path);
    slice.append(stroke);
    svg.append(slice);
  }
  return svg;
}

function checkField(field, chunk) {
  const typed = field.textContent;
  const box = field.parentElement;
  const wasSolved = box.classList.contains('correct');
  box.classList.toggle('correct', sameWord(typed, chunk.target));
  box.classList.toggle('filled', typed.trim().length > 0);
  box.classList.toggle('ontrack', fold(chunk.target).startsWith(fold(typed)));
  markLetters(box, typed, chunk.target);
  // The choices at the top of the card follow what the segments hold,
  // and the word underneath says what the endings held make of it.
  if (helping?.chunk === chunk) renderChoices();
  syncNative(box, chunk);
  const solvedNow = box.classList.contains('correct');
  if (solvedNow === wasSolved) return;

  // A near-miss on the letters still counts, but the word left on screen
  // is the real spelling: ş where s was typed, ø where o was.
  if (solvedNow && typed.trim() !== chunk.target) setFieldText(field, chunk.target);
  if (solvedNow) paintWord(box, field, chunk);
  else renderCaption(box, chunk, []);
  // A completed word reads itself out, unless it was just heard. The last
  // word of the sentence reads the whole sentence instead; but not over a
  // reading still going, and not again within moments of one ending.
  if (solvedNow) {
    if (!sentenceDone()) speakOnDone(chunk);
    else if (!sentenceJustHeard()) speak(current.target);
  }

  // Earned outright — no hint, not shown — so it goes in the bank, and
  // the list jumps to the chest it landed in.
  // A word solved again after the arrows took it apart is not earned twice.
  if (solvedNow && !box.classList.contains('helped') && !box.classList.contains('earned')) {
    box.classList.add('earned');
    viewGroup = -1;
    bankEarned(chunk);
  }
  // Getting it right unmasks the word in the panel underneath, and puts
  // it in the forms card.
  if (current.chunks[selected] === chunk) {
    renderDetail(chunk);
    followWord(chunk);
  }
  // The last word in opens up the whole sentence and hands the focus to
  // the next button, so Enter carries on.
  if (sentenceDone()) {
    renderExplanations();
    setReady(true, chestFilled);
    countSentence();
    markDone();
    // A word finished with an arrow keeps the caret: the arrows are for
    // looking at the word, and Enter is there when done with it.
    if (!byArrow) submitButton.focus();
  } else {
    explanations.hidden = true;
    setReady(false);
  }
}

/* Streak ------------------------------------------------------------
   Sentences finished in a row without a hint. It lives for the visit
   only: it is a run, not a score, and the chest is the score. */

let streak = 0;
let streakCounted = false;

function countSentence() {
  if (streakCounted) return;
  streakCounted = true;
  const helped = [...comparator.children].some((box) => box.classList.contains('helped'));
  streak = helped ? 0 : streak + 1;
  renderStreak(true);
}

function renderStreak(bump = false) {
  streakPill.hidden = streak < 2;
  streakPill.textContent = D.streak(streak);
  streakPill.title = D.streakHelp;
  streakPill.classList.remove('bump');
  if (bump && streak >= 2) {
    void streakPill.offsetWidth;
    streakPill.classList.add('bump');
  }
}

/** The pieces of a word, if they spell it exactly; else nothing to paint. */
function piecesOf(chunk) {
  const parts = chunk.morphemes ?? [];
  if (parts.length < 2) return null;
  // Letters only, lower-cased the Turkish way, with the consonants that
  // soften before a suffix folded together, as the server checks them:
  // "köpek" + "im" does spell "köpeğim", the k just turned into ğ.
  const soft = (text) =>
    text
      .replace(/[^\p{L}\p{N}]/gu, '')
      .toLocaleLowerCase('tr')
      .replace(/b/g, 'p')
      .replace(/c/g, 'ç')
      .replace(/d/g, 't')
      .replace(/[gğ]/g, 'k');
  const forms = parts.map((part) => (part.form ?? '').replace(/[^\p{L}\p{N}]/gu, ''));
  const letters = chunk.target.replace(/[^\p{L}\p{N}]/gu, '');
  if (forms.some((form) => !form)) return null;
  if (soft(forms.join('')) !== soft(letters)) return null;
  return parts.map((part, index) => ({ ...part, length: forms[index].length }));
}

/* Tints -------------------------------------------------------------
   A piece is painted by what it does, not by where it sits, so the same
   ending wears the same tint in every word and in the forms table: the
   root in the first tint, number and tense in the second, case and person
   in the third. An ending that is none of these goes by its place. */

const TR_ENDINGS = [
  // Plural and the tenses: the endings a forms table puts across the top.
  { tint: 1, pattern: /^([iıuü]yor|[dt][iıuü]|y?[ea]c[ea][kğ]|[aeıiuü]r|m[iıuü]ş|s[ea]|m[ea]kt[ea])$/u },
  // Case and person: the endings it lists down the side.
  { tint: 2, pattern: /^(y?[iıuü]|y?[ea]|[dt][ea]n?|n?[iıuü]n|s?[iıuü]|[iıuü]?m|[iıuü]?z|s?[iıuü]n|s?[iıuü]n[iıuü]z|k)$/u },
];

function endingTint(form, index) {
  if (index === 0) return 0;
  if (D.target !== 'tr') return index % 4;
  const folded = (form ?? '').replace(/[^\p{L}]/gu, '').toLocaleLowerCase('tr');
  // -ler straight after the root is the plural; after a tense it is "they".
  if (/^l[ae]r$/u.test(folded)) return index === 1 ? 1 : 2;
  for (const { tint, pattern } of TR_ENDINGS) if (pattern.test(folded)) return tint;
  return index % 4;
}

/* Word classes ------------------------------------------------------
   On by default: every blank says what kind of word it wants, in the
   caption row above it, before the painted pieces. Off stays off. */

const CLASSES_KEY = 'potets.ordklasser';
let showClasses = recall(CLASSES_KEY) !== 'off';

function renderClassesToggle() {
  classesButton.setAttribute('aria-checked', String(showClasses));
}

/* The forms card ----------------------------------------------------
   Off by default: the choices at the top of the lesson card try the
   endings, so this card is there for those who want the whole picture. */

const SHOW_FORMS_KEY = 'potets.bøyning';
let showForms = recall(SHOW_FORMS_KEY) === 'on';

function renderShowForms() {
  showFormsButton.setAttribute('aria-checked', String(showForms));
  formsPanel.hidden = !showForms;
}

showFormsButton.addEventListener('click', () => {
  showForms = !showForms;
  remember(SHOW_FORMS_KEY, showForms ? 'on' : 'off');
  renderShowForms();
  closeMenu();
});

classesButton.addEventListener('click', () => {
  showClasses = !showClasses;
  remember(CLASSES_KEY, showClasses ? 'on' : 'off');
  renderClassesToggle();
  refreshCaptions();
  closeMenu();
});

/** The caption row above a blank: the word class, then whatever tags follow. */
function renderCaption(box, chunk, tags) {
  const caption = box.querySelector('.parts');
  caption.replaceChildren();
  if (showClasses && chunk.pos && D.pos[chunk.pos]) {
    const kind = document.createElement('span');
    kind.className = 'pos';
    kind.lang = D.native;
    kind.textContent = D.pos[chunk.pos];
    // What the class means, with a few examples, on hover.
    kind.title = D.posHelp[chunk.pos] ?? '';
    caption.append(kind);
  }
  caption.append(...tags);
}

/** Redraws every caption, for when the word-class setting changes. */
function refreshCaptions() {
  for (const [index, box] of [...comparator.children].entries()) {
    const chunk = current.chunks[index];
    if (!chunk || !box.querySelector('.parts')) continue;
    if (isSolved(index)) paintWord(box, box.querySelector('.tr'), chunk);
    else renderCaption(box, chunk, []);
  }
}

/** The word as tinted spans, one per piece. Each piece takes its letters
    from the word as it is spelled there, so a softened consonant is
    painted, not the dictionary form; any punctuation on the end stays plain. */
function paintedPieces(chunk, parts, tints = parts.map((part, index) => endingTint(part.form, index))) {
  let at = 0;
  const painted = parts.map((part, index) => {
    const span = document.createElement('span');
    span.className = 'm';
    span.dataset.m = String(tints[index]);
    let taken = 0;
    let end = at;
    while (taken < part.length && end < chunk.target.length) {
      if (/[\p{L}\p{N}]/u.test(chunk.target[end])) taken += 1;
      end += 1;
    }
    span.textContent = chunk.target.slice(at, end);
    at = end;
    return span;
  });
  return [...painted, chunk.target.slice(at)];
}

/* The choices ---------------------------------------------------------
   In the word's box, over the blank, for the segment the caret
   is in: every ending its forms table offers along that axis, painted
   in its tint with what it does beside it. A press writes the ending
   into the segment. Nothing shows for the root, or before the table
   has come. */

/** Letters only, of what a segment holds. */
function heldIn(seg) {
  return seg?.textContent.replace(/[^\p{L}\p{M}\p{N}]/gu, '') ?? '';
}

/** Whether a form has nothing in the slot named: no plural, no case. */
function bareIn(slots, which) {
  return slots.find((slot) => slot.key === which)?.piece === '';
}

function renderChoices() {
  choicesRow.replaceChildren();
  choicesRow.setAttribute('aria-label', D.choices);
  const pieces = helping ? piecesOf(helping.chunk) : null;
  if (!pieces) {
    choicesRow.hidden = true;
    return;
  }
  const box = helping.field.parentElement;
  if (choicesRow.parentElement !== box) box.append(choicesRow);
  const segs = segmentsOf(helping.field);
  const groups = formsShown?.groups ?? [];
  const built = formsShown ? builtIn : null;
  const groupFirst = groupEndingFirst();
  const slotOf = (form, group, key) => slotsOf(form, group, groupFirst).find((slot) => slot.key === key);
  // The label axis runs along the group built, else along one whose forms
  // carry no group ending, so a case picked first does not bring a plural.
  const along =
    built?.group ??
    groups.find((group) => group.forms.some((form) => bareIn(slotsOf(form, group, groupFirst), 'group'))) ??
    groups[0];
  const axes = [
    {
      key: 'group',
      tint: 1,
      options:
        groups.length > 1
          ? groups.map((group) => {
              // Each group's ending as it goes with the label built, or with its first form.
              const form = (built?.entry && group.forms.find((candidate) => candidate.label === built.entry.label)) ?? group.forms[0];
              return { slot: slotOf(form, group, 'group'), pick: group };
            })
          : [],
    },
    {
      key: 'label',
      tint: 2,
      options:
        along && along.forms.length > 1
          ? along.forms.map((form) => ({ slot: slotOf(form, along, 'label'), pick: form }))
          : [],
    },
  ];
  if (!groupFirst) axes.reverse();
  for (const { key, tint, options: all } of axes) {
    // Only what can be written: an axis the blank has a segment for, and
    // on it the endings that are something. A bare ending is never what a
    // segment that exists is waiting for.
    const seg = segs.find((candidate) => candidate.dataset.m === String(tint));
    // And only while that segment holds the caret: the choices are for
    // the piece being typed, not the whole word at once.
    if (!seg || document.activeElement !== seg) continue;
    const options = all.filter(({ slot }) => slot?.piece);
    if (options.length === 0) continue;
    const row = document.createElement('div');
    row.className = 'axis';
    const held = heldIn(seg);
    for (const { slot, pick } of options) {
      const piece = slot.piece;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice';
      button.tabIndex = -1;
      // Pressed when the blank holds this very ending.
      button.setAttribute('aria-pressed', String(fold(held) === fold(piece)));
      const ending = document.createElement('span');
      ending.className = 'm';
      ending.dataset.m = String(tint);
      ending.lang = D.target;
      ending.textContent = `-${piece}`;
      button.append(ending);
      const about = slotTagText(slot);
      const short = chipText(slot, about);
      if (short) {
        const text = document.createElement('span');
        text.className = 'about';
        text.lang = D.native;
        text.textContent = short;
        if (short !== about) button.title = about;
        button.append(text);
      }
      // The caret stays in the blank; the press writes the ending.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => pickBuilt(key, pick, seg));
      row.append(button);
    }
    choicesRow.append(row);
  }
  choicesRow.hidden = choicesRow.children.length === 0;
}

/**
 * Under a blank holding an ending the sentence does not want, the word
 * the forms table gives that form, struck through: "du ser" under a
 * "görüyorsun" typed where "görüyorum" was asked for, so a wrong ending
 * still says what it would have meant. The blank's own word comes back
 * once the endings are right, or gone, or make no form the table has.
 */
function syncNative(box, chunk) {
  const native = box.querySelector('.no');
  if (!native) return;
  let said = '';
  const pieces = helping?.chunk === chunk ? piecesOf(chunk) : null;
  const groups = formsShown?.groups ?? [];
  if (pieces && groups.length && !box.classList.contains('correct')) {
    const segs = segmentsOf(box.querySelector('.tr'));
    const tints = [1, 2].filter((tint) => segs.some((seg) => seg.dataset.m === String(tint)));
    const heldOf = (tint) => heldIn(segs.find((seg) => seg.dataset.m === String(tint)));
    const wantedOf = (tint) => pieces.find((part, index) => index > 0 && endingTint(part.form, index) === tint)?.form ?? '';
    const astray = tints.some((tint) => heldOf(tint) && fold(heldOf(tint)) !== fold(wantedOf(tint)));
    if (astray) {
      const groupFirst = groupEndingFirst();
      search: for (const group of groups) {
        for (const form of group.forms) {
          const slots = slotsOf(form, group, groupFirst);
          const fits = tints.every((tint) => fold(slots.find((slot) => slot.tint === tint)?.piece ?? '') === fold(heldOf(tint)));
          if (fits && form.means) {
            said = form.means;
            break search;
          }
        }
      }
    }
  }
  native.classList.toggle('astray', !!said);
  native.textContent = said || chunk.native;
}

/** What a choice says beside its ending, a word or two: the keywords cut
    short, or, where they still run long, the ending's name when that is
    shorter ("akkusativ" for "bestemt objekt", "lokativ" for "i, på, hos"). */
function chipText(slot, about) {
  const short = shortMeans(about);
  const name = slot.role?.name ? splitLabel(slot.role.name).name : '';
  return short.length > 9 && name && name.length < short.length ? name : short;
}

/** A piece's meaning cut down to a chip's worth: the name in brackets
    where there is one ("akkusativ" out of "bestemt objektsform
    (akkusativ)"), else what stands before the first comma. */
function shortMeans(means) {
  const text = (means ?? '').trim();
  const inBrackets = /\(([^)]{1,16})\)/.exec(text)?.[1];
  if (inBrackets && inBrackets.trim().length < text.length) return inBrackets.trim();
  const head = text.split(/[,;:]/)[0].trim();
  return head.length >= 2 ? head : text;
}

/** Paints a solved word piece by piece and writes each piece's meaning
    in the same tint above the blank. */
function paintWord(box, field, chunk) {
  const parts = piecesOf(chunk);
  if (!parts) {
    renderCaption(box, chunk, []);
    return;
  }
  const tints = parts.map((part, index) => endingTint(part.form, index));
  // A split blank is painted already, segment by segment: it only gets
  // the word dealt out over them. A single field gets painted spans.
  if (segmentsOf(field).length) setFieldText(field, chunk.target);
  else field.replaceChildren(...paintedPieces(chunk, parts, tints));
  renderCaption(
    box,
    chunk,
    parts.map((part, index) => {
      const tag = document.createElement('span');
      tag.className = 'm';
      tag.dataset.m = String(tints[index]);
      tag.lang = D.native;
      tag.textContent = shortMeans(part.means);
      if (tag.textContent !== part.means) tag.title = part.means;
      return tag;
    }),
  );
}

function setReady(ready, filledChest = false) {
  submitButton.classList.toggle('ready', ready);
  stepLabel.textContent = ready ? (filledChest ? D.chestFull : D.done) : D.fresh;
  // Nothing left to hint at or type once every word is in place, so the
  // next button takes the hint button's place, beside the speaker.
  hintButton.hidden = ready;
  specialKeys.hidden = ready;
  if (ready) hintButton.after(submitButton);
  else steps.prepend(submitButton);
}

/* Words that needed a hint ------------------------------------------
   They are not in the chest, but they are the ones worth meeting again
   soonest, so they come back in the next sentences until one is typed
   unaided, and then they are earned like any other. */

const STRUGGLED_LIMIT = 30;

function loadStruggled() {
  try {
    const parsed = JSON.parse(recall(keyFor('slit')) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.target) : [];
  } catch {
    return [];
  }
}

function saveStruggled(words) {
  remember(keyFor('slit'), JSON.stringify(words.slice(-STRUGGLED_LIMIT)));
}

/** Notes a word the learner needed help with. */
function struggled(chunk) {
  const words = loadStruggled().filter((word) => fold(word.target) !== fold(chunk.target));
  words.push({ target: chunk.target, native: chunk.native, at: Date.now() });
  saveStruggled(words);
}

/** The word was typed unaided, so it needs no more chasing. */
function overcame(chunk) {
  const words = loadStruggled();
  const rest = words.filter((word) => fold(word.target) !== fold(chunk.target));
  if (rest.length !== words.length) saveStruggled(rest);
}

/**
 * The words worth meeting again: the least practised, and among those
 * the ones not seen for longest. A few are sent with each request so
 * the next sentence can bring one back.
 */
function comebacks(words) {
  // Words that needed a hint come first: they are not earned yet.
  const chosen = loadStruggled()
    .slice(-2)
    .map((word) => word.target);
  const ranked = [...words]
    .filter((word) => !chosen.some((target) => fold(target) === fold(word.target)))
    .sort((a, b) => (a.count ?? 1) - (b.count ?? 1) || (a.at ?? 0) - (b.at ?? 0));
  // Some choice among the weakest, so the same ones do not come back every time.
  const weakest = ranked.slice(0, 6);
  while (chosen.length < 3 && weakest.length) {
    chosen.push(weakest.splice(Math.floor(Math.random() * weakest.length), 1)[0].target);
  }
  return chosen;
}

/** The chunk: a blank field to type the target word into, standing over
    the native words it should carry. The native text is a button that
    reads the target word aloud. */
/** The blank's font, read once from a blank so the measure matches what is drawn. */
let blankFont = '';

/**
 * How wide the answer will be, measured in the blank's own font, so the
 * line underneath is exactly as long as the word. Counting letters would
 * make "iyidir" as wide as "mmmmmm".
 */
function blankWidth(word) {
  if (!blankFont) {
    const probe = document.createElement('span');
    probe.className = 'tr';
    probe.textContent = word;
    const box = document.createElement('div');
    box.className = 'chunk';
    box.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    box.append(probe);
    comparator.append(box);
    const style = getComputedStyle(probe);
    blankFont = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    box.remove();
  }
  const context = document.createElement('canvas').getContext('2d');
  context.font = blankFont;
  const measured = context.measureText(word || ' ').width;
  return `${Math.ceil(Math.max(measured, 16)) + 4}px`;
}

function chunkField(chunk, index) {
  const box = document.createElement('div');
  box.className = 'chunk';

  const field = document.createElement('span');
  field.className = 'tr';
  field.lang = D.target;
  field.spellcheck = false;
  const pieces = piecesOf(chunk);
  if (pieces) {
    // One segment per piece, in the piece's tint and at least its width,
    // the root first: the word is typed into them in turn.
    field.classList.add('split');
    field.setAttribute('role', 'group');
    field.setAttribute('aria-label', D.blankFor(chunk.native));
    pieces.forEach((part, at) => {
      const seg = document.createElement('span');
      seg.className = 'seg m';
      seg.dataset.m = String(endingTint(part.form, at));
      seg.dataset.len = String(part.length);
      seg.style.minWidth = `${part.length}ch`;
      seg.contentEditable = 'plaintext-only';
      seg.setAttribute('role', 'textbox');
      seg.setAttribute('aria-label', `${D.blankFor(chunk.native)} ${at + 1}/${pieces.length}`);
      field.append(seg);
    });
  } else {
    field.contentEditable = 'plaintext-only';
    field.setAttribute('role', 'textbox');
    field.setAttribute('aria-label', D.blankFor(chunk.native));
    // Sized to the answer so the row does not shift as it is filled in.
    field.style.minWidth = blankWidth(chunk.target);
  }

  // The last right letter moves the caret on, so a sentence can be typed
  // straight through without reaching for Enter. In a split blank, a
  // segment filled to its piece hands the caret to the next, and letters
  // over the brim spill into it.
  field.addEventListener('input', (event) => {
    const seg = event.target.closest?.('.seg');
    if (seg && !event.isComposing) spill(field, seg);
    if (!event.isComposing) straighten(field, chunk.target);
    checkField(field, chunk);
    if (isSolved(index)) focusNextOpen();
  });
  // Enter and Tab both step to the next blank, skipping the buttons in
  // between; Shift+Tab steps back. Past the last blank they land on
  // the next-sentence button, not on whatever button comes first.
  field.addEventListener('keydown', (event) => {
    const seg = event.target.closest?.('.seg');
    // Up and down swap the ending of the segment the caret is in for the
    // next choice along its axis; in the root, the first ending.
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (helping?.field !== field || !builtIn || !formsShown) return;
      event.preventDefault();
      stepBuilt(slotOfSegment(field, seg), event.key === 'ArrowDown' ? 1 : -1, seg ?? field);
      return;
    }
    // Backspace and the left and right keys cross from one segment into
    // the next as if the blank were one line, and the left and right keys
    // go on from the blank's ends into the blanks before and after.
    const editable = seg ?? field;
    const collapsed = getSelection().isCollapsed;
    if ((event.key === 'Backspace' || event.key === 'ArrowLeft') && collapsed && caretOffsetIn(editable) === 0) {
      const before = seg?.previousElementSibling;
      if (before) {
        event.preventDefault();
        placeCaretIn(before, true);
      } else if (event.key === 'ArrowLeft') {
        const previous = comparator.children[index - 1]?.querySelector('.tr');
        if (previous) {
          event.preventDefault();
          const last = segmentsOf(previous).at(-1) ?? previous;
          placeCaretIn(last, true);
        }
      }
      return;
    }
    if (event.key === 'ArrowRight' && collapsed && caretOffsetIn(editable) === editable.textContent.length) {
      const after = seg?.nextElementSibling;
      if (after) {
        event.preventDefault();
        placeCaretIn(after, false);
      } else {
        const next = comparator.children[index + 1]?.querySelector('.tr');
        if (next) {
          event.preventDefault();
          placeCaretIn(segmentsOf(next)[0] ?? next, false);
        }
      }
      return;
    }
    if (event.key !== 'Enter' && event.key !== 'Tab') return;
    const step = event.key === 'Tab' && event.shiftKey ? -1 : 1;
    const next = comparator.children[index + step]?.querySelector('.tr');
    if (!next && step < 0) return;
    event.preventDefault();
    if (next) placeCaretAtEnd(next);
    else submitButton.focus();
  });
  field.addEventListener('focusin', () => {
    select(index);
    // The caret moving from one segment to the next changes which
    // endings are on offer.
    if (helping?.field === field) renderChoices();
  });

  const native = document.createElement('button');
  native.type = 'button';
  native.className = 'no';
  native.lang = D.native;
  native.textContent = chunk.native;
  native.title = D.hearWord;
  native.setAttribute('aria-label', `${D.hearWord}: ${chunk.native}`);
  native.tabIndex = -1;
  // A click reads the word aloud in the language being learned; the
  // hint button is the place for letters.
  native.addEventListener('mousedown', (event) => event.preventDefault());
  native.addEventListener('click', () => {
    select(index);
    speak(chunk.target);
  });

  // A tiny speaker ball beside the word, shown for the blank in focus.
  const say = document.createElement('button');
  say.type = 'button';
  say.className = 'say';
  say.title = D.hearWord;
  say.setAttribute('aria-label', `${D.hearWord}: ${chunk.native}`);
  say.tabIndex = -1;
  say.append(flag(D.flagTo));
  const waves = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  waves.setAttribute('viewBox', '0 0 12 16');
  waves.setAttribute('aria-hidden', 'true');
  waves.classList.add('waves');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2 5.5a4 4 0 0 1 0 5M5.5 3a8 8 0 0 1 0 10');
  waves.append(path);
  say.append(waves);
  say.addEventListener('mousedown', (event) => event.preventDefault());
  say.addEventListener('click', () => speak(chunk.target));

  const under = document.createElement('span');
  under.className = 'under';
  under.append(native, say);

  const parts = document.createElement('span');
  parts.className = 'parts';

  // The typed letters again, unseen, each with its own stroke underneath.
  const check = document.createElement('span');
  check.className = 'check';
  check.setAttribute('aria-hidden', 'true');

  box.append(parts, field, check, under);
  renderCaption(box, chunk, []);

  // The whole box is the target: a click on its padding, the caption or
  // the translation puts the caret in the blank, at the first segment
  // still to fill. The buttons keep their own jobs, and once the blank
  // holds the caret a click in it places the caret as usual.
  box.addEventListener('mousedown', (event) => {
    if (event.target.closest('button')) return;
    if (event.target.closest('.tr') && field.contains(document.activeElement)) return;
    event.preventDefault();
    placeCaretAtEnd(field);
  });
  return box;
}

/** Letters typed over a segment's brim go on into the next segment, and
    a segment filled to its piece hands the caret on, so a word can be
    typed straight through. The last segment takes whatever is left. */
function spill(field, seg) {
  const length = Number(seg.dataset.len) || 0;
  const next = seg.nextElementSibling;
  if (!next || !next.classList.contains('seg')) return;
  const atEnd = caretOffsetIn(seg) === seg.textContent.length;
  if (seg.textContent.length > length) {
    const over = seg.textContent.slice(length);
    seg.textContent = seg.textContent.slice(0, length);
    next.textContent = over + next.textContent;
    if (atEnd) {
      // The caret follows the letters into the next segment.
      const range = document.createRange();
      const text = next.firstChild;
      range.setStart(text, over.length);
      range.collapse(true);
      next.focus();
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return;
  }
  if (atEnd && seg.textContent.length === length) placeCaretIn(next, false);
}

/** Which ending a segment holds, for the up and down keys: the root's
    segment, or one with no ending to swap, stands for the first ending. */
function slotOfSegment(field, seg) {
  const order = groupEndingFirst() ? ['group', 'label'] : ['label', 'group'];
  const tint = seg?.dataset.m;
  return tint === '1' ? 'group' : tint === '2' ? 'label' : order[0];
}

function morphemeNode({ form, means }, solved, index = 0) {
  const piece = document.createElement('span');
  piece.className = 'morpheme';
  // The same tint as the piece wears in the blank.
  if (solved) piece.dataset.m = String(endingTint(form, index));

  const formNode = document.createElement('span');
  formNode.className = 'form';
  formNode.lang = D.target;
  if (solved) formNode.textContent = form;
  else formNode.append(masked(form));

  const meansNode = document.createElement('span');
  meansNode.className = 'means';
  meansNode.lang = D.native;
  meansNode.textContent = means;

  piece.append(formNode, meansNode);
  return piece;
}

/** Dots standing in for a word not yet earned, one per letter. */
function masked(word) {
  const span = document.createElement('span');
  span.className = 'hidden-word';
  span.textContent = '·'.repeat(Math.max(1, word.length));
  return span;
}

/** The word opened up: its two sides, its pieces, and its note. The
    pieces can be left out where the blank itself already shows them. */
/* Pictures ------------------------------------------------------------------
   A noun earns a small picture: the emoji the lesson named for it, or failing
   that a pictogram the server looks up by the word. Only a solved word shows
   it: for an open blank it would give the answer away. */

/** The fingerprint of the picture sources, or '' while the server has none. */
let pictureVersion = '';

/** The word a noun is drawn as: its root, so "köpeğim" and "köpekler" share one dog. */
function pictureWord(chunk) {
  if (chunk?.pos !== 'noun') return '';
  const root = chunk.morphemes?.[0]?.form ?? chunk.target;
  return root.replace(/[^\p{L}\p{M}'’-]/gu, '').toLocaleLowerCase(D.target);
}

/** The emoji the lesson gave for a noun, if it gave one. */
function pictureEmoji(chunk) {
  return chunk?.pos === 'noun' && typeof chunk.emoji === 'string' ? chunk.emoji : '';
}

/** The picture for a word, or nothing while pictures are off; a word without one takes the image away. */
function pictureNode(word, emoji = '', hint = '') {
  if (!pictureVersion || !word) return null;
  const image = document.createElement('img');
  image.className = 'pic';
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  // The English gloss rides along: a second name the server can look the picture up by.
  const query = new URLSearchParams({
    v: pictureVersion,
    word,
    lang: D.target,
    ...(emoji ? { emoji } : {}),
    ...(hint ? { hint } : {}),
  });
  image.src = `/api/picture?${query}`;
  image.addEventListener('error', () => {
    image.closest('.pictured')?.classList.remove('pictured');
    image.remove();
  });
  return image;
}

function wordBlock(chunk, solved, { pieces = true } = {}) {
  const block = document.createDocumentFragment();

  const head = document.createElement('div');
  head.className = 'detail-head';
  const picture = solved ? pictureNode(pictureWord(chunk), pictureEmoji(chunk), chunk.english ?? '') : null;
  if (picture) {
    head.classList.add('pictured');
    head.append(picture);
  }
  const target = document.createElement('span');
  target.className = 'tr';
  target.lang = D.target;
  if (solved) target.textContent = chunk.target;
  else target.append(masked(chunk.target));
  const native = document.createElement('span');
  native.className = 'no';
  native.lang = D.native;
  native.textContent = chunk.native;
  head.append(target, native);
  block.append(head);

  if (pieces && chunk.morphemes?.length) {
    const strip = document.createElement('div');
    strip.className = 'morphemes';
    chunk.morphemes.forEach((morpheme, index) => {
      if (index > 0) {
        const joint = document.createElement('span');
        joint.className = 'joint';
        joint.textContent = '+';
        strip.append(joint);
      }
      strip.append(morphemeNode(morpheme, solved, index));
    });
    block.append(strip);
  }

  if (chunk.note) {
    const note = document.createElement('p');
    note.className = 'note';
    note.lang = D.native;
    note.textContent = chunk.note;
    block.append(note);
  }

  return block;
}

function renderDetail(chunk) {
  detail.replaceChildren();
  if (!chunk) return;
  detail.append(wordBlock(chunk, isSolved(current.chunks.indexOf(chunk))));

  const inBank = loadBank().some((word) => fold(word.target) === fold(chunk.target));
  if (inBank) {
    const mark = document.createElement('p');
    mark.className = 'detail-actions hint-text';
    mark.textContent = D.inBank;
    detail.append(mark);
  }
}

/** Every word with a note, in sentence order. The pieces are already
    painted in the blanks, so only the word and its note are shown. */
function renderExplanations() {
  explanations.replaceChildren();
  for (const chunk of current.chunks) {
    if (!chunk.note) continue;
    const block = document.createElement('div');
    block.className = 'explanation';
    block.append(wordBlock(chunk, true, { pieces: false }));
    explanations.append(block);
  }
  explanations.hidden = explanations.childElementCount === 0;
}

function sentenceDone() {
  return (
    current.chunks.length > 0 &&
    [...comparator.children].every((box) => box.classList.contains('correct'))
  );
}

/** A word typed right with no hint goes into the bank, or if it is
    there already, has its tally bumped. Only the first time is a drop. */
function bankEarned(chunk) {
  overcame(chunk);
  const words = loadBank();
  const at = words.findIndex((word) => fold(word.target) === fold(chunk.target));
  if (at >= 0) {
    // A comeback: the word came round again and was typed unaided.
    const before = rarityTier(words[at]);
    words[at] = { ...words[at], count: (words[at].count ?? 1) + 1, at: Date.now() };
    const rose = rarityTier(words[at]) > before;
    if (rose) upgraded = fold(chunk.target);
    saveBank(words);
    fireworks(chunk, rose ? 2 : 1);
    return;
  }
  saveBank([
    ...words,
    {
      target: chunk.target,
      native: chunk.native,
      count: 1,
      pieces: chunk.morphemes?.length ?? 0,
      at: Date.now(),
      ...(chunk.note ? { note: chunk.note } : {}),
      ...(chunk.pos ? { pos: chunk.pos } : {}),
      ...(pictureWord(chunk) ? { pic: pictureWord(chunk) } : {}),
      ...(pictureEmoji(chunk) ? { emoji: pictureEmoji(chunk) } : {}),
      ...(typeof chunk.english === 'string' && chunk.english ? { english: chunk.english } : {}),
    },
  ]);
  // A chest filled to 25 gets a bigger show, and a star on the lid.
  const filled = (words.length + 1) % CHEST_SIZE === 0;
  if (filled) chestFilled = true;
  fireworks(chunk, filled ? 3 : 1);
}

/* Fireworks -------------------------------------------------------- */

const SPARKS = ['✨', '🎉', '⭐', '💎', '🪙', '🔥', '🎊', '💫'];

/** A burst of emoji and little balls out of the chest; more pieces for
    a longer word. Every third piece is the ball of the language learned. */
function fireworks(chunk, scale = 1, box = fireworksBox) {
  const count = (10 + Math.min(10, (chunk.morphemes?.length ?? 0) * 3)) * scale;
  for (let at = 0; at < count; at += 1) {
    const spark = document.createElement('span');
    if (at % 3 === 0) spark.append(flag(D.flagTo));
    else spark.textContent = SPARKS[Math.floor(Math.random() * SPARKS.length)];
    // Mostly upward, like a fountain, with some spread to the sides.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const distance = 60 + Math.random() * 110;
    spark.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--y', `${Math.sin(angle) * distance}px`);
    spark.style.setProperty('--r', `${Math.round(Math.random() * 360 - 180)}deg`);
    spark.style.setProperty('--d', `${Math.round(Math.random() * 200)}ms`);
    spark.style.setProperty('--s', `${(0.9 + Math.random() * 0.7).toFixed(2)}rem`);
    spark.addEventListener('animationend', () => spark.remove());
    box.append(spark);
  }
  if (box === fireworksBox) hop();
}

function hop() {
  chest.classList.remove('hop');
  void chest.getBBox();
  chest.classList.add('hop');
}

chest.addEventListener('animationend', () => chest.classList.remove('hop'));

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey || lessonCard.hidden) return;

  // The . key is a one-letter hint. Punctuation is not checked, so no
  // blank ever needs a full stop typed into it.
  if (event.key === '.') {
    event.preventDefault();
    if (!event.repeat && !hintButton.hidden) hintButton.click();
    return;
  }

  // The | key reads the word in focus aloud; pressed twice quickly it
  // reads the whole sentence. No word in either language needs the key,
  // so it can be swallowed even while the caret sits in a blank.
  if (event.key !== '|') return;
  event.preventDefault();
  if (event.repeat) return;
  const now = Date.now();
  const double = now - lastPipe < DOUBLE_TAP_MS;
  lastPipe = double ? 0 : now;
  if (double) {
    speak(current.target);
    return;
  }
  const word = current.chunks[selected]?.target;
  if (word) speak(word);
});

/** The shape of a lesson with nothing in it, shown while one is fetched. */
function renderSkeleton() {
  current = { chunks: [] };
  selected = -1;
  setHelping(null);
  comparator.replaceChildren();
  detail.replaceChildren();
  explanations.replaceChildren();
  explanations.hidden = true;

  naturalLine.replaceChildren(bone('60%'));
  naturalRow.hidden = false;

  for (const width of [3, 6, 4, 7, 5]) {
    const box = document.createElement('div');
    box.className = 'chunk bone-chunk';
    const field = document.createElement('span');
    field.className = 'tr';
    field.style.minWidth = `${width}ch`;
    field.textContent = ' ';
    const parts = document.createElement('span');
    parts.className = 'parts';
    const under = document.createElement('span');
    under.className = 'no';
    under.append(bone(`${width + 1}ch`));
    box.append(parts, field, under);
    comparator.append(box);
  }

  lessonCard.hidden = false;
}

function bone(width) {
  const span = document.createElement('span');
  span.className = 'bone';
  span.style.width = width;
  return span;
}

/**
 * Puts a sentence on screen. Read aloud when asked, which is when it is new
 * or reopened by hand; not when restored on arrival, which the browser would
 * not let play unprompted anyway.
 */
function renderLesson(result, { read = false } = {}) {
  current = result;
  selected = -1;
  setHelping(null);
  chestFilled = false;
  comparator.replaceChildren();
  detail.replaceChildren();
  explanations.replaceChildren();
  explanations.hidden = true;
  setReady(false);

  naturalLine.textContent = result.native;
  naturalLine.lang = D.native;
  naturalRow.hidden = false;

  for (const [index, chunk] of result.chunks.entries()) {
    comparator.append(chunkField(chunk, index));
  }
  streakCounted = false;

  // With no breakdown there is nothing to line up, so the sentence is
  // shown as one piece rather than pretending to a word-by-word split.
  if (result.chunks.length === 0) {
    const whole = document.createElement('p');
    whole.className = 'chunk';
    whole.lang = D.target;
    whole.style.fontSize = '1.4rem';
    whole.textContent = result.target;
    comparator.append(whole);
  }

  lessonCard.hidden = false;
  focusNextOpen();
  if (read) speak(result.target);
}

/* Speech -----------------------------------------------------------
   The server reads the sentence with an Azure voice and hands back an
   MP3. If it is not set up there, the browser's own voice steps in. */

const canSpeakLocally = 'speechSynthesis' in window;
const DOUBLE_TAP_MS = 400;
let lastPipe = 0;
/** Flipped off the first time the server says it has no voice. */
let serverSpeech = true;
const player = new Audio();

function localVoice() {
  const voices = speechSynthesis.getVoices();
  const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(D.target));
  return matching.find((voice) => voice.localService) ?? matching[0] ?? null;
}

/* Asking for the same thing again and again is a sign it went by too
   fast: from the third play on, each replay comes a little slower,
   down to a floor. Another word or sentence starts at full speed. */
const SLOW_FROM = 3;
const SLOW_STEP = 0.15;
const SLOWEST = 0.55;
let lastSpoken = '';
let plays = 0;

function tempoFor(text) {
  const key = fold(text);
  plays = key === lastSpoken ? plays + 1 : 1;
  lastSpoken = key;
  return Math.max(SLOWEST, 1 - Math.max(0, plays - SLOW_FROM + 1) * SLOW_STEP);
}

function speakLocally(text, tempo = 1) {
  if (!canSpeakLocally) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = D.targetLocale;
  utterance.rate = 0.9 * tempo;
  const voice = localVoice();
  if (voice) utterance.voice = voice;
  utterance.addEventListener('end', () => finishedSaying(text));
  speechSynthesis.speak(utterance);
}

/* The sentence is read when it appears and again when it is finished, but
   not on top of itself: a reading still going is left to end, and one that
   ended moments ago is not repeated. */
const SENTENCE_ECHO_MS = 5000;
/** What is being said right now, folded, or '' between readings. */
let saying = '';
/** When the sentence on screen was last heard to the end. */
let sentenceEndedAt = 0;

function finishedSaying(text) {
  if (fold(text) !== saying) return;
  saying = '';
  if (fold(text) === fold(current.target ?? '')) sentenceEndedAt = Date.now();
}

/** True while the sentence is being read, or within moments of it ending. */
function sentenceJustHeard() {
  const sentence = fold(current.target ?? '');
  return saying === sentence || Date.now() - sentenceEndedAt < SENTENCE_ECHO_MS;
}

player.addEventListener('ended', () => finishedSaying(saying));

/* A word reads itself out when it is completed, unless it was already
   read aloud while this blank had the focus: then the learner has just
   heard it. Moving to another blank starts afresh. */
let heardInFocus = false;

/** The word of the selected blank, folded, for telling what was read. */
function focusedWord() {
  const chunk = current.chunks?.[selected];
  return chunk ? fold(chunk.target) : '';
}

function speakOnDone(chunk) {
  if (heardInFocus && fold(chunk.target) === focusedWord()) return;
  speak(chunk.target);
}

async function speak(text) {
  if (!text || muted) return;
  if (fold(text) === focusedWord()) heardInFocus = true;
  const tempo = tempoFor(text);
  player.pause();
  if (canSpeakLocally) speechSynthesis.cancel();
  // A sentence cut short by a word counts as heard up to here.
  if (saying && saying === fold(current.target ?? '')) sentenceEndedAt = Date.now();
  saying = fold(text);

  if (serverSpeech) {
    try {
      const voice = chosenVoice();
      const response = await fetch(
        `/api/speak?lang=${D.target}&v=${speechVersion}${voice ? `&voice=${encodeURIComponent(voice)}` : ''}&text=${encodeURIComponent(text)}`,
      );
      if (response.status === 503) {
        serverSpeech = false;
      } else if (response.ok) {
        const blob = await response.blob();
        player.src = URL.createObjectURL(blob);
        player.preservesPitch = true;
        player.playbackRate = tempo;
        await player.play();
        return;
      } else {
        saying = '';
        return;
      }
    } catch {
      // Fall through to the local voice for this one sentence.
    }
  }
  if (canSpeakLocally) speakLocally(text, tempo);
  else saying = '';
}

// The caret stays in the blank while the sentence is read.
speakButton.addEventListener('mousedown', (event) => event.preventDefault());
speakButton.addEventListener('click', () => speak(current.target));

/* The voice -----------------------------------------------------------
   The server has a few voices for each language; the menu lets the learner
   pick the one that reads the language being learned. Each direction keeps
   its own choice, on this device. */

const voiceRow = document.querySelector('#voice-row');
const voiceSelect = document.querySelector('#voice');
const voiceLabel = document.querySelector('#voice-label');
/** The voices the server offers, by language, once it has said which it has. */
let voices = null;

function voiceKey() {
  return `potets.stemme.${learning}`;
}

/** The voice chosen for the language being learned, or '' for the server's default. */
function chosenVoice() {
  return recall(voiceKey()) ?? '';
}

function renderVoices() {
  const list = voices?.[learning] ?? [];
  voiceRow.hidden = list.length < 2;
  voiceLabel.textContent = D.voice;
  voiceSelect.setAttribute('aria-label', D.voice);
  const chosen = list.some((voice) => voice.id === chosenVoice()) ? chosenVoice() : list[0]?.id;
  voiceSelect.replaceChildren(
    ...list.map((voice) => {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = voice.name;
      option.selected = voice.id === chosen;
      return option;
    }),
  );
}

// The new voice introduces itself with the sentence on screen.
voiceSelect.addEventListener('change', () => {
  remember(voiceKey(), voiceSelect.value);
  if (current.target) speak(current.target);
});

// A click on the card's empty space puts the caret in the first blank
// still open, but only when no blank has it: a caret already in a word
// stays where it is. The word boxes, the buttons and the links in the
// card keep their own behaviour, and a click outside the card moves nothing.
lessonCard.addEventListener('mousedown', (event) => {
  if (event.target.closest('button, [role="button"], a, [contenteditable], .chunk')) return;
  event.preventDefault();
  if (document.activeElement?.closest('.chunk')) return;
  focusNextOpen();
});

/* Word bank -------------------------------------------------------- */

/** Words per chest. */
const CHEST_SIZE = 25;
/** Which chest is listed; -1 means the one being filled. */
let viewGroup = -1;
/** Closed: the newest few words. Open: a whole chest, with the picker. */
let chestOpen = false;
const PEEK = 5;
/** The word whose badge just rose a tier, folded; its badge gets a flourish once. */
let upgraded = '';
/** Whether a word in the sentence on screen filled a chest. */
let chestFilled = false;

chestToggle.addEventListener('click', () => {
  chestOpen = !chestOpen;
  renderBank(loadBank());
});

/** How many words the chest being filled holds, out of 25. A bank of
    exactly 25 is a full chest, not an empty new one. */
function inChest(total) {
  const full = total > 0 && total % CHEST_SIZE === 0 ? total / CHEST_SIZE - 1 : Math.floor(total / CHEST_SIZE);
  return total - full * CHEST_SIZE;
}

/** One star on the chest's lid for every chest filled; past five, a
    count instead of a row. */
function renderStars(total) {
  const full = Math.floor(total / CHEST_SIZE);
  chestStars.textContent = full === 0 ? '' : full <= 5 ? '⭐'.repeat(full) : `⭐×${full}`;
  chestStars.title = full ? D.fullChests(full) : '';
}

/** A small chest: the same drawing, with its count on the front and a star on a full lid. */
function smallChest(count, full) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'chest');
  svg.setAttribute('viewBox', '0 0 60 50');
  svg.setAttribute('width', '38');
  svg.setAttribute('height', '32');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#chest-shape');
  svg.append(use);
  const stars = document.createElement('span');
  stars.className = 'chest-stars';
  stars.textContent = full ? '⭐' : '';
  const tally = document.createElement('span');
  tally.className = 'bank-count';
  tally.textContent = `${count}/${CHEST_SIZE}`;
  return [svg, stars, tally];
}

/** How many small chests stand in the row before the rest fold into a count. */
const CHESTS_SHOWN = 5;
/** Whether the folded chests have been unfolded. */
let chestsAll = false;

/** The chest row: one small chest per 25 words, the newest last, there
    whenever there is more than one. Past five, the oldest fold into a
    "+n" that unfolds them. A small chest opens the bank on that chest;
    the one open is raised. */
function renderGroups(total) {
  const groups = Math.max(1, Math.ceil(total / CHEST_SIZE));
  if (viewGroup < 0 || viewGroup >= groups) viewGroup = groups - 1;
  chestRow.hidden = groups < 2;
  chestRow.setAttribute('aria-label', D.chest);
  chestRow.replaceChildren();
  const folded = chestsAll ? 0 : Math.max(0, groups - CHESTS_SHOWN);
  if (folded > 0) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'chest-more ghost';
    more.textContent = `+${folded}`;
    more.title = D.moreChests(folded);
    more.setAttribute('aria-label', more.title);
    more.addEventListener('click', () => {
      chestsAll = true;
      renderBank(loadBank());
    });
    chestRow.append(more);
  }
  for (let at = folded; at < groups; at += 1) {
    const from = at * CHEST_SIZE + 1;
    const to = Math.min(total, (at + 1) * CHEST_SIZE);
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'chest-pick';
    pick.title = `${D.chest} ${at + 1} · ${from}–${to}`;
    pick.setAttribute('aria-label', pick.title);
    pick.setAttribute('aria-pressed', String(chestOpen && at === viewGroup));
    pick.append(...smallChest(to - from + 1, to - from + 1 === CHEST_SIZE));
    pick.addEventListener('click', () => {
      viewGroup = at;
      chestOpen = true;
      renderBank(loadBank());
    });
    chestRow.append(pick);
  }
  return viewGroup;
}

function renderBank(words) {
  bankList.replaceChildren();
  bankCount.textContent = `${inChest(words.length)}/${CHEST_SIZE}`;
  renderStars(words.length);
  // The chest is there from the start, with a line on what fills it.
  bank.hidden = false;
  bankEmpty.hidden = words.length > 0;
  bankEmpty.textContent = D.bankEmpty;
  chestWrap.dataset.open = String(chestOpen);
  chestToggle.setAttribute('aria-expanded', String(chestOpen));
  chestToggle.setAttribute('aria-label', chestOpen ? D.chestClose : D.chestOpen);
  chestToggle.title = chestOpen ? D.chestClose : D.chestOpen;

  const indexed = words.map((word, index) => [index, word]);
  const group = renderGroups(words.length);
  let shown;
  if (chestOpen) {
    const start = group * CHEST_SIZE;
    shown = indexed.slice(start, start + CHEST_SIZE);
  } else {
    // The most recently touched, so a comeback surfaces its badge.
    shown = indexed
      .map((entry, order) => [entry, entry[1].at ?? order])
      .sort((a, b) => b[1] - a[1])
      .slice(0, PEEK)
      .map(([entry]) => entry);
  }

  for (const [index, word] of shown) {
    const item = document.createElement('li');
    item.className = rarityOf(word);
    if (upgraded && fold(word.target) === upgraded) {
      item.classList.add('upgraded');
      item.addEventListener('animationend', () => item.classList.remove('upgraded'));
    }

    const picture = pictureNode(word.pic, word.emoji ?? '', word.english ?? '');
    if (picture) {
      item.classList.add('pictured');
      item.append(picture);
    }

    const target = document.createElement('span');
    target.className = 'tr';
    target.lang = D.target;
    target.textContent = word.target;

    const native = document.createElement('span');
    native.className = 'no';
    native.lang = D.native;
    native.textContent = word.native;

    const tally = document.createElement('span');
    tally.className = 'tally';
    tally.textContent = `×${word.count ?? 1}`;
    tally.title = D.tally;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost';
    remove.textContent = '−';
    remove.setAttribute('aria-label', D.remove(word.target));
    remove.addEventListener('click', () => {
      saveBank(words.filter((_, at) => at !== index));
      if (selected >= 0) renderDetail(current.chunks[selected]);
    });

    // The badge reads its word out, and for a word that inflects opens its
    // forms below the chest. The minus is the one part that does neither.
    const open = () => {
      speak(word.target);
      if (inflects(word.pos)) {
        openForms(word.target, word.pos, {
          native: word.native,
          pic: word.pic,
          emoji: word.emoji ?? '',
          english: word.english ?? '',
          scroll: true,
        });
      }
    };
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.title = inflects(word.pos) ? D.showForms(word.target) : D.sayWord(word.target);
    item.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      open();
    });
    item.addEventListener('keydown', (event) => {
      if (event.target !== item || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      open();
    });

    item.append(target, native, tally, remove);
    bankList.append(item);
  }
  // The flourish is shown once.
  upgraded = '';
}

/* Forms -------------------------------------------------------------
   A chest word opened up: every form the language makes of it, as a
   table of persons by tenses for a verb, cases by number for a noun.
   The server asks the model once per word and keeps the answer; the
   page keeps what it has fetched for the visit. */

const formsCache = new Map();
/** The chest word whose forms are open, or '' while the panel is closed. */
let formsFor = '';
/** The table on screen, kept so a flip of the axes can draw it again. */
let formsShown = null;
/** Which way the matrix lies: groups down the side (the default) or across the top. */
const FORMS_AXES = 'potets.forms.axes';
let formsGroupsAcross = recall(FORMS_AXES) === 'across';

/** The card with no word in it yet: a line on how to get one there. */
function resetForms() {
  formsFor = '';
  formsShown = null;
  formsLook = {};
  builtIn = null;
  formsFlip.hidden = true;
  formsTitle.replaceChildren();
  formsBody.replaceChildren(builderFrame());
  renderEmptyBuilt();
  applyFormsViews(false);
}

/** Whether a word of this class has forms worth a table. */
function inflects(pos) {
  return !pos || pos === 'verb' || pos === 'noun' || pos === 'adjective';
}

/** The blank the drawing is helping along: its root typed right, the
    endings left to find with the arrows, which write the form into it. */
let helping = null;

/** Hands the help to a blank, or to none; the choices at the top of the
    card show for it, the hints alone before any table has come. */
function setHelping(next) {
  helping?.field.parentElement.classList.remove('helping');
  helping = next;
  next?.field.parentElement.classList.add('helping');
  renderChoices();
}

/** The word without the punctuation it carries in the sentence. */
function bareWord(text) {
  return text.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}'’]+$/gu, '');
}

/**
 * The blank in focus builds its word in sections, as the drawn word does:
 * the root section is typed, and the ending sections are picked with the
 * arrows, which go on after whatever root stands there. The root's forms
 * are fetched as soon as the blank is in focus, with the endings bare.
 */
function startBuilding(field, chunk) {
  const root = chunk.morphemes?.[0]?.form ?? '';
  if (!root || (chunk.morphemes?.length ?? 0) < 2 || !inflects(chunk.pos) || !piecesOf(chunk)) return;
  setHelping({ field, chunk });
  openForms(bareWord(root), chunk.pos, {
    pic: pictureWord(chunk),
    emoji: pictureEmoji(chunk),
    english: chunk.english ?? '',
    bare: true,
  });
}

/** The card follows the word in hand, once it is solved: an open blank
    would have its answer given away by the table. */
function followWord(chunk) {
  if (!chunk || !isSolved(current.chunks.indexOf(chunk)) || !inflects(chunk.pos)) return;
  const word = bareWord(chunk.target);
  if (!word) return;
  openForms(word, chunk.pos, {
    native: chunk.native,
    pic: pictureWord(chunk),
    emoji: pictureEmoji(chunk),
    english: chunk.english ?? '',
  });
}

function formsNote(text) {
  const note = document.createElement('p');
  note.className = 'hint-text';
  note.textContent = text;
  return note;
}

/** What the card is headed with: the word's picture, the word, its meaning. */
let formsLook = {};

function renderFormsTitle(word, meaning) {
  formsTitle.replaceChildren();
  const picture = pictureNode(formsLook.pic ?? '', formsLook.emoji ?? '', formsLook.english ?? '');
  if (picture) formsTitle.append(picture);
  const base = document.createElement('span');
  base.className = 'forms-base';
  base.lang = D.target;
  base.textContent = word;
  formsTitle.append(base);
  if (meaning) {
    const means = document.createElement('span');
    means.className = 'forms-meaning';
    means.lang = D.native;
    means.textContent = meaning;
    formsTitle.append(means);
  }
}

/** Opens the forms of a word, or closes them when they are the ones open. */
async function openForms(word, pos, look = {}) {
  if (formsFor === word) {
    // The same word again, but now with its endings to be found.
    if (look.bare && formsShown && builtIn?.entry) showBuilt(null, null, false);
    return;
  }
  formsFor = word;
  formsLook = look;
  builtWord = '';
  formsShown = null;
  formsFlip.hidden = true;
  renderFormsTitle(word, look.native ?? '');
  formsBody.replaceChildren(formsNote(D.formsLoading));
  if (look.scroll && showForms) formsPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const key = `${learning}:${word}`;
  try {
    let table = formsCache.get(key);
    if (!table) {
      const query = new URLSearchParams({ word, lang: learning, ...(pos ? { pos } : {}) });
      const response = await fetch(`/api/forms?${query}`);
      if (!response.ok) throw new Error(`Forms came back with ${response.status}.`);
      table = await response.json();
      formsCache.set(key, table);
    }
    if (formsFor !== word) return;
    renderForms(table);
  } catch (error) {
    console.warn(error);
    if (formsFor !== word) return;
    formsBody.replaceChildren(formsNote(D.formsFailed));
  }
}

/** The pieces of a form, or the whole word when it was not split. */
function piecesOfForm(entry) {
  return entry.pieces?.length ? entry.pieces : [entry.word];
}

/**
 * The tint each piece of a form wears, the same across the whole table: the
 * root in the first, the ending the group is about in the second, the ending
 * the label is about in the third, and anything else by its place.
 */
function pieceTints(entry, groupHint, label) {
  const group = groupHint ? hintFold(groupHint) : null;
  const labelHint = splitLabel(label).hint;
  const own = labelHint ? hintFold(labelHint) : null;
  return piecesOfForm(entry).map((piece, index) => {
    if (index === 0) return 0;
    if (group !== null && hintMatches(piece, group)) return 1;
    if (own !== null && hintMatches(piece, own)) return 2;
    return endingTint(piece, index);
  });
}

/** One form, painted piece by piece in the tints the blanks use. A click reads
    it aloud; a click or the keyboard's focus also builds it up above the table. */
function formButton(entry, group) {
  const tints = pieceTints(entry, group.hint, entry.label);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'form';
  button.lang = D.target;
  button.title = D.sayWord(entry.word);
  button.dataset.word = entry.word;
  piecesOfForm(entry).forEach((piece, index) => {
    const span = document.createElement('span');
    span.className = 'm';
    span.dataset.m = String(tints[index] ?? index % 4);
    span.textContent = piece;
    button.append(span);
  });
  button.addEventListener('click', () => {
    speak(entry.word);
    showBuilt(entry, group);
  });
  button.addEventListener('focus', () => showBuilt(entry, group));
  if (!entry.means) return button;
  // What the form says, in the learner's own language, in softer text under it.
  const cell = document.createElement('span');
  cell.className = 'form-cell';
  const means = document.createElement('span');
  means.className = 'form-means';
  means.lang = D.native;
  means.textContent = entry.means;
  cell.append(button, means);
  return cell;
}

/** A cell holding a form: a click anywhere in it, not just on the word,
    counts as a click on the word. */
function formCell(row, entry, group) {
  const cell = row.insertCell();
  const node = formButton(entry, group);
  cell.append(node);
  const button = node.matches('button') ? node : node.querySelector('button');
  cell.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    button.click();
  });
  return cell;
}

/** Whether a piece is the folded ending, allowing the y, n or s a vowel
    puts before it: "yi" is "-i" in "kediyi", "nin" is "-in" in "kedinin". */
function hintMatches(piece, wanted) {
  const folded = hintFold(piece);
  if (folded === wanted) return true;
  return folded.length === wanted.length + 1 && /^[yns]/u.test(folded) && folded.slice(1) === wanted;
}

/** Which piece of these forms the ending is: the index it sits at most often, or -1. */
function hintIndex(hint, forms) {
  const wanted = hintFold(hint);
  const votes = new Map();
  for (const form of forms) {
    const index = (form.pieces ?? []).findIndex((piece) => hintMatches(piece, wanted));
    if (index >= 0) votes.set(index, (votes.get(index) ?? 0) + 1);
  }
  let best = -1;
  for (const [index, count] of votes) if (count > (votes.get(best) ?? 0)) best = index;
  return best;
}

/** A heading with a name and, under it, the ending painted like the piece it
    is in the cells. Above a column, the pieces before it are laid out unseen,
    so the ending stands over the piece it names. */
function formsHead({ name, hint, about, forms, scope, tint }) {
  const head = document.createElement('th');
  head.scope = scope;
  head.textContent = name;
  if (hint) {
    const line = document.createElement('span');
    line.className = 'hint';
    line.lang = D.target;
    const index = hintIndex(hint, forms);
    if (index >= 0 && scope === 'col') {
      const lead = forms[0]?.pieces ?? [];
      for (const piece of lead.slice(0, index)) {
        const ghost = document.createElement('span');
        ghost.className = 'm ghost';
        ghost.textContent = piece;
        line.append(ghost);
      }
    }
    const ending = document.createElement('span');
    ending.textContent = hint;
    if (index >= 0) {
      ending.className = 'm';
      ending.dataset.m = String(tint);
    }
    line.append(ending);
    head.append(line);
  }
  // What the ending does, in a few keywords, like the margin of a grammar table.
  if (about) {
    const note = document.createElement('span');
    note.className = 'about';
    note.lang = D.native;
    note.textContent = about;
    head.append(note);
  }
  return head;
}

/** A label such as "akkusativ (-i)" carries its ending in brackets; split it off. */
function splitLabel(label) {
  const match = /^(.*?)\s*\((-[^)]+)\)$/.exec(label);
  return match ? { name: match[1], hint: match[2] } : { name: label, hint: '' };
}

function formsLabelHead(label, forms, scope) {
  // The keywords are the same for the label in every group; the first form that has them speaks.
  const about = forms.find((form) => form?.about)?.about ?? '';
  return formsHead({ ...splitLabel(label), about, forms, scope, tint: 2 });
}

function formsGroupHead(group, scope) {
  // The ending under the name, unless the name already carries it.
  const hint = group.hint && !group.name.includes(group.hint) ? group.hint : '';
  return formsHead({ name: group.name, hint, about: group.about ?? '', forms: group.forms, scope, tint: 1 });
}

/** Groups that share their labels, in order, make one table. Groups lie down
    the side and labels across the top, or the other way round when flipped. */
function formsMatrix(groups) {
  const table = document.createElement('table');
  table.className = 'forms-table';
  const headRow = table.createTHead().insertRow();
  headRow.append(document.createElement('th'));
  const tbody = table.createTBody();
  // The forms that share a label, one from each group.
  const across = (index) => groups.map((group) => group.forms[index]);
  if (formsGroupsAcross) {
    for (const group of groups) headRow.append(formsGroupHead(group, 'col'));
    groups[0].forms.forEach((first, index) => {
      const row = tbody.insertRow();
      row.append(formsLabelHead(first.label, across(index), 'row'));
      for (const group of groups) {
        formCell(row, group.forms[index], group);
      }
    });
  } else {
    groups[0].forms.forEach((first, index) => headRow.append(formsLabelHead(first.label, across(index), 'col')));
    for (const group of groups) {
      const row = tbody.insertRow();
      row.append(formsGroupHead(group, 'row'));
      for (const entry of group.forms) formCell(row, entry, group);
    }
  }
  return table;
}

/** Groups with labels of their own each get a small table under their name. */
function formsList(group) {
  const table = document.createElement('table');
  table.className = 'forms-table forms-group';
  const caption = table.createCaption();
  caption.textContent = group.hint && !group.name.includes(group.hint) ? `${group.name} ${group.hint}` : group.name;
  const tbody = table.createTBody();
  for (const entry of group.forms) {
    const row = tbody.insertRow();
    row.append(formsLabelHead(entry.label, [entry], 'row'));
    formCell(row, entry, group);
  }
  return table;
}

function renderForms(table) {
  formsBody.replaceChildren();
  renderFormsTitle(table.base, table.meaning);

  const groups = table.groups ?? [];
  if (groups.length === 0) {
    formsBody.append(formsNote(D.formsNone));
    return;
  }
  formsBody.append(builderFrame());
  const labels = groups[0].forms.map((entry) => entry.label);
  const aligned =
    groups.length > 1 &&
    groups.every(
      (group) => group.forms.length === labels.length && group.forms.every((entry, i) => entry.label === labels[i]),
    );
  const scroll = document.createElement('div');
  scroll.className = 'forms-scroll';
  if (aligned) scroll.append(formsMatrix(groups));
  else scroll.append(...groups.map(formsList));
  formsBody.append(scroll);
  formsShown = table;
  applyFormsViews(aligned);
  // Built up first: the root alone when the endings are to be found; else
  // the form last shown, else the word the table was opened for, else the
  // first form there is.
  if (formsLook.bare) {
    showBuilt(null, null, false);
    return;
  }
  const wanted = (builtWord || formsFor).toLocaleLowerCase(D.target);
  let pick = null;
  for (const group of groups) {
    const entry = group.forms.find((form) => form.word.toLocaleLowerCase(D.target) === wanted);
    if (entry) {
      pick = { entry, group };
      break;
    }
  }
  pick ??= { entry: groups[0].forms[0], group: groups[0] };
  showBuilt(pick.entry, pick.group, false);
}

/* The word builder ---------------------------------------------------
   Above the table, one form is built up a piece at a time, a staircase
   of the word growing to the right: the root, then the root with its
   first ending, and so on to the whole form. Beside each step stands
   what the word says so far, taken from the table where that shorter
   word is a form of its own, and what the new piece does. Turkish
   packs a phrase into one word, and this is the packing shown. */

/** The word built up last, so a redraw of the table keeps it. */
let builtWord = '';
let builtIn = null;

/** How the word is drawn, one of BUILDER_VIEWS; the drawings are in learn/builder-art.js. */
const BUILDER_VIEW = 'potets.bygger';
let builderView = BUILDER_VIEWS.includes(recall(BUILDER_VIEW)) ? recall(BUILDER_VIEW) : 'rocket';

function builderFrame() {
  const frame = document.createElement('figure');
  frame.className = 'builder';
  const caption = document.createElement('figcaption');
  const views = document.createElement('span');
  views.className = 'build-views';
  views.setAttribute('role', 'group');
  for (const view of BUILDER_VIEWS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.dataset.view = view;
    button.title = D.builderViews[view];
    button.setAttribute('aria-label', D.builderViews[view]);
    button.setAttribute('aria-pressed', String(view === builderView));
    button.textContent = BUILDER_ICONS[view];
    button.addEventListener('click', () => {
      builderView = view;
      remember(BUILDER_VIEW, view);
      for (const other of views.children) other.setAttribute('aria-pressed', String(other === button));
      if (builtIn) showBuilt(builtIn.entry, builtIn.group);
      else renderEmptyBuilt();
    });
    views.append(button);
  }
  caption.append(views);
  caption.setAttribute('aria-label', D.builder);
  const steps = document.createElement('div');
  steps.className = 'build-steps';
  frame.append(caption, steps);
  return frame;
}

/** Which comes first in the words of this table: the group's ending or the label's. */
function groupEndingFirst() {
  for (const group of formsShown?.groups ?? []) {
    for (const entry of group.forms) {
      const tints = pieceTints(entry, group.hint, entry.label);
      const ofGroup = tints.indexOf(1);
      const ofLabel = tints.indexOf(2);
      if (ofGroup > 0 && ofLabel > 0) return ofGroup < ofLabel;
    }
  }
  return true;
}

/**
 * The word in slots that are always there: the root, the group's ending and
 * the label's ending, in the order they come in this table, with an empty
 * slot where the form has no ending there. So "kedi" has the same three
 * parts as "kedilerden", two of them bare, and each can be swapped.
 */
function slotsOf(entry, group, groupFirst = groupEndingFirst()) {
  const pieces = piecesOfForm(entry);
  const tints = pieceTints(entry, group.hint, entry.label);
  const ending = (tint) => pieces.filter((_, index) => index > 0 && tints[index] === tint).join('');
  const root = {
    key: 'root',
    piece: pieces[0],
    tint: 0,
    means: formSpelled([pieces[0]])?.means ?? formsShown?.meaning ?? '',
  };
  const ofGroup = { key: 'group', piece: ending(1), tint: 1, role: { name: group.name, about: group.about ?? '' } };
  const ofLabel = {
    key: 'label',
    piece: ending(2),
    tint: 2,
    role: { name: splitLabel(entry.label).name, about: entry.about ?? '' },
  };
  const extra = pieces
    .map((piece, index) => ({ key: 'extra', piece, tint: tints[index], index }))
    .filter(({ tint, index }) => index > 0 && tint !== 1 && tint !== 2);
  return [root, ...(groupFirst ? [ofGroup, ofLabel] : [ofLabel, ofGroup]), ...extra];
}

/** Every slot as it is in every form of the table, keyed by slot, each once:
    what a part may have to hold, so it can be made wide enough for all. */
function slotOptions() {
  const groupFirst = groupEndingFirst();
  const options = new Map();
  for (const group of formsShown?.groups ?? []) {
    for (const entry of group.forms) {
      for (const slot of slotsOf(entry, group, groupFirst)) {
        const seen = options.get(slot.key) ?? new Map();
        const id = `${slot.piece}|${slot.role?.name ?? slot.means ?? ''}|${slot.role?.about ?? ''}`;
        if (!seen.has(id)) seen.set(id, slot);
        options.set(slot.key, seen);
      }
    }
  }
  return options;
}

/** A part's tag: what the ending does in keywords, or, without any, the
    plain word from its name ("jeg" from "ben (jeg)"); the root's meaning. */
function partTag(slot) {
  const tag = document.createElement('span');
  tag.className = 'option';
  tag.textContent = slotTagText(slot);
  return tag;
}

/** What a slot's tag says: the ending's keywords, else the plain word from
    its name; the root's meaning. */
function slotTagText(slot) {
  if (slot.role) {
    const inBrackets = /\(([^)]+)\)/.exec(slot.role.name)?.[1];
    return slot.role.about || inBrackets || slot.role.name;
  }
  return slot.key === 'root' ? (slot.means ?? '') : '';
}

/** Set while a word is being checked because an arrow wrote into it. */
let byArrow = false;

/** Moves the built form one step along one axis of the table: to the next
    or previous group, keeping the label, or to the next or previous label. */
function stepBuilt(key, delta, from = null) {
  if (!builtIn || !formsShown) return;
  const groups = formsShown.groups;
  let { entry, group } = builtIn;
  if (!entry) {
    // From the bare root: the first or last along the axis pressed, with
    // the other axis left bare where the table has such a form.
    if (key === 'group') {
      group = groups[delta > 0 ? 0 : groups.length - 1];
      entry = group.forms.find((form) => bareIn(slotsOf(form, group), 'label')) ?? group.forms[0];
    } else {
      group = groups.find((candidate) => candidate.forms.some((form) => bareIn(slotsOf(form, candidate), 'group'))) ?? groups[0];
      const forms = group.forms.filter((form) => bareIn(slotsOf(form, group), 'group'));
      const along = forms.length ? forms : group.forms;
      entry = along[delta > 0 ? 0 : along.length - 1];
    }
  } else if (key === 'group') {
    const at = group.forms.indexOf(entry);
    group = groups[(groups.indexOf(group) + delta + groups.length) % groups.length];
    entry = group.forms.find((form) => form.label === entry.label) ?? group.forms[Math.min(at, group.forms.length - 1)];
  } else {
    entry = group.forms[(group.forms.indexOf(entry) + delta + group.forms.length) % group.forms.length];
  }
  // The arrow that was pressed is drawn anew; the keyboard stays on it,
  // or the caret in the segment it came from.
  const back = from ?? formsBody.querySelector(`.part-arrow[data-slot="${key}"][data-dir="${delta > 0 ? 'down' : 'up'}"]`);
  writeBuilt(entry, group, key, back);
}

/** Builds the form with one choice picked outright: a group, keeping the
    label built, or a label of the group built. */
function pickBuilt(key, choice, back = null) {
  if (!formsShown) return;
  const groups = formsShown.groups;
  let { entry, group } = builtIn ?? {};
  if (key === 'group') {
    group = choice;
    entry =
      (entry && group.forms.find((form) => form.label === entry.label)) ??
      group.forms.find((form) => bareIn(slotsOf(form, group), 'label')) ??
      group.forms[0];
  } else {
    group = groups.find((candidate) => candidate.forms.includes(choice)) ?? group ?? groups[0];
    entry = choice;
  }
  writeBuilt(entry, group, key, back);
}

/** Shows a form built, writes its endings into the blank being built, and
    puts the focus back where the change was asked for. */
function writeBuilt(entry, group, key, back) {
  speak(entry.word);
  showBuilt(entry, group, true, key);
  // The blank being built gets the form's endings written into its ending
  // segments, each into the segment of its kind; the root segment keeps
  // whatever is typed there. Then the word is checked as if typed.
  if (helping) {
    const segs = segmentsOf(helping.field);
    const pieces = piecesOfForm(entry);
    const tints = pieceTints(entry, group.hint, entry.label);
    const ending = (tint) => pieces.filter((_, index) => index > 0 && tints[index] === tint).join('');
    const punctuation = /[^\p{L}\p{M}\p{N}'’]+$/u.exec(helping.chunk.target)?.[0] ?? '';
    const last = segs[segs.length - 1];
    for (const seg of segs.slice(1)) {
      const text = seg.dataset.m === '1' ? ending(1) : seg.dataset.m === '2' ? ending(2) : '';
      seg.textContent = seg === last ? text + punctuation : text;
    }
    byArrow = true;
    try {
      checkField(helping.field, helping.chunk);
    } finally {
      byArrow = false;
    }
  }
  if (back?.classList.contains('seg') || back?.classList.contains('tr')) placeCaretIn(back.classList.contains('tr') ? (segmentsOf(back).at(-1) ?? back) : back, true);
  else back?.focus();
}

/** An arrow above or below a part, or a blank of the same size where a part
    has nothing to swap for. */
function partArrow(slot, delta) {
  const swappable = !slot.empty && (slot.key === 'group' || slot.key === 'label');
  if (!swappable) {
    const blank = document.createElement('span');
    blank.className = 'part-arrow blank';
    return blank;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `part-arrow ${delta > 0 ? 'down' : 'up'}`;
  button.dataset.slot = slot.key;
  button.dataset.dir = delta > 0 ? 'down' : 'up';
  button.setAttribute('aria-label', delta > 0 ? D.partDown : D.partUp);
  button.textContent = delta > 0 ? '▼' : '▲';
  button.addEventListener('click', () => stepBuilt(slot.key, delta));
  return button;
}

/** The word as a thing: a nose or face, a part per slot, and a tail. Every
    part but the root has arrows to swap it for the next one in the table. */
function buildThing(entry, group, kind, animate, changed = '') {
  return renderThing(slotsOf(entry, group), slotOptions(), kind, animate, changed);
}

/** The slots of no word at all: a root and two endings, all bare. */
function emptySlots() {
  return [
    { key: 'root', piece: '', tint: 0, means: '', empty: true },
    { key: 'group', piece: '', tint: 1, role: null, empty: true },
    { key: 'label', piece: '', tint: 2, role: null, empty: true },
  ];
}

/** With no word in the card, the drawing stands empty, waiting for one. */
function renderEmptyBuilt() {
  const steps = formsBody.querySelector('.build-steps');
  if (!steps) return;
  const slots = emptySlots();
  steps.replaceChildren(
    builderView === 'stairs'
      ? buildStairs(slots.map((slot) => ({ ...slot, means: '' })), false)
      : renderThing(slots, new Map(), builderView, false),
  );
}

function renderThing(slots, options, kind, animate, changed = '') {
  const thing = document.createElement('div');
  thing.className = `thing ${kind}${animate ? '' : ' still'}`;
  thing.lang = D.target;
  const art = BUILDER_ART[kind];
  // The art is fixed markup from this file; nothing from outside goes in.
  if (art.head) thing.insertAdjacentHTML('beforeend', art.head);
  // The drawing is a grid: a column per part, and rows for the tag, the
  // arrow above, the body, and the arrow below, so the bodies line up
  // however tall the tags are.
  let column = art.head ? 2 : 1;
  slots.forEach((slot, index) => {
    const part = document.createElement('span');
    part.className = 'part';
    // Every ending arrives anew for a form picked in the table; only the
    // swapped one for an arrow.
    if (index > 0 && (!changed || slot.key === changed)) part.classList.add('new');
    part.style.setProperty('--step', String(changed ? 0 : index));
    part.style.setProperty('--col', String(column++));
    // Everything the slot may hold lies stacked and unseen under what it
    // holds now, so the part is as wide and as tall as its widest option
    // and nothing shifts when it is swapped.
    const others = [...(options.get(slot.key)?.values() ?? [])].filter(
      (option) => option.piece !== slot.piece || option.role?.name !== slot.role?.name || option.role?.about !== slot.role?.about,
    );
    const body = document.createElement('span');
    body.className = slot.piece ? 'part-body m' : 'part-body m bare';
    body.dataset.m = String(slot.tint);
    const shown = document.createElement('span');
    shown.className = 'option';
    shown.textContent = slot.piece;
    body.append(shown);
    for (const option of others) {
      const ghost = document.createElement('span');
      ghost.className = 'option ghost';
      ghost.textContent = option.piece;
      body.append(ghost);
    }
    const tag = document.createElement('span');
    tag.className = 'part-tag';
    tag.lang = D.native;
    tag.append(partTag(slot));
    for (const option of others) {
      const ghost = partTag(option);
      ghost.classList.add('ghost');
      tag.append(ghost);
    }
    part.append(tag, partArrow(slot, -1), body, partArrow(slot, 1));
    thing.append(part);
  });
  if (art.tail) thing.insertAdjacentHTML('beforeend', art.tail);
  thing.style.setProperty('--tail-col', String(column));
  return thing;
}

/** The word as a staircase: each row one piece longer than the last. */
function buildStairs(parts, animate) {
  const steps = document.createElement('div');
  steps.className = `stairs${animate ? '' : ' still'}`;
  parts.forEach((_, count) => {
    const step = document.createElement('div');
    step.className = 'build-step';
    step.style.setProperty('--step', String(count));

    const word = document.createElement('span');
    word.className = 'build-word';
    word.lang = D.target;
    parts.slice(0, count + 1).forEach(({ piece, tint }, index) => {
      if (index > 0) {
        const joint = document.createElement('span');
        joint.className = 'joint';
        joint.textContent = '+';
        word.append(joint);
      }
      const block = document.createElement('span');
      block.className = index === count && count > 0 ? 'm new' : 'm';
      block.dataset.m = String(tint);
      block.textContent = piece;
      word.append(block);
    });

    const means = document.createElement('span');
    means.className = 'build-means';
    means.lang = D.native;
    means.textContent = parts[count].means;

    const role = document.createElement('span');
    role.className = 'build-role';
    role.lang = D.native;
    const what = parts[count].role;
    if (what) {
      const name = document.createElement('span');
      name.className = 'm';
      name.dataset.m = String(parts[count].tint);
      name.textContent = what.name;
      role.append(name);
      if (what.about) role.append(` ${what.about}`);
    }
    step.append(word, means, role);
    steps.append(step);
  });
  return steps;
}

/** The form in the table spelled by these pieces, if one is: "sev" + "eceğ"
    is "sevecek", the k only softened because more was to follow. */
function formSpelled(pieces) {
  const soft = (text) => text.toLocaleLowerCase(D.target).replace(/ğ/g, 'k').replace(/d/g, 't').replace(/c/g, 'ç').replace(/b/g, 'p');
  const spelled = soft(pieces.join(''));
  for (const group of formsShown?.groups ?? []) {
    const entry = group.forms.find((form) => soft(piecesOfForm(form).join('')) === spelled);
    if (entry) return entry;
  }
  return null;
}

/** What a piece does, by the heading it belongs to: the group's for the group
    ending, the label's for the label ending. */
function pieceRole(tint, entry, group) {
  if (tint === 1) return { name: group.name, about: group.about ?? '' };
  if (tint === 2) return { name: splitLabel(entry.label).name, about: entry.about ?? '' };
  return null;
}

/** The root alone, with the ending slots bare but their arrows live. */
function rootSlots() {
  const root = formsFor;
  const slots = emptySlots().map((slot) => ({ ...slot, empty: false }));
  slots[0].piece = root;
  slots[0].means = formSpelled([root])?.means ?? formsShown?.meaning ?? '';
  if (!groupEndingFirst()) [slots[1], slots[2]] = [slots[2], slots[1]];
  return slots;
}

function showBuilt(entry, group, animate = true, changed = '') {
  const steps = formsBody.querySelector('.build-steps');
  if (!steps) return;
  builtWord = entry?.word ?? '';
  builtIn = { entry, group };
  for (const button of formsBody.querySelectorAll('.form')) {
    button.classList.toggle('built', !!entry && button.dataset.word === entry.word);
  }
  if (!entry) {
    // The root alone: the endings are there to be found with the arrows.
    const slots = rootSlots();
    steps.replaceChildren(
      builderView === 'stairs'
        ? buildStairs([{ piece: slots[0].piece, tint: 0, means: slots[0].means, role: null }], false)
        : renderThing(slots, slotOptions(), builderView, false),
    );
    renderChoices();
    return;
  }
  renderChoices();
  const pieces = piecesOfForm(entry);
  const tints = pieceTints(entry, group.hint, entry.label);
  // Each piece with its tint, what it does, and what the word says once it
  // is on: the table's own words where the shorter word is in it, the base
  // meaning for a bare root.
  const parts = pieces.map((piece, index) => {
    const known = index === pieces.length - 1 ? entry : formSpelled(pieces.slice(0, index + 1));
    return {
      piece,
      tint: tints[index] ?? index % 4,
      role: index > 0 ? pieceRole(tints[index], entry, group) : null,
      means: known?.means ?? (index === 0 ? (formsShown?.meaning ?? '') : ''),
    };
  });
  steps.replaceChildren(
    builderView === 'stairs' ? buildStairs(parts, animate) : buildThing(entry, group, builderView, animate, changed),
  );
}

/* What the card shows: the drawing, the table, or both. The table is
   tucked away to begin with; the drawing is the first thing. Both choices
   are kept. */
const FORMS_DRAWING = 'potets.bøyning.tegning';
const FORMS_TABLE = 'potets.bøyning.tabell';
const formsDrawingButton = document.querySelector('#forms-drawing');
const formsTableButton = document.querySelector('#forms-table');
let showDrawing = recall(FORMS_DRAWING) !== 'off';
let showTable = recall(FORMS_TABLE) === 'on';

/** Shows and hides the card's parts by the choices, and the flip with the table. */
function applyFormsViews(aligned = formsBody.querySelector('.forms-table:not(.forms-group)') !== null) {
  formsDrawingButton.setAttribute('aria-pressed', String(showDrawing));
  formsTableButton.setAttribute('aria-pressed', String(showTable));
  const builder = formsBody.querySelector('.builder');
  if (builder) builder.hidden = !showDrawing;
  const scroll = formsBody.querySelector('.forms-scroll');
  if (scroll) scroll.hidden = !showTable;
  // Only a matrix has axes to swap, and only while it is on view.
  formsFlip.hidden = !aligned || !showTable || !scroll;
}

formsDrawingButton.addEventListener('click', () => {
  showDrawing = !showDrawing;
  remember(FORMS_DRAWING, showDrawing ? 'on' : 'off');
  applyFormsViews();
});
formsTableButton.addEventListener('click', () => {
  showTable = !showTable;
  remember(FORMS_TABLE, showTable ? 'on' : 'off');
  applyFormsViews();
});

formsFlip.addEventListener('click', () => {
  formsGroupsAcross = !formsGroupsAcross;
  remember(FORMS_AXES, formsGroupsAcross ? 'across' : 'down');
  if (formsShown) renderForms(formsShown);
});

/* Fetching --------------------------------------------------------- */

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  // Enter in the topic field, with the topic already the one on screen,
  // is "done typing": the caret goes to the blank, no new sentence.
  if (document.activeElement === topicField && topicField.value.trim() === askedTopic) {
    focusNextOpen();
    return;
  }

  const attempt = ++pending;
  const asked = learning;
  const topic = topicField.value.trim();
  submitButton.disabled = true;
  submitButton.classList.add('busy');
  setStatus('');
  // Nothing on screen yet: hold the space the sentence will take.
  if (current.chunks.length === 0) renderSkeleton();

  // The sentence asked for ahead of time, if it is still the right one.
  const key = prefetchKey();
  const ahead = prefetched?.key === key ? prefetched.promise : requestLesson();
  prefetched = null;

  try {
    const { ok, result } = await ahead;
    // A flip while waiting means this answer belongs to the other side.
    if (attempt !== pending || asked !== learning) return;

    if (!ok) {
      setStatus(result.error ?? D.failed, true);
      return;
    }
    askedTopic = topic;
    history.push(result);
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    cursor = history.length - 1;
    saveHistory();
    renderLesson(result, { read: true });
    updateSteps();
    setStatus(result.chunks.length === 0 ? D.noBreakdown : '', result.chunks.length === 0);
    schedulePrefetch();
  } catch {
    if (attempt === pending) setStatus(D.offline, true);
  } finally {
    if (attempt === pending) {
      submitButton.disabled = false;
      submitButton.classList.remove('busy');
    }
  }
});

/* Prefetch ---------------------------------------------------------- */

/** Asks the server for a new sentence for the current settings. */
async function requestLesson() {
  const response = await fetch('/api/lesson', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      learning,
      level,
      topic: topicField.value.trim(),
      // The recent sentences, so the next one is not one of them.
      avoid: history.slice(-30).map((entry) => entry.target),
      // A few chest words the sentence could bring back.
      review: comebacks(loadBank()),
    }),
  });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, result };
}

/**
 * The next sentence is asked for while this one is being solved, so
 * "Neste" is instant. It is only good for the settings it was asked
 * under and for following the sentence on screen; the key says which.
 */
let prefetched = null;
let prefetchTimer = 0;

function prefetchKey() {
  return JSON.stringify([learning, level, topicField.value.trim(), history.at(-1)?.target ?? '']);
}

function prefetch() {
  if (cursor !== history.length - 1 || history.length === 0) return;
  const key = prefetchKey();
  if (prefetched?.key === key) return;
  const promise = requestLesson();
  // A failed prefetch is forgotten, so "Neste" asks afresh and shows
  // the error itself.
  promise.catch(() => {
    if (prefetched?.promise === promise) prefetched = null;
  });
  prefetched = { key, promise };
}

/** Prefetch shortly, so typing a theme letter by letter asks once. */
function schedulePrefetch() {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(prefetch, 1200);
}

topicField.addEventListener('input', schedulePrefetch);

/* A new topic ------------------------------------------------------
   Typing a topic and stopping is enough: once the field has been still
   for a moment, or is left, a sentence on the new topic replaces the one
   on screen. The prefetch above has usually fetched it already. */

const TOPIC_SETTLE_MS = 1500;
/** The topic the sentence on screen was asked with; null before the first. */
let askedTopic = null;
let topicTimer = 0;

function topicSettled() {
  clearTimeout(topicTimer);
  const topic = topicField.value.trim();
  if (!topic || topic === askedTopic || submitButton.disabled) return;
  form.requestSubmit();
}

topicField.addEventListener('input', () => {
  remember(keyFor('emne'), topicField.value.trim());
  clearTimeout(topicTimer);
  topicTimer = setTimeout(topicSettled, TOPIC_SETTLE_MS);
});
topicField.addEventListener('change', topicSettled);

/* Level ------------------------------------------------------------ */

let level = 'start';

function setLevel(value) {
  const [key, label] = D.levels.find(([candidate]) => candidate === value) ?? D.levels[0];
  level = key;
  levelName.textContent = label;
  levelButton.setAttribute('aria-label', `${D.levelLabel}: ${label}`);
  remember(keyFor('niva'), key);
}

levelButton.addEventListener('click', () => {
  const at = D.levels.findIndex(([key]) => key === level);
  setLevel(D.levels[(at + 1) % D.levels.length][0]);
  // A new level is a fresh start: the sentences so far were at the old
  // one, so they go, and the first sentence at this level comes at once.
  history = [];
  saveHistory();
  cursor = -1;
  current = { chunks: [] };
  prefetched = null;
  renderLog();
  form.requestSubmit();
});

/* Direction switch ------------------------------------------------- */

/** The build, fetched once and kept in the tab title. */
let version = '';
/** Fingerprint of the voice settings; part of every speech URL so the
 *  browser's cache is bypassed when the voice changes. */
let speechVersion = '';
fetch('/api/version')
  .then((response) => (response.ok ? response.json() : null))
  .then((body) => {
    if (typeof body?.speech === 'string') speechVersion = body.speech;
    if (body?.voices && typeof body.voices === 'object') {
      voices = body.voices;
      renderVoices();
    }
    if (typeof body?.pictures === 'string') {
      pictureVersion = body.pictures;
      renderBank(loadBank());
      if (selected >= 0) renderDetail(current.chunks[selected]);
    }
    if (typeof body?.version === 'string') {
      version = body.version;
      setTitle();
      // "0.1.0+5f87809" -> "5f87809"
      document.querySelector('#build').textContent = version.split('+')[1] ?? version;
    }
  })
  .catch(() => {});

function setTitle() {
  document.title = version ? `${D.title} · ${version}` : D.title;
}

/** Writes every label on the page in the learner's own language. */
function applyDirection() {
  D = DIRECTIONS[learning];
  document.documentElement.lang = D.native;
  setTitle();
  flagFrom.replaceChildren(flag(D.flagFrom));
  flagTo.replaceChildren(flag(D.flagTo));
  speakBall.replaceChildren(flag(D.flagTo));
  setFavicon(D.flagTo);
  directionLabel.textContent = D.label;
  flipButton.title = D.flip;
  renderTheme();
  renderMute();
  renderVoices();
  renderCredits();
  resetForms();
  for (const [button, label] of [
    [formsDrawingButton, D.formsDrawing],
    [formsTableButton, D.formsTable],
  ]) {
    button.title = label;
    button.setAttribute('aria-label', label);
  }
  formsFlip.title = D.formsFlip;
  formsFlip.setAttribute('aria-label', D.formsFlip);
  loginLabel.textContent = D.login;
  renderAccount();
  menuButton.title = D.menu;
  menuButton.setAttribute('aria-label', D.menu);
  flipButton.setAttribute('aria-label', D.flip);
  levelButton.title = D.switchLevel;
  classesName.textContent = D.wordClasses;
  classesButton.title = D.wordClassesHelp;
  classesButton.setAttribute('aria-label', D.wordClasses);
  renderClassesToggle();
  showFormsName.textContent = D.formsCard;
  showFormsButton.title = D.formsCardHelp;
  showFormsButton.setAttribute('aria-label', D.formsCard);
  renderShowForms();
  topicField.placeholder = D.topicPlaceholder;
  topicField.setAttribute('aria-label', D.topic);
  // Each side remembers its own topic, an emptied one included. With none
  // saved the field is empty, and the server picks a situation itself.
  topicField.value = recall(keyFor('emne')) ?? '';
  renderTopicIdeas();
  // The shortcuts ride in the tooltip: | for the word in focus, || for the sentence.
  speakButton.title = `${D.speak} · | ${D.keyHelp[0]} · || ${D.keyHelp[1]}`;
  speakButton.setAttribute('aria-label', D.speak);
  hintButton.replaceChildren(`${D.hint} `, Object.assign(kbd('.'), { className: 'key' }));
  renderSpecialKeys();
  steps.setAttribute('aria-label', D.browse);
  document.querySelector('#bank .sr-only').textContent = D.bank;
}

/**
 * What the topic field offers when opened: the grammar points of the
 * sentences had so far, newest first, then a few situations and points
 * to ask for. Any of them can be typed over.
 */
function renderTopicIdeas() {
  const recent = history
    .map((entry) => (typeof entry.focus === 'string' ? entry.focus.trim() : ''))
    .filter(Boolean)
    .reverse();
  const ideas = [...new Set([...recent, ...D.topics])].slice(0, 24);
  topicIdeas.replaceChildren(
    ...ideas.map((idea) => {
      const option = document.createElement('option');
      option.value = idea;
      return option;
    }),
  );
}

function kbd(text) {
  const key = document.createElement('kbd');
  key.textContent = text;
  return key;
}

function flag(id) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/** One ball as a self-contained SVG file, for the tab icon. The symbol
    on the page leans on shared clip and eyes; both are copied in. */
function ballDataUrl(id) {
  const symbol = document.querySelector(`#${id}`);
  const clip = document.querySelector('#ball-clip');
  const eyes = document.querySelector('#ball-eyes');
  const body = symbol.innerHTML.replace('<use href="#ball-eyes"></use>', eyes.innerHTML);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
    `<defs>${clip.outerHTML}</defs>${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function setFavicon(id) {
  document.querySelector('#favicon').href = ballDataUrl(id);
}

/** Switches sides: own labels, own level, own history, own chest. */
function setDirection(value) {
  learning = value === 'nb' ? 'nb' : 'tr';
  remember(DIRECTION_KEY, learning);
  pending += 1;
  player.pause();
  if (canSpeakLocally) speechSynthesis.cancel();
  submitButton.disabled = false;
  submitButton.classList.remove('busy');
  setStatus('');

  applyDirection();
  setLevel(recall(keyFor('niva')) ?? 'start');
  renderBank(loadBank());
  streak = 0;
  renderStreak();
  // Left behind by the short-lived XP bar.
  try {
    localStorage.removeItem(keyFor('xp'));
  } catch {
    // Storage is optional.
  }

  history = loadHistory();
  if (history.length) {
    showAt(history.length - 1);
  } else {
    cursor = -1;
    current = { chunks: [] };
    updateSteps();
    form.requestSubmit();
  }
}

flipButton.addEventListener('click', () => setDirection(learning === 'tr' ? 'nb' : 'tr'));

/* Theme ------------------------------------------------------------
   The page follows the system until the switch is used; from then on
   the choice is kept, for this page and the front page alike. */

const THEME_KEY = 'potets.tema';
const themeButton = document.querySelector('#theme');
const themeIcon = document.querySelector('#theme-icon');
const themeLabel = document.querySelector('#theme-label');
const systemDark = matchMedia('(prefers-color-scheme: dark)');

function currentTheme() {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === 'dark' || chosen === 'light') return chosen;
  return systemDark.matches ? 'dark' : 'light';
}

/** The entry names the theme it switches to: a moon by day, a sun by night. */
function renderTheme() {
  const dark = currentTheme() === 'dark';
  themeIcon.textContent = dark ? '☀' : '☾';
  themeLabel.textContent = dark ? D.themeLight : D.themeDark;
}

themeButton.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  remember(THEME_KEY, next);
  renderTheme();
  closeMenu();
});
systemDark.addEventListener('change', renderTheme);

/* Mute ---------------------------------------------------------------
   With the sound off nothing is read out, neither by itself nor on a
   click, and the speaker balls fade to say so. Kept across visits. */

const MUTE_KEY = 'potets.stille';
const muteButton = document.querySelector('#mute');
const muteIcon = document.querySelector('#mute-icon');
const muteLabel = document.querySelector('#mute-label');
let muted = recall(MUTE_KEY) === 'true';

/** The entry names what it does next: silence while sound is on, and back. */
function renderMute() {
  muteIcon.textContent = muted ? '🔊' : '🔇';
  muteLabel.textContent = muted ? D.soundOn : D.soundOff;
  muteButton.setAttribute('aria-pressed', String(muted));
  document.body.classList.toggle('muted', muted);
}

muteButton.addEventListener('click', () => {
  muted = !muted;
  remember(MUTE_KEY, String(muted));
  if (muted) {
    player.pause();
    if (canSpeakLocally) speechSynthesis.cancel();
  }
  renderMute();
  closeMenu();
});

/* Login and sync ------------------------------------------------------
   Logged in, the chest, the history, the hinted words and the level for
   both directions are kept on the server as well. On arrival the two
   are merged, so nothing is lost whichever device was used last; after
   that every change is pushed a moment later. */

const SYNC_NAMES = ['ordbank', 'historikk', 'slit', 'niva', 'emne'];
/** The names kept as plain strings rather than JSON. */
const PLAIN_NAMES = ['niva', 'emne'];
let syncTimer = 0;

function directionKey(direction, name) {
  return direction === 'tr' ? `potets.tyrkisk.${name}` : `potets.norsk.${name}`;
}

/** One direction's storage as a plain object, ready to send. */
function snapshot(direction) {
  const blob = {};
  for (const name of SYNC_NAMES) {
    const raw = recall(directionKey(direction, name));
    if (raw === null) continue;
    if (PLAIN_NAMES.includes(name)) {
      blob[name] = raw;
      continue;
    }
    try {
      blob[name] = JSON.parse(raw);
    } catch {
      // Unreadable locally; the server's copy stands.
    }
  }
  return blob;
}

/** Two lists joined on the folded target: local order first, then the rest. */
function unionByTarget(local, remote, merge) {
  const result = local.map((entry) => ({ ...entry }));
  for (const entry of remote) {
    const at = result.findIndex((have) => fold(have.target) === fold(entry.target));
    if (at < 0) result.push(entry);
    else if (merge) result[at] = merge(result[at], entry);
  }
  return result;
}

/** Folds the server's copy of a direction into local storage. */
function applyRemote(direction, blob) {
  if (!blob || typeof blob !== 'object') return;
  const key = (name) => directionKey(direction, name);
  const local = snapshot(direction);

  if (Array.isArray(blob.ordbank)) {
    const merged = unionByTarget(local.ordbank ?? [], blob.ordbank.filter((w) => w?.target), (a, b) => ({
      ...b,
      ...a,
      count: Math.max(a.count ?? 1, b.count ?? 1),
      pieces: Math.max(a.pieces ?? 0, b.pieces ?? 0),
      at: Math.max(a.at ?? 0, b.at ?? 0),
    }));
    localStorage.setItem(key('ordbank'), JSON.stringify(merged));
  }
  if (Array.isArray(blob.historikk)) {
    // The server's sentences go before the local ones, so the one on
    // screen stays the newest and the cursor still points at it.
    const remote = blob.historikk.filter((e) => e?.target && Array.isArray(e.chunks));
    const mine = local.historikk ?? [];
    const older = remote.filter((e) => !mine.some((have) => have.target === e.target));
    const merged = [...older, ...mine].slice(-HISTORY_LIMIT);
    localStorage.setItem(key('historikk'), JSON.stringify(merged));
  }
  if (Array.isArray(blob.slit)) {
    const merged = unionByTarget(local.slit ?? [], blob.slit.filter((w) => w?.target)).slice(-STRUGGLED_LIMIT);
    localStorage.setItem(key('slit'), JSON.stringify(merged));
  }
  if (typeof blob.niva === 'string' && !local.niva) localStorage.setItem(key('niva'), blob.niva);
  if (typeof blob.emne === 'string' && local.emne === undefined) localStorage.setItem(key('emne'), blob.emne);
}

/** Re-reads storage for the side on screen after a merge, gently. */
function refreshFromStorage() {
  renderBank(loadBank());
  const topic = recall(keyFor('emne'));
  if (topic !== null && topic !== topicField.value.trim()) topicField.value = topic;
  const merged = loadHistory();
  if (merged.at(-1)?.target !== history.at(-1)?.target && merged.length) {
    history = merged;
    showAt(history.length - 1);
  } else {
    history = merged;
    updateSteps();
  }
}

async function pushState() {
  if (!account) return;
  try {
    await fetch('/api/me/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tr: snapshot('tr'), nb: snapshot('nb') }),
    });
  } catch {
    // Offline: the next change tries again.
  }
}

function scheduleSync() {
  if (!account) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pushState, 1500);
}

async function pullState() {
  try {
    const response = await fetch('/api/me/state');
    if (!response.ok) return;
    const state = await response.json();
    for (const direction of ['tr', 'nb']) applyRemote(direction, state[direction]);
    refreshFromStorage();
    await pushState();
  } catch {
    // The local copy is still there; sync waits for the next change.
  }
}

function showAccount(user) {
  account = user;
  loginButton.hidden = Boolean(user);
  accountButton.hidden = !user;
  avatar.src = user?.picture ?? '';
  menuButton.classList.toggle('signed-in', Boolean(user?.picture));
  renderAccount();
}

/** The logout entry names who is signed in. */
function renderAccount() {
  accountLabel.replaceChildren(D.logout);
  if (account?.name) {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = account.name;
    accountLabel.append(who);
  }
}

loginButton.addEventListener('click', () => {
  location.href = '/auth/google';
});

accountButton.addEventListener('click', async () => {
  closeMenu();
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  showAccount(null);
});

/* The menu opens on its button and closes on a choice, a click
   elsewhere, or Escape. */
function openMenu(open) {
  menuPanel.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
}
function closeMenu() {
  openMenu(false);
}
menuButton.addEventListener('click', () => openMenu(menuPanel.hidden));
document.addEventListener('click', (event) => {
  if (!menuPanel.hidden && !event.target.closest('.menu-wrap')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !menuPanel.hidden) {
    closeMenu();
    menuButton.focus();
  }
});

fetch('/api/me')
  .then((response) => (response.ok ? response.json() : null))
  .then((body) => {
    if (!body?.login) return;
    loginButton.hidden = Boolean(body.user);
    if (body.user) {
      showAccount(body.user);
      return pullState();
    }
    return undefined;
  })
  .catch(() => {});

// Come back to the side and sentence that were last on screen. A first
// visit has nothing to come back to, so it fetches one rather than sit
// empty.
setDirection(learning);

// Google sends the browser back here with a note when a login failed.
// (window.history: the page's own `history` is the sentence list.)
if (new URLSearchParams(location.search).get('login') === 'failed') {
  setStatus(D.loginFailed, true, { sticky: true });
  window.history.replaceState(null, '', location.pathname);
}
