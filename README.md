# Languageballs

A learn-a-language web app (see *Web app* below) and a Discord bot that translates every message in the channels you point it at,
using Claude. It detects the source language on its own, so there is nothing to
declare per message — you only say which languages a channel should end up in.

A message already written in one of the target languages is left alone, and
messages that are only links, mentions or emoji are skipped entirely.

The same translator is also available as a web page you can type into, with no
Discord involved — see [Web app](#web-app).

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

Translations can carry an explanation, for channels where the conversation is
also how people are learning the language. `EXPLAIN_TRANSLATIONS` sets the
default and `/translator enable … explain:` overrides it per channel.

**`full`** stacks the translation above the original in aligned columns, inside
a code block so the columns hold:

```
selam  güzel bir gün  geçiriyor musun
hei    en fin dag     har du
```

Because the breakdown spans the whole sentence, it replaces the translation
rather than being printed alongside it. Each column is padded to the wider of
the two languages, so every piece sits directly above its counterpart.

Only one of the two lines can read straight through, since word order differs
between languages, and it is the translation: it leads and keeps its own order,
while the original follows piece by piece and so may appear out of order.

Discord wraps long lines inside a code block rather than scrolling them, and a
wrapped line would destroy the alignment. Rows are therefore kept under 45
characters and continued as a further stanza underneath. A single pair too wide
to fit gets a row to itself and overflows, since splitting it would break the
pairing it exists to show.

The pairing is by meaning, not by word. Languages do not line up one word to one
word — Turkish `geçiriyor musun` is Norwegian `har du`, and neither splits
further without the pairing becoming wrong — so chunks are whatever size makes
the correspondence true. Pairs where both sides are identical are dropped, since
a name or a number translating to itself teaches nothing, and the whole gloss is
skipped for messages too long to break down in twelve pairs.

**`beginner`** picks out at most three common words worth learning first,
highlights them in the translation, and explains only those:

```
eve gelirken **süt** ve **ekmek** alabilir misin? **teşekkürler**!
süt  (melk)     ekmek  (brød)     teşekkürler  (takk)
```

The cap matters more than it looks: if most of the sentence is marked, nothing
stands out and the mode is pointless. So it is limited to three words and to
about a third of the sentence, prefers single concrete nouns, verbs and
adjectives, and is told to avoid grammatical constructions — a beginner cannot
reuse a verb ending as vocabulary, but they can reuse `süt`.

Highlighting skips anything it would corrupt: mentions, custom emoji,
timestamps, URLs, and inline or fenced code are never marked up, even when a
highlighted word appears inside one.

In both modes the bot sorts the pairs by where they appear in the translation
rather than trusting the order they come back in, so the explanation reads left
to right alongside the text above it.

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
an API key: which messages are worth translating, language-name handling, the
column layout, and the two checks that decide whether a Turkish breakdown is
trustworthy enough to show.

## Web app

`npm run web` serves the learn page at <http://localhost:3000> and, at
<http://localhost:3000/translate>, a page where you type a sentence and get it
back in the languages you name. It reuses the bot's translation code,
so the same explanation modes apply: `full` lays each chunk of the translation
above the original wording it came from, and `beginner` marks a few words worth
learning and lists them underneath.

It needs `ANTHROPIC_API_KEY` and nothing else — no bot token, no Discord
application. `npm run build` then `npm run web:start` runs the compiled version.

There is no history: the page shows the translation you just asked for, and
nothing is stored on the server.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `3000` | Port the page is served on. |
| `WEB_TARGETS` | `English, Norwegian` | Languages the form starts with; changeable per request. |

### Lær tyrkisk

The front page (also reachable as `/learn`) has one specific job: learning Turkish as a Norwegian
speaker, or, flipped with the ⇄ button at the top, learning Norwegian as a
Turkish speaker. Everything on the page is written in the language the learner
already knows, and each direction keeps its own history, level and word chest.
The rest of this section describes the Turkish-learning side; the other side is
the mirror image, with the Norwegian read aloud by a Norwegian voice.

It is built around a sentence comparator — one Turkish sentence laid out word
by word, with the Norwegian each word carries printed underneath it.

    Yarın      arkadaşımla       yeni    açılan          müzeye       gideceğiz.
    i morgen   med vennen min    nylig   som ble åpnet   til museet   skal vi dra

    Norsk   I morgen skal jeg og vennen min dra til det nyåpnede museet.

The Norwegian across the middle reads in Turkish order, so it comes out
scrambled. That is the point: Turkish puts the verb last and glues onto it what
Norwegian spreads over several words. The natural Norwegian sentence underneath
puts it back together.

- Words with a dotted underline carry suffixes. Click one to see it taken apart
  — root plus each suffix, with what each contributes — and a note in Norwegian
  on the grammar it shows.
- **Skjul norsk** hides every Norwegian word, the sentence underneath included,
  and leaves the spacing. Click a word to check yourself one at a time.
- **Ordbank** keeps words you save. It lives in the browser's local storage, so
  it never reaches the server, and it is per-browser.

Ask for a sentence at a level (nybegynner, viderekommen, avansert) and optionally
on a topic, or paste in your own sentence — Norwegian or Turkish, either way.

The breakdown is checked before it is shown: the pieces must walk the sentence
start to end without skipping or repeating a word, and a morpheme split must
really spell the word it claims to. A breakdown that fails is thrown away rather
than displayed, because a column pairing the wrong two things teaches something
false. When that happens the page says so and the sentence is shown whole.

### Deploying the web app

The page needs the server, because the server holds the keys, so it cannot be
hosted as static files on GitHub Pages. Two ready-made routes:

- **Render.** `render.yaml` is a blueprint for a free web service. In the Render
  dashboard choose *New → Blueprint*, point it at this repository, and paste in
  `ANTHROPIC_API_KEY` and `AZURE_SPEECH_KEY` when prompted. Change
  `AZURE_SPEECH_REGION` in the file if your Speech resource is elsewhere. The
  free plan sleeps after idle time, so the first load after a pause takes a
  moment.
- **Any container host** (Fly.io, Railway, a VPS). `Dockerfile` builds an image
  that runs `node dist/server.js` on port 3000. Pass the same variables as
  environment variables. Generated speech is cached under `data/speech/`, so
  mount a volume there if you want it to survive restarts.

Set `NODE_ENV=production` in either case; it turns off the development live
reload.

#### Custom domain

The site lives at **languageballs.com**, registered at Squarespace. `render.yaml`
declares both `languageballs.com` and `www.languageballs.com`, and Render issues
the certificates itself once DNS points at it. In Squarespace (*Domains → DNS
settings → Custom records*) the records are:

| Type  | Host | Value                           |
| ----- | ---- | ------------------------------- |
| A     | @    | `216.24.57.1`                   |
| CNAME | www  | `potets-translator.onrender.com` |

Delete the Squarespace defaults for `@` and `www` first, or the site parks on
their placeholder page. **languageballs.net** gets the same two records and is
also declared in the blueprint; the server redirects every other custom host,
including the `.net` and `www` spellings, to the one in `CANONICAL_HOST`.
Leave that variable unset locally so any host works.

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
| `EXPLAIN_TRANSLATIONS` | `full` | `full`, `beginner` or `off`. |
| `DATA_FILE` | `data/channels.json` | Where per-channel settings persist. |
| `WEB_PORT` | `3000` | Web app only. |
| `WEB_TARGETS` | `English, Norwegian` | Web app only: the form's initial languages. |

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

A `full` explanation roughly doubles the output tokens per message, so moving
`EXPLAIN_TRANSLATIONS` to `beginner` or `off` is the single biggest saving after
the model choice.

If cost is the main constraint, set `CLAUDE_MODEL=claude-haiku-4-5-20251001`.

## Layout

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Discord client setup and event wiring |
| `src/server.ts` | The web app's HTTP server and JSON API |
| `public/index.html` | The translator page |
| `public/learn.html` | The Turkish lesson page and its comparator |
| `public/app.css` | Colour tokens and chrome shared by both pages |
| `src/claude.ts` | The shared Anthropic client |
| `src/translate.ts` | The Claude call, prompt, and structured output |
| `src/lesson.ts` | The lesson call: Turkish sentence, breakdown, morphemes |
| `src/align.ts` | Checking that a breakdown really fits its sentence |
| `src/poster.ts` | Posting, editing and deleting translations |
| `src/filter.ts` | Deciding which messages are worth translating |
| `src/commands.ts` | The `/translator` slash command |
| `src/store.ts` | Per-channel settings, persisted as JSON |
| `src/languages.ts` | Language name normalisation and flag labels |
| `src/highlight.ts` | Marking beginner words without breaking Discord markup |
| `src/interlinear.ts` | Laying the original above the translation in columns |
| `src/limiter.ts` | Concurrency cap |

## Notes

The bot ignores messages from bots and from webhooks. That is what stops it
translating its own output in a loop: in reply mode its translations come from a
bot account, and in webhook mode they arrive as webhook posts. Both halves of
that check matter — relax either one and the bot will start translating itself.
