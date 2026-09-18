import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = readFileSync('public/learn.js', 'utf8');
const vocabulary = source.slice(source.indexOf('function shuffled('), source.indexOf('function startLevelGame('));
const earn = source.slice(source.indexOf('function bankEarned('), source.indexOf('/* Fireworks'));

test('level rewards rotate through all four games', () => {
  const modes = runInNewContext(`${vocabulary}\n[1, 2, 3, 4, 5].map(levelGameMode)`);
  assert.deepEqual(Array.from(modes), ['match', 'quiz', 'build', 'memory', 'match']);
});

const extraGames = source.slice(source.indexOf('function renderLetterGame('), source.indexOf("gameNext.addEventListener('click'"));
const gameHarness = `
  class Element {
    children = []; textContent = ''; disabled = false; hidden = true;
    attributes = {}; handlers = {}; classList = { add() {} };
    append(...children) { this.children.push(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    focus() {}
    click() { if (!this.disabled) this.handlers.click(); }
    querySelector() { return this.children.find(child => !child.disabled); }
  }
  const document = { createElement: () => new Element() };
  const gameBoard = new Element(), gameFeedback = new Element(), gameNext = new Element();
  const D = { gameTryAgain: 'retry', gameCorrect: 'correct', gameCard: n => 'Card ' + n, gameTurnBack: 'turn back' };
  const game = { words, solved: 0, mistakes: 0 };
  const shuffled = items => [...items];
  function finishGameAnswer() { game.solved++; }
`;

test('letter building handles duplicate letters and punctuation, rejects mistakes, and finishes once', () => {
  const result = runInNewContext(`${gameHarness}\n${extraGames}
    renderLetterGame();
    const [clue, answer, tiles] = gameBoard.children;
    tiles.children[3].click();
    const mistakes = game.mistakes;
    for (const tile of tiles.children) { tile.click(); tile.click(); }
    [answer.textContent, game.solved, mistakes];
  `, { words: [{ target: 's\u00f8t-s\u00f8t', native: 'sweet' }] });
  // The fourth tile is another 's', so it can supply the first letter.
  // A wrong next tile does not advance the answer.
  assert.equal(result[1], 0);
  const complete = runInNewContext(`${gameHarness}\n${extraGames}
    renderLetterGame();
    const tiles = gameBoard.children[2].children;
    tiles[1].click();
    for (const tile of tiles) { tile.click(); tile.click(); }
    [gameBoard.children[1].textContent, game.solved, game.mistakes];
  `, { words: [{ target: 's\u00f8t-s\u00f8t', native: 'sweet' }] });
  assert.deepEqual(Array.from(complete), ['s\u00f8t-s\u00f8t', 1, 1]);
});

test('memory keeps unmatched cards visible until reset and counts matched pairs only once', () => {
  const result = runInNewContext(`${gameHarness}\n${extraGames}
    renderMemoryGame();
    const cards = gameBoard.children;
    cards[0].click(); cards[0].click();
    cards[2].click();
    const revealed = [cards[0].textContent, cards[2].textContent];
    cards[1].click();
    const blocked = cards[1].textContent;
    game.memoryReset(); game.memoryReset = null;
    const hidden = cards[0].attributes['aria-label'];
    cards[0].click(); cards[1].click(); cards[1].click();
    cards[2].click(); cards[3].click();
    [revealed, blocked, hidden, game.solved, game.mistakes];
  `, { words: [{ target: 'one', native: 'en' }, { target: 'two', native: 'to' }] });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [['one', 'two'], '?', 'Card 1', 2, 1]);
});

test('mini-games use at most four unambiguous, nonempty word pairs without modifying the bank', () => {
  const words = [
    { target: 'one', native: 'en' }, { target: 'ONE', native: 'ett' },
    { target: 'two', native: 'to' }, { target: 'second', native: 'TO' },
    { target: '', native: 'empty' }, { target: 'empty', native: ' ' },
    ...Array.from({ length: 10 }, (_, n) => ({ target: `word${n}`, native: `ord${n}` })),
  ];
  const original = JSON.stringify(words);
  const result = runInNewContext(`${vocabulary}\ngameVocabulary(words)`, {
    words, fold: (value: string) => value.toLowerCase(),
  });
  assert.equal(result.length, 4);
  assert.equal(new Set(result.map((w: { target: string }) => w.target.toLowerCase())).size, 4);
  assert.equal(new Set(result.map((w: { native: string }) => w.native.toLowerCase())).size, 4);
  assert.ok(result.every((w: { target: string; native: string }) => w.target.trim() && w.native.trim()));
  assert.equal(JSON.stringify(words), original);
});

function milestoneContext(count: number, reached = 0) {
  const context = {
    words: Array.from({ length: count }, (_, n) => ({ target: `word${n}`, native: `ord${n}`, count: 1 })),
    gameMilestone: reached, learning: 'tr', XP_STEP: 25, upgraded: '',
    games: [] as number[], queued: [] as (() => void)[], saved: [] as string[],
    fold: (value: string) => value.toLowerCase(), overcame() {}, rarityTier: () => 0,
    pictureWord: () => '', pictureEmoji: () => '', fireworks() {},
    keyFor: (key: string) => `tr.${key}`,
  };
  runInNewContext(`
    function loadBank() { return words; }
    function saveBank(value) { words = value; }
    function remember(key, value) { saved.push(value); }
    function queueMicrotask(callback) { queued.push(callback); }
    function startLevelGame(level) { games.push(level); }
    ${earn}
    bankEarned({ target: 'new', native: 'ny' });
  `, context);
  return context;
}

test('crossing 25 XP saves the word and queues one game after the input handler', () => {
  const state = milestoneContext(24);
  assert.equal(state.words.length, 25);
  assert.deepEqual(state.games, []);
  assert.equal(state.queued.length, 1);
  state.queued[0]!();
  assert.deepEqual(state.games, [1]);
  assert.deepEqual(state.saved, ['1']);
  runInNewContext("bankEarned({ target: 'new', native: 'ny' })", state);
  assert.equal(state.words.at(-1)!.count, 2);
  assert.equal(state.queued.length, 1);
});

test('ordinary words and regained milestones do not trigger games; later milestones do', () => {
  assert.equal(milestoneContext(23).queued.length, 0);
  assert.equal(milestoneContext(24, 1).queued.length, 0);
  const state = milestoneContext(49, 1);
  state.queued[0]!();
  assert.deepEqual(state.games, [2]);
});

test('a direction change before the queued game starts cancels that game', () => {
  const state = milestoneContext(24);
  state.learning = 'en';
  state.queued[0]!();
  assert.deepEqual(state.games, []);
});
