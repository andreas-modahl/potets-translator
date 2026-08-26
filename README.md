# Potets Translator

A Discord bot that translates every message in the channels you point it at,
using Claude. It detects the source language on its own, so there is nothing to
declare per message — you only say which languages a channel should end up in.

A message already written in one of the target languages is left alone, and
messages that are only links, mentions or emoji are skipped entirely.

## How it behaves

Enable it in a channel:

```
/translator enable languages: English, Norwegian
```

From then on, every message posted there is translated. There are three ways it
can post the result, chosen with the `mode` option:

- **`plain`** (default) — an ordinary message in the channel, right after the
  original and attached to nothing. The least visual clutter of any mode: no
  quote block, no thread box. In return there is no explicit link back to the
  message being translated, so in a fast-moving channel you infer the pairing
  from the order.
- **`reply`** — the bot replies to the message. The translation stays visibly
  attached to what it translates, at the cost of Discord repeating the original
  above each reply.
- **`thread`** — the translation goes in a thread hanging off the original
  message, named with the target language's flag. Keeps the channel itself free
  of bot posts, at the cost of a thread box under every translated message.
  Needs Create Public Threads.
- **`webhook`** — the translation is reposted under the original author's name
  and avatar. Reads most like natural conversation, at the cost of the Manage
  Webhooks permission and of translations no longer being obviously bot output.

Anything unavailable falls back to `reply`, which needs no extra permission. No
mode ever pings the original author or re-pings anyone named in the text.

Translations are sent silently, the same way an `@silent` message is: no push or
desktop notification. The message being translated already notified everyone, so
notifying a second time for the same content would just be noise. Channels may
still show as unread, which is Discord's behaviour for silent messages.

Editing an original message rewrites its translation; deleting it deletes the
translation too. That link is kept in memory for the last 1000 translated
messages, so it survives normal use but not a restart.

Other commands: `/translator status` and `/translator disable`. All three
require the Manage Server permission and reply only to you.

## Explanations

With `EXPLAIN_TRANSLATIONS` on, each translation carries a breakdown pairing it
back to the original wording, rendered as Discord subtext so it sits quietly
under the translation:

```
🇹🇷 selam. iyi bir gün geçiriyor musun?
   selam = hei  ·  iyi bir gün = en fin dag  ·  geçiriyor musun = har du
```

The pairing is by meaning, not by word. Languages do not line up one word to one
word — Turkish `geçiriyor musun` is Norwegian `har du`, and neither splits
further without the pairing becoming wrong — so chunks are whatever size makes
the correspondence true. Pairs where both sides are identical are dropped, since
a name or a number translating to itself teaches nothing, and the whole gloss is
skipped for messages too long to break down in twelve pairs.

The bot sorts the pairs by where they appear in the translation rather than
trusting the order they come back in, so the breakdown always reads left to
right alongside the text above it.

Turn it off per channel with `/translator enable … explain: False`.

## Setup

### 1. Create the Discord application

1. Go to <https://discord.com/developers/applications> and create an application.
2. Under **Bot**, click **Reset Token** and copy the token.
3. Still under **Bot**, enable **Message Content Intent**. This is a privileged
   intent and the bot cannot read anything without it.
4. Under **OAuth2 → URL Generator**, tick the `bot` and `applications.commands`
   scopes, then these bot permissions:
   - View Channels
   - Send Messages
   - Create Public Threads *(needed for the default thread mode)*
   - Send Messages in Threads
   - Read Message History
   - Manage Webhooks *(only needed if you switch a channel to webhook mode)*
5. Open the generated URL and invite the bot to your server.

### 2. Configure and run

```powershell
npm install
copy .env.example .env   # then fill in DISCORD_TOKEN and ANTHROPIC_API_KEY
npm run dev
```

Set `DISCORD_GUILD_ID` to your server's ID while developing: guild slash
commands register instantly, whereas global ones can take up to an hour to show
up. Leave it empty in production.

For a long-running deployment:

```powershell
npm run build
npm start
```

`npm test` covers the parts that can be checked without a Discord connection or
an API key: which messages are worth translating, and language-name handling.

## Configuration

Everything lives in `.env`; see `.env.example` for the annotated list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Required. Bot token. |
| `ANTHROPIC_API_KEY` | — | Required. From the Anthropic console. |
| `DISCORD_GUILD_ID` | *(empty)* | Register commands to one guild instead of globally. |
| `CLAUDE_MODEL` | `claude-sonnet-5` | `claude-haiku-4-5-20251001` is cheaper and fine for short chat. |
| `MAX_INPUT_CHARS` | `2000` | Longer messages are skipped rather than translated. |
| `DEFAULT_POST_MODE` | `plain` | `plain`, `reply`, `thread` or `webhook`. |
| `EXPLAIN_TRANSLATIONS` | `true` | Add the breakdown line under each translation. |
| `DATA_FILE` | `data/channels.json` | Where per-channel settings persist. |

Per-channel settings are written to `DATA_FILE` and survive restarts. The file
is gitignored.

## Cost control

Auto-translating a whole channel means one API call per message, so the guards
matter:

- Messages over `MAX_INPUT_CHARS` are skipped, so one pasted wall of text cannot
  run up a bill.
- Messages with no translatable prose never reach the API.
- `/translator enable` caps a channel at five target languages.
- At most five translations run concurrently; the rest queue, which also keeps
  translations in the order the originals were sent.
- Other bots' prefix commands (`!play`, `.rank`) are ignored.

Explanations roughly double the output tokens per message, so turning
`EXPLAIN_TRANSLATIONS` off is the single biggest saving after the model choice.

If cost is the main constraint, set `CLAUDE_MODEL=claude-haiku-4-5-20251001`.

## Layout

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Client setup and event wiring |
| `src/translate.ts` | The Claude call, prompt, and structured output |
| `src/poster.ts` | Posting, editing and deleting translations |
| `src/filter.ts` | Deciding which messages are worth translating |
| `src/commands.ts` | The `/translator` slash command |
| `src/store.ts` | Per-channel settings, persisted as JSON |
| `src/languages.ts` | Language name normalisation and flag labels |
| `src/limiter.ts` | Concurrency cap |

## Notes

The bot ignores messages from bots and from webhooks. That is what stops it
translating its own output in a loop: in reply mode its translations come from a
bot account, and in webhook mode they arrive as webhook posts. Both halves of
that check matter — relax either one and the bot will start translating itself.
