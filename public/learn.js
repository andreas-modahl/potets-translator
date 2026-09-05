const form = document.querySelector('#form');
const levelButton = document.querySelector('#level');
const levelName = document.querySelector('#level-name');
const bankEmpty = document.querySelector('#bank-empty');
const topicField = document.querySelector('#topic');
const classesButton = document.querySelector('#classes');
const classesName = document.querySelector('#classes-name');
const submitButton = document.querySelector('#submit');
const stepLabel = document.querySelector('#step-label');
const log = document.querySelector('#log');
const logTitle = document.querySelector('#log-title');
const logList = document.querySelector('#log-list');
const logMore = document.querySelector('#log-more');
const statusLine = document.querySelector('#status');
const lessonCard = document.querySelector('#lesson');
const comparator = document.querySelector('#comparator');
const hintButton = document.querySelector('#hint');
const specialKeys = document.querySelector('#special-keys');
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
const groupSelect = document.querySelector('#group');
const chestToggle = document.querySelector('#chest-toggle');
const chestWrap = document.querySelector('.chest-wrap');
/** Which chest is listed; -1 means the one being filled. */
let viewGroup = -1;
/** Closed: the newest few words. Open: a whole chest, with the picker. */
let chestOpen = false;
const PEEK = 5;

/** Rarity by pieces: a bare word is common, a word of four or more
    pieces is legendary. Old entries without a count are common. */
/** A badge's rarity is earned: a longer word starts higher, and every
    two more times it is typed unaided lifts it a tier. */
const RARITIES = ['vanlig', 'sjelden', 'episk', 'legendarisk'];

function rarityTier(word) {
  const pieces = word.pieces ?? 0;
  const count = word.count ?? 1;
  return Math.min(RARITIES.length - 1, Math.floor(pieces / 2) + Math.floor((count - 1) / 2));
}

function rarityOf(word) {
  return RARITIES[rarityTier(word)];
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

chestToggle.addEventListener('click', () => {
  chestOpen = !chestOpen;
  renderBank(loadBank());
});
/** Words per chest. */
const CHEST_SIZE = 25;
/** The word whose badge just rose a tier, folded; its badge gets a flourish once. */
let upgraded = '';
/** Whether a word in the sentence on screen filled a chest. */
let chestFilled = false;
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
   the learner already knows, and the blanks are in the other one. */

const DIRECTIONS = {
  tr: {
    target: 'tr',
    native: 'nb',
    targetLocale: 'tr-TR',
    flagFrom: 'flag-no',
    flagTo: 'flag-tr',
    label: 'Jeg lærer tyrkisk',
    title: 'Languageballs — lær tyrkisk',
    levels: [
      ['start', 'Første steg'],
      ['nybegynner', 'Nybegynner'],
      ['viderekommen', 'Viderekommen'],
      ['avansert', 'Avansert'],
    ],
    levelLabel: 'Nivå',
    switchLevel: 'Bytt nivå',
    wordClasses: 'Ordklasser',
    wordClassesHelp: 'Vis om ordet er substantiv, verb, adjektiv …',
    pos: {
      noun: 'substantiv',
      verb: 'verb',
      adjective: 'adjektiv',
      adverb: 'adverb',
      pronoun: 'pronomen',
      adposition: 'postposisjon',
      conjunction: 'konjunksjon',
      numeral: 'tallord',
      determiner: 'determinativ',
      interjection: 'interjeksjon',
      particle: 'partikkel',
    },
    posHelp: {
      noun: 'Substantiv: navn på ting, personer og steder. Hund, park, Ayşe.',
      verb: 'Verb: det som gjøres eller skjer. Løpe, sove, være.',
      adjective: 'Adjektiv: beskriver et substantiv. Stor, glad, ny.',
      adverb: 'Adverb: sier hvordan, når eller hvor noe skjer. Fort, alltid, her.',
      pronoun: 'Pronomen: står i stedet for et substantiv. Jeg, du, den.',
      adposition: 'Postposisjon: står etter ordet det hører til, der norsk har en preposisjon foran. Med, for, etter.',
      conjunction: 'Konjunksjon: binder sammen ord eller setninger. Og, men, fordi.',
      numeral: 'Tallord: et tall eller en rekkefølge. To, fem, første.',
      determiner: 'Determinativ: peker ut eller mengdeangir et substantiv. Denne, hver, noen.',
      interjection: 'Interjeksjon: et utrop. Hei, au, ja.',
      particle: 'Partikkel: et lite ord som endrer tonen eller betydningen. Også, bare, vel.',
    },
    topic: 'Tema',
    topicPlaceholder: 'Tema: på kafé, familie, å reise…',
    flip: 'Bytt retning: lær norsk fra tyrkisk',
    themeDark: 'Mørk modus',
    themeLight: 'Lys modus',
    soundOff: 'Lyd av',
    soundOn: 'Lyd på',
    speak: 'Les opp setningen',
    keyHelp: ['leser ordet du står i', 'hele setningen'],
    hint: 'Hint',
    specials: ['ç', 'ğ', 'ı', 'ö', 'ş', 'ü'],
    typeLetter: (letter) => `Skriv ${letter}`,
    hearWord: 'Hør ordet',
    blankFor: (native) => `Tyrkisk for «${native}»`,
    done: 'Flott! Neste',
    log: 'Tidligere setninger',
    logAll: 'Vis alle',
    logFewer: 'Vis færre',
    logOpen: (target) => `Åpne «${target}» igjen`,
    logDone: 'Fullført',
    logScore: (n, total) => `${n} av ${total} ord uten hint`,
    streak: (n) => `${n} på rad`,
    streakHelp: 'Setninger på rad uten hint',
    fresh: 'Ny setning',
    browse: 'Bla i setninger',
    bank: 'Ordbank',
    chest: 'Kiste',
    chestOpen: 'Åpne kisten og vis alle ordene',
    chestClose: 'Lukk kisten',
    chestFull: 'Kiste full!',
    bankEmpty: 'Ord du skriver riktig uten hint, havner i kisten.',
    fullChests: (n) => (n === 1 ? '1 full kiste' : `${n} fulle kister`),
    login: 'Logg inn',
    logout: 'Logg ut',
    menu: 'Meny',
    loginFailed: 'Innloggingen gikk ikke. Prøv igjen.',
    inBank: 'Ligger i ordbanken',
    tally: 'Ganger skrevet riktig uten hjelp',
    sayWord: (word) => `Les opp ${word}`,
    remove: (word) => `Fjern ${word}`,
    noBreakdown:
      'Setningen kom, men oppdelingen stemte ikke med den, så den er utelatt. Prøv en gang til.',
    failed: 'Noe gikk galt.',
    offline: 'Fikk ikke kontakt med serveren.',
  },
  nb: {
    target: 'nb',
    native: 'tr',
    targetLocale: 'nb-NO',
    flagFrom: 'flag-tr',
    flagTo: 'flag-no',
    label: 'Norveççe öğreniyorum',
    title: 'Languageballs — Norveççe öğren',
    levels: [
      ['start', 'İlk adım'],
      ['nybegynner', 'Başlangıç'],
      ['viderekommen', 'Orta'],
      ['avansert', 'İleri'],
    ],
    levelLabel: 'Seviye',
    switchLevel: 'Seviyeyi değiştir',
    wordClasses: 'Sözcük türleri',
    wordClassesHelp: 'Kelimenin isim, fiil, sıfat … olduğunu göster',
    pos: {
      noun: 'isim',
      verb: 'fiil',
      adjective: 'sıfat',
      adverb: 'zarf',
      pronoun: 'zamir',
      adposition: 'edat',
      conjunction: 'bağlaç',
      numeral: 'sayı',
      determiner: 'belirleyici',
      interjection: 'ünlem',
      particle: 'edat',
    },
    posHelp: {
      noun: 'İsim: varlıkların, kişilerin ve yerlerin adı. Köpek, park, Ola.',
      verb: 'Fiil: yapılan ya da olan şey. Koşmak, uyumak, olmak.',
      adjective: 'Sıfat: bir ismi niteler. Büyük, mutlu, yeni.',
      adverb: 'Zarf: nasıl, ne zaman ya da nerede olduğunu söyler. Hızlı, her zaman, burada.',
      pronoun: 'Zamir: bir ismin yerine geçer. Ben, sen, o.',
      adposition: 'Edat: Norveççede isimden önce gelir, Türkçedeki eklerin ve sonra gelen edatların yerine. Med, for, etter.',
      conjunction: 'Bağlaç: kelimeleri ya da cümleleri birbirine bağlar. Og, men, fordi.',
      numeral: 'Sayı: bir sayı ya da sıra. To, fem, første.',
      determiner: 'Belirleyici: bir ismi işaret eder ya da miktarını söyler. Denne, hver, noen.',
      interjection: 'Ünlem: bir seslenme. Hei, au, ja.',
      particle: 'Edat/ilgeç: tonu ya da anlamı değiştiren küçük bir kelime. Også, bare, vel.',
    },
    topic: 'Konu',
    topicPlaceholder: 'Konu: kafede, aile, seyahat…',
    flip: 'Yönü değiştir: Norveççeden Türkçe öğren',
    themeDark: 'Koyu tema',
    themeLight: 'Açık tema',
    soundOff: 'Sesi kapat',
    soundOn: 'Sesi aç',
    speak: 'Cümleyi seslendir',
    keyHelp: ['bulunduğun kelimeyi okur', 'tüm cümleyi'],
    hint: 'İpucu',
    specials: ['æ', 'ø', 'å'],
    typeLetter: (letter) => `${letter} yaz`,
    hearWord: 'Kelimeyi dinle',
    blankFor: (native) => `«${native}» için Norveççe`,
    done: 'Harika! Sıradaki',
    log: 'Önceki cümleler',
    logAll: 'Tümünü göster',
    logFewer: 'Daha az göster',
    logOpen: (target) => `«${target}» cümlesini yeniden aç`,
    logDone: 'Tamamlandı',
    logScore: (n, total) => `${total} kelimeden ${n} tanesi ipucusuz`,
    streak: (n) => `${n} üst üste`,
    streakHelp: 'İpucu almadan üst üste bitirilen cümleler',
    fresh: 'Yeni cümle',
    browse: 'Cümleler arasında gez',
    bank: 'Kelime sandığı',
    chest: 'Sandık',
    chestOpen: 'Sandığı aç ve tüm kelimeleri göster',
    chestClose: 'Sandığı kapat',
    chestFull: 'Sandık doldu!',
    bankEmpty: 'İpucu almadan doğru yazdığın kelimeler sandığa girer.',
    fullChests: (n) => `${n} dolu sandık`,
    login: 'Giriş yap',
    logout: 'Çıkış yap',
    menu: 'Menü',
    loginFailed: 'Giriş yapılamadı. Tekrar dene.',
    inBank: 'Sandıkta var',
    tally: 'Yardımsız doğru yazma sayısı',
    sayWord: (word) => `${word} kelimesini seslendir`,
    remove: (word) => `${word} kelimesini kaldır`,
    noBreakdown:
      'Cümle geldi ama parçalara ayırma cümleyle uyuşmadı, o yüzden gösterilmedi. Bir daha dene.',
    failed: 'Bir şeyler ters gitti.',
    offline: 'Sunucuya ulaşılamadı.',
  },
};

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
  field.textContent = answer.slice(0, Math.min(answer.length, right + 1));
  checkField(field, chunk);
  // The last letter of the last word leaves the focus on the next
  // button, where checkField put it; otherwise the caret stays here.
  if (!sentenceDone()) placeCaretAtEnd(field);
}

function placeCaretAtEnd(field) {
  field.focus();
  const range = document.createRange();
  range.selectNodeContents(field);
  range.collapse(false);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function select(index) {
  // A new blank in focus has not been heard yet.
  if (index !== selected) heardInFocus = false;
  selected = index;
  for (const [at, box] of [...comparator.children].entries()) {
    box.classList.toggle('open', at === index);
  }
  renderDetail(current.chunks[index]);
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
  let field = active?.classList?.contains('tr') && comparator.contains(active) ? active : null;
  if (!field && selected >= 0 && !isSolved(selected)) field = comparator.children[selected]?.querySelector('.tr');
  if (!field) field = [...comparator.children].find((box) => !box.classList.contains('correct'))?.querySelector('.tr');
  if (!field) return;
  if (document.activeElement !== field) placeCaretAtEnd(field);
  // insertText goes through the same path as a keystroke, so the
  // field's input handler checks the word and moves on when it fits.
  if (!document.execCommand?.('insertText', false, letter)) {
    field.textContent += letter;
    placeCaretAtEnd(field);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** After help, the caret goes to the first blank still to be done. */
function focusNextOpen() {
  const box = [...comparator.children].find((candidate) => !candidate.classList.contains('correct'));
  const field = box?.querySelector('.tr');
  if (field) placeCaretAtEnd(field);
}

/** Letters folded to their plain Latin base, in either language, so ş
    and s, ı and i, ğ and g, ö and o, ü and u, ç and c, æ and a, ø and
    o, å and a all count the same. Both the typed word and the answer go
    through this: the point is the word and its order, not the keyboard. */
function fold(text) {
  return text
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/æ/g, 'a')
    .replace(/ø/g, 'o')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // The way å, ø and æ are typed on a keyboard without them. Applied to
    // the answer too, so a word that really has "oe" (poeng) still matches.
    .replace(/aa/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ae/g, 'a')
    .replace(/[’'`´]/g, '')
    // Punctuation the model left glued to a word is not part of the
    // spelling, and the full stop is the hint key besides.
    .replace(/[.,;:!?…]/g, '')
    .replace(/\s+/g, ' ');
}

function sameWord(typed, answer) {
  return fold(typed) === fold(answer);
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
  field.textContent = fixed;
  placeCaretAtEnd(field);
}

function checkField(field, chunk) {
  const typed = field.textContent;
  const box = field.parentElement;
  const wasSolved = box.classList.contains('correct');
  box.classList.toggle('correct', sameWord(typed, chunk.target));
  box.classList.toggle('filled', typed.trim().length > 0);
  box.classList.toggle('ontrack', fold(chunk.target).startsWith(fold(typed)));
  const solvedNow = box.classList.contains('correct');
  if (solvedNow === wasSolved) return;

  // A near-miss on the letters still counts, but the word left on screen
  // is the real spelling: ş where s was typed, ø where o was.
  if (solvedNow && typed.trim() !== chunk.target) field.textContent = chunk.target;
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
  if (solvedNow && !box.classList.contains('helped')) {
    viewGroup = -1;
    bankEarned(chunk);
  }
  // Getting it right unmasks the word in the panel underneath.
  if (current.chunks[selected] === chunk) renderDetail(chunk);
  // The last word in opens up the whole sentence and hands the focus to
  // the next button, so Enter carries on.
  if (sentenceDone()) {
    renderExplanations();
    setReady(true, chestFilled);
    countSentence();
    markDone();
    submitButton.focus();
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

/* Word classes ------------------------------------------------------
   On by default: every blank says what kind of word it wants, in the
   caption row above it, before the painted pieces. Off stays off. */

const CLASSES_KEY = 'potets.ordklasser';
let showClasses = recall(CLASSES_KEY) !== 'off';

function renderClassesToggle() {
  classesButton.setAttribute('aria-checked', String(showClasses));
}

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

/** Paints a solved word piece by piece and writes each piece's meaning
    in the same tint above the blank. */
function paintWord(box, field, chunk) {
  const parts = piecesOf(chunk);
  if (!parts) {
    renderCaption(box, chunk, []);
    return;
  }
  // Each piece takes its letters from the word as it is spelled there,
  // so a softened consonant is painted, not the dictionary form; any
  // punctuation on the end stays plain.
  let at = 0;
  const painted = parts.map((part, index) => {
    const span = document.createElement('span');
    span.className = 'm';
    span.dataset.m = String(index % 4);
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
  field.replaceChildren(...painted, chunk.target.slice(at));
  renderCaption(
    box,
    chunk,
    parts.map((part, index) => {
      const tag = document.createElement('span');
      tag.className = 'm';
      tag.dataset.m = String(index % 4);
      tag.lang = D.native;
      tag.textContent = part.means;
      return tag;
    }),
  );
}

function setReady(ready, filledChest = false) {
  submitButton.classList.toggle('ready', ready);
  stepLabel.textContent = ready ? (filledChest ? D.chestFull : D.done) : D.fresh;
  // Nothing left to hint at once every word is in place.
  hintButton.parentElement.hidden = ready;
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
  field.contentEditable = 'plaintext-only';
  field.spellcheck = false;
  field.setAttribute('role', 'textbox');
  field.setAttribute('aria-label', D.blankFor(chunk.native));
  // Sized to the answer so the row does not shift as it is filled in.
  field.style.minWidth = blankWidth(chunk.target);

  // The last right letter moves the caret on, so a sentence can be typed
  // straight through without reaching for Enter.
  field.addEventListener('input', (event) => {
    if (!event.isComposing) straighten(field, chunk.target);
    checkField(field, chunk);
    if (isSolved(index)) focusNextOpen();
  });
  // Enter and Tab both step to the next blank, skipping the buttons in
  // between; Shift+Tab steps back. Past the last blank they land on
  // the next-sentence button, not on whatever button comes first.
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'Tab') return;
    const step = event.key === 'Tab' && event.shiftKey ? -1 : 1;
    const next = comparator.children[index + step]?.querySelector('.tr');
    if (!next && step < 0) return;
    event.preventDefault();
    if (next) placeCaretAtEnd(next);
    else submitButton.focus();
  });
  field.addEventListener('focus', () => select(index));

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

  box.append(parts, field, under);
  renderCaption(box, chunk, []);

  // The whole box is the target: a click on its padding, the caption or
  // the translation puts the caret in the blank. The buttons keep their
  // own jobs, and a click in the blank itself places the caret as usual.
  box.addEventListener('mousedown', (event) => {
    if (event.target.closest('button, .tr')) return;
    event.preventDefault();
    placeCaretAtEnd(field);
  });
  return box;
}

function morphemeNode({ form, means }, solved, index = 0) {
  const piece = document.createElement('span');
  piece.className = 'morpheme';
  // The same tint as the piece wears in the blank.
  if (solved) piece.dataset.m = String(index % 4);

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
   A noun earns a small cartoon, drawn by the server on first sight. Only a
   solved word shows it: for an open blank it would give the answer away. */

/** The fingerprint of the drawing settings, or '' while the server has none. */
let pictureVersion = '';

/** The word a noun is drawn as: its root, so "köpeğim" and "köpekler" share one dog. */
function pictureWord(chunk) {
  if (chunk?.pos !== 'noun') return '';
  const root = chunk.morphemes?.[0]?.form ?? chunk.target;
  return root.replace(/[^\p{L}\p{M}'’-]/gu, '').toLocaleLowerCase(D.target);
}

/** What to draw, in words the picture model knows: the English the lesson
    gives for a noun, or failing that what the root means in the other language. */
function pictureHint(chunk) {
  return (chunk?.english ?? chunk?.morphemes?.[0]?.means ?? chunk?.native ?? '').trim();
}

/** The picture for a word, or nothing while pictures are off; a failed drawing takes itself away. */
function pictureNode(word, hint = '') {
  if (!pictureVersion || !word) return null;
  const image = document.createElement('img');
  image.className = 'pic';
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  const query = new URLSearchParams({ v: pictureVersion, word, ...(hint ? { hint } : {}) });
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
  const picture = solved ? pictureNode(pictureWord(chunk), pictureHint(chunk)) : null;
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
      ...(pictureWord(chunk) ? { pic: pictureWord(chunk), hint: pictureHint(chunk) } : {}),
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
    if (!event.repeat && !hintButton.parentElement.hidden) hintButton.click();
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
      const response = await fetch(
        `/api/speak?lang=${D.target}&v=${speechVersion}&text=${encodeURIComponent(text)}`,
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

speakButton.addEventListener('click', () => speak(current.target));

// A click on the card's empty space puts the caret in the first blank
// still open. The word boxes, the buttons and the links in it keep their
// own behaviour, and a click outside the card moves nothing.
lessonCard.addEventListener('mousedown', (event) => {
  if (event.target.closest('button, [role="button"], a, [contenteditable], .chunk')) return;
  event.preventDefault();
  focusNextOpen();
});

/* Word bank -------------------------------------------------------- */

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

/** The chest picker: one entry per 25 words, the newest chest last. */
function renderGroups(total) {
  const groups = Math.max(1, Math.ceil(total / CHEST_SIZE));
  groupSelect.hidden = groups < 2;
  groupSelect.setAttribute('aria-label', D.chest);
  groupSelect.replaceChildren();
  for (let at = 0; at < groups; at += 1) {
    const option = document.createElement('option');
    option.value = String(at);
    const from = at * CHEST_SIZE + 1;
    const to = Math.min(total, (at + 1) * CHEST_SIZE);
    option.textContent = `${D.chest} ${at + 1} · ${from}–${to}`;
    groupSelect.append(option);
  }
  if (viewGroup < 0 || viewGroup >= groups) viewGroup = groups - 1;
  groupSelect.value = String(viewGroup);
  return viewGroup;
}

groupSelect.addEventListener('change', () => {
  viewGroup = Number(groupSelect.value);
  renderBank(loadBank());
});

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
  let shown;
  if (chestOpen) {
    const group = renderGroups(words.length);
    const start = group * CHEST_SIZE;
    shown = indexed.slice(start, start + CHEST_SIZE);
  } else {
    groupSelect.hidden = true;
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

    const picture = pictureNode(word.pic, word.hint ?? word.native);
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

    // The badge reads its word out; the minus is the one part that does not.
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.title = D.sayWord(word.target);
    item.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      speak(word.target);
    });
    item.addEventListener('keydown', (event) => {
      if (event.target !== item || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      speak(word.target);
    });

    item.append(target, native, tally, remove);
    bankList.append(item);
  }
  // The flourish is shown once.
  upgraded = '';
}

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
  topicField.placeholder = D.topicPlaceholder;
  topicField.setAttribute('aria-label', D.topic);
  // Each side remembers its own topic, an emptied one included. With none
  // saved the field is empty, and the server picks a situation itself.
  topicField.value = recall(keyFor('emne')) ?? '';
  // The shortcuts ride in the tooltip: | for the word in focus, || for the sentence.
  speakButton.title = `${D.speak} · | ${D.keyHelp[0]} · || ${D.keyHelp[1]}`;
  speakButton.setAttribute('aria-label', D.speak);
  hintButton.replaceChildren(`${D.hint} `, Object.assign(kbd('.'), { className: 'key' }));
  renderSpecialKeys();
  document.querySelector('.steps').setAttribute('aria-label', D.browse);
  document.querySelector('#bank .sr-only').textContent = D.bank;
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
