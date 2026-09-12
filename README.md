# Languageballs

A learn-a-language web app, live at [languageballs.com](https://languageballs.com),
built on Claude. Its front page teaches Turkish to Norwegian speakers (or the
other way round) one sentence at a time, and a second page translates whatever
you type into the languages you name.

The site grew out of a Discord bot that translated channel messages. The bot
now lives in its own repository,
[potets-bot](https://github.com/andreas-modahl/potets-bot); the two share the
translation prompt but no code.

## Running it

```powershell
npm install
copy .env.example .env   # then fill in ANTHROPIC_API_KEY
npm run web
```

That serves the learn page at <http://localhost:3000> and, at
<http://localhost:3000/translate>, a page where you type a sentence and get it
back in the languages you name. `npm run build` then `npm run web:start` runs
the compiled version.

`npm test` covers the parts that can be checked without an API key: language
name handling, the checks that decide whether a breakdown is trustworthy enough
to show, the lesson pool, the picture lookup, and the session and user stores.

## Subtitles from Turkish speech

Open `/subtitles`, upload an audio or video clip (up to 100 MB and 10 minutes),
then review the timed Norwegian text and download SRT or WebVTT. The Norwegian
meaning chunks stay in Turkish order, like the learning page. This deliberately
produces a learning gloss rather than natural Norwegian sentence order.

The page uses `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` for
[Azure fast transcription](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create),
and the existing Claude lesson breakdown for translation. The Azure resource
must support fast transcription in its region. FFmpeg is installed with npm to
extract audio from video; `FFMPEG_PATH` can override its location. The Docker
image uses Alpine's FFmpeg package. Formats accepted: MP4/M4A/MOV, WebM/MKV,
AVI, MP3, WAV, FLAC, OGG and AAC, provided they contain a decodable audio track.

Jobs run in the background, one at a time, while the page displays progress.
The server validates word timestamps and checks the meaning chunks against the
transcribed words before constructing cues. A bad breakdown stops generation;
it never silently substitutes natural Norwegian or omits a phrase. Subtitle
text and start/end times can be edited before downloading. Long meaning chunks
and very short cues are flagged for manual review. Transcription errors still
need human correction; overlapping speech is not supported in this first version.

Media is temporarily written to the system temp directory and removed after
completion, failure or cancellation. Audio is sent to Azure; the transcript is
sent to Anthropic. Results are held only in server memory for up to one hour
(at most ten jobs), and the page deletes its server job after receiving the
result. Restarting the server loses in-progress jobs. Downloads and the local
media preview stay in the browser; no uploaded media is added to the lesson pool.

## The translator page

Translations can carry an explanation. `EXPLAIN_TRANSLATIONS` sets the mode:

- **`full`** lays each chunk of the translation above the original wording it
  came from. The pairing is by meaning, not by word: Turkish `geçiriyor musun`
  is Norwegian `har du`, and neither splits further without the pairing
  becoming wrong, so chunks are whatever size makes the correspondence true.
- **`beginner`** picks out at most three common words worth learning first,
  highlights them in the translation, and explains only those. It prefers
  single concrete nouns, verbs and adjectives and avoids grammatical
  constructions, since a beginner cannot reuse a verb ending as vocabulary.
- **`off`** is just the translation.

There is no history: the page shows the translation you just asked for, and
nothing is stored on the server.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEB_TARGETS` | `English, Norwegian` | Languages the form starts with; changeable per request. |
| `MAX_INPUT_CHARS` | `2000` | Longer sentences are refused rather than translated. |

## Lær tyrkisk

The front page (also reachable as `/learn`) has one specific job: learning Turkish as a Norwegian
speaker, or, switched with the ⇄ button at the top, learning English as a
Norwegian speaker, or Norwegian as a Turkish speaker. Everything on the page is
written in the language the learner already knows, and each direction keeps its
own history, level and word chest. The rest of this section describes the
Turkish-learning side; the other sides are the mirror image, with the English
or Norwegian read aloud by a voice of its own.

Every noun that lands in the chest gets a small picture. The lesson names an
emoji for the noun when one shows it plainly, and the server draws that from
Microsoft's [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT),
bundled with the code. Nouns without an emoji are looked up by the word itself
in [ARASAAC](https://arasaac.org)'s pictograms, fetched once and kept on disk
beside the speech clips. ARASAAC's symbols are by Sergio Palao for the
Government of Aragón, under CC BY-NC-SA, and the page credits them in its
footer. Recraft can draw what neither covers, but is off unless
`RECRAFT_ENABLED=true`; see `.env.example`.

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
- **The chest** keeps every word typed without a hint. It lives in the
  browser's local storage and is per-browser. Each request sends a few of the
  least practised chest words along, and the next sentence brings one or two
  of them back; typing one unaided again raises its tally, and every two
  tallies lift the badge a rarity tier. Longer words start a tier higher.
  Words that needed a hint are remembered too and come back first, until one
  is typed unaided and earned. Every 25 words fill a chest and put a star on
  the lid.
- **Logg inn** (shown when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are
  set) signs in with Google. The chest, history and hinted words are then
  kept on the server too, merged with whatever the browser already had, and
  follow the learner to the next device. Login is a plain OAuth redirect:
  no Google script runs on the page, and the session is a signed cookie.

Ask for a sentence at a level (start, nybegynner, viderekommen, avansert) and optionally
on a topic, or write your own sentence over the line above the card and press
Enter — in either language, either way.
The chips in the topic box are the one thing that decides the next sentence.
The + opens a field; a topic typed there becomes a chip. The page adds up to three chest
words to bring back, picked afresh for each sentence, dashed when the word
needed a hint last time, with a small chest on the ones earned outright. Any
chip goes with its ×, and a word sent away is not picked again until it has
been practised.

Generated lessons are pooled in an SQLite file (`LESSON_DB`). A request for a
direction, level and topic that already has lessons on its shelf is answered
from disk, skipping the sentences that learner has already had, and the shelf
is topped up in the background until it holds a dozen, a few sentences per
call so the model spreads them out itself. Sentences the learner pastes in are
never pooled.

The breakdown is checked before it is shown: the pieces must walk the sentence
start to end without skipping or repeating a word, and a morpheme split must
really spell the word it claims to. A breakdown that fails is thrown away rather
than displayed, because a column pairing the wrong two things teaches something
false. When that happens the page says so and the sentence is shown whole.

## Deploying

The page needs the server, because the server holds the keys, so it cannot be
hosted as static files on GitHub Pages. Two ready-made routes:

- **Render.** `render.yaml` is a blueprint for a Starter web service with a
  1 GB disk at `/var/data`. In the Render dashboard choose *New → Blueprint*,
  point it at this repository, and paste in `ANTHROPIC_API_KEY` and
  `AZURE_SPEECH_KEY` when prompted. Change `AZURE_SPEECH_REGION` in the file if
  your Speech resource is elsewhere. The disk holds the lesson pool and the
  generated speech, so both survive deploys; on the free plan (no disk) they
  are rebuilt after each one, and the service sleeps when idle.
- **Any container host** (Fly.io, Railway, a VPS). `Dockerfile` builds an image
  that runs `node dist/server.js` on port 3000. Pass the same variables as
  environment variables. Generated speech is cached under `data/speech/`, so
  mount a volume there if you want it to survive restarts.

Set `NODE_ENV=production` in either case; it turns off the development live
reload.

### Custom domain

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
| `ANTHROPIC_API_KEY` | — | Required. From the Anthropic console. |
| `CLAUDE_MODEL` | `claude-sonnet-5` | `claude-haiku-4-5-20251001` is about a third of the price and passes the lesson checks. |
| `EXPLAIN_TRANSLATIONS` | `full` | `full`, `beginner` or `off`, on the translator page. |
| `WEB_PORT` | `3000` | Port the site is served on. |
| `CANONICAL_HOST` | *(empty)* | Redirect every other host name here. |
| `LESSON_DB` | `data/lessons.db` | The lesson pool and logged-in learners. `off` disables both. |

Speech, pictures and Google sign-in have their own variables; `.env.example`
explains each.

A `full` explanation roughly doubles the output tokens per translation, so
moving `EXPLAIN_TRANSLATIONS` to `beginner` or `off` is the biggest saving
after the model choice.

## Layout

| File | Responsibility |
| --- | --- |
| `src/server.ts` | The HTTP server and JSON API |
| `public/index.html` | The translator page |
| `public/learn.html` | The lesson page's markup |
| `public/learn.css` | The lesson page's own styles |
| `public/learn.js` | The lesson page: the comparator, the chest, speech, sync |
| `public/learn/strings.js` | Everything the lesson page says, in Norwegian and in Turkish |
| `public/learn/fold.js` | Loose spelling: which typed words count as the same |
| `public/learn/rarity.js` | The rarity tiers of a chest badge |
| `public/learn/builder-art.js` | The word builder's drawings: rocket, train, caterpillar |
| `public/app.css` | Colour tokens and chrome shared by both pages |
| `src/claude.ts` | The Anthropic client |
| `src/translate.ts` | The translation call, prompt, and structured output |
| `src/lesson.ts` | The lesson call: Turkish sentence, breakdown, morphemes |
| `src/align.ts` | Checking that a breakdown really fits its sentence |
| `src/pool.ts` | The lesson pool: generated lessons kept in SQLite and shared |
| `src/speech.ts` | Sentences read aloud by Azure, cached as MP3 |
| `src/pictures.ts` | A picture per noun: Fluent Emoji, then ARASAAC pictograms, cached on disk |
| `src/forms.ts` | The forms of a chest word, as a table, asked of the model once |
| `src/google.ts` | Sign in with Google: the redirect and the code exchange |
| `src/session.ts` | Signed session cookies |
| `src/users.ts` | Logged-in learners and their synced chests |
| `src/languages.ts` | Language name normalisation and flag labels |
| `src/limiter.ts` | Concurrency cap |
