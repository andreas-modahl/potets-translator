import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Message, MessageType } from 'discord.js';
import { inspect } from './filter.js';
import { labelFor, parseTargets } from './languages.js';

function fake(content: string, extra: Record<string, unknown> = {}): Message {
  return {
    content,
    type: MessageType.Default,
    author: { bot: false },
    webhookId: null,
    ...extra,
  } as unknown as Message;
}

const cases: Array<[name: string, message: Message, translate: boolean]> = [
  ['plain prose', fake('hei, hvordan går det?'), true],
  ['prose alongside a link', fake('se her https://example.com da'), true],
  ['a reply', fake('ja det stemmer', { type: MessageType.Reply }), true],
  ['only a link', fake('https://example.com'), false],
  ['only emoji', fake('😂😂 <:kek:123456789>'), false],
  ['only a mention', fake('<@1234567890>'), false],
  ['whitespace', fake('   '), false],
  ['another bot', fake('hallo', { author: { bot: true } }), false],
  ['a webhook post, including our own', fake('hallo', { webhookId: '99' }), false],
  ["another bot's prefix command", fake('!play never gonna give you up'), false],
  ['a join notice', fake('x', { type: MessageType.UserJoin }), false],
  ['an overlong message', fake('a'.repeat(2500)), false],
];

for (const [name, message, expected] of cases) {
  test(`inspect ${expected ? 'translates' : 'skips'} ${name}`, () => {
    assert.equal(inspect(message, 2000).translate, expected);
  });
}

test('parseTargets normalises, deduplicates and drops blanks', () => {
  assert.deepEqual(parseTargets(' english , NORWEGIAN, english ,  , japanese'), [
    'English',
    'Norwegian',
    'Japanese',
  ]);
});

test('labelFor falls back to the bare name for unknown languages', () => {
  assert.equal(labelFor('English'), '🇬🇧 English');
  assert.equal(labelFor('Brazilian Portuguese'), '🇵🇹 Brazilian Portuguese');
  assert.equal(labelFor('Klingon'), 'Klingon');
});
