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

Open `/subtitles`, enter a YouTube link (up to 2 hours),
then review the timed Norwegian text and download SRT or WebVTT. The Norwegian
meaning chunks stay in Turkish order, like the learning page. This deliberately
produces a learning gloss rather than natural Norwegian sentence order.

The page uses `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` for
[Azure fast transcription](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create),
and the existing Claude lesson breakdown for translation. The Azure resource
must support fast transcription in its region. FFmpeg is installed with npm to
extract audio from video; `FFMPEG_PATH` can override its location. The Docker
image uses Alpine's FFmpeg package. Local media uploads are disabled.

One video runs in the background at a time, with up to three one-minute sections processed concurrently. Each section uses overlapping audio context and owns its word timestamps, so results can finish out of order. Section status and subtitles are saved together in SQLite. The player polls for progress and displays ready sections in green, active sections in yellow, errors in red, and unchecked sections in gray. Completed silence counts as ready and is not repeatedly transcribed. Failed sections get at most three automatic attempts; **Prøv røde deler igjen** resets their retry limit. Partial recordings are marked `(delvis)` until all sections finish. Playback streams directly from YouTube through its embedded player. The server fetches the audio range for each section with overlapping context instead of downloading the full video.

Opening a saved YouTube video automatically checks and resumes unfinished sections. Multiple viewers share the same active job. Older saves without section metadata get a one-time audio scan; existing subtitle text is preserved and uncovered speech is translated. YouTube must allow embedding for playback, and the server must be able to fetch audio for unfinished sections. Translations overlay the embedded player when the video-text setting is enabled; disabling it places them below the video. Word timings come from transcription; highlights follow the iframe playback clock. While generation is active, saving edits to that record is temporarily blocked. The translation timeline stays visible in TV mode, shows the current playback time, and supports clicking to play from a position. Arrow keys seek five seconds; Home and End move to the start and end.

Pending work starts with the section being watched, continues forward, then
fills earlier gaps. Seeking updates this priority for the next available worker;
requests already in flight finish normally. For a shared job, the most recently
reported viewing position determines priority. Failed sections still require
the retry button once their automatic retry budget is exhausted.

Azure Speech requests share a single queue, spaced at least one second apart,
while translation sections still run concurrently. HTTP 429 responses honor
`Retry-After`, or use exponential backoff starting at 30 seconds. After five
throttled requests, processing stops without consuming later sections' retry
budgets. Persistent throttling may require checking the Azure resource's quota.
The server validates word timestamps and checks the meaning chunks against the
transcribed words before constructing cues. A bad breakdown stops generation;
it never silently substitutes natural Norwegian or omits a phrase. Subtitle
text and start/end times can be edited before downloading. Long meaning chunks
and very short cues are flagged for manual review. Transcription errors still
need human correction; overlapping speech is not supported in this first version.

The preview also highlights the Turkish word being spoken, using the original
word timestamps. Highlighting follows playback and seeking, and appears in both
the preview and the Turkish transcript in the editor. It stays tied to the audio
when Norwegian subtitle times are edited. SRT/VTT downloads remain Norwegian text.
The matching Norwegian meaning chunk is highlighted alongside the Turkish word.
If the Norwegian text is rewritten, its chunk highlighting is disabled until the
original wording is restored, because the old alignment no longer applies.

Completed subtitles are saved automatically in the `saved_subtitles` table in
the existing SQLite database (`LESSON_DB`). The page lists saved recordings;
open one, edit its title/text/times, and choose **Lagre endringer**. Turkish words
and Norwegian meaning chunks keep their original timings. `.translation.json`
files can also be imported. Local development requests from the same machine
share a local library, which imports the three translations in `example/` once.
Saved translations and their YouTube links are shared with all visitors, including
existing saves. Anyone can open a recording or its direct page link. Only the
account or browser that created a save can update it; other visitors save edits
as a separate shared copy. Sign in before creating translations to keep editing
access on other devices. Clearing a guest cookie loses editing access, but the
saved translations remain visible.

Media is temporarily written to the system temp directory and removed after
completion, failure or cancellation. Audio is sent to Azure; the transcript is
sent to Anthropic. Original media is not retained in the library: select the
original audio/video file again to play saved subtitles. The three local example
stories automatically load their MP3s from `example/` when opened. No new transcription
is needed. Running requests stop on server restart, but section progress and
retry counts persist; opening the video resumes unfinished work. Completed
database records survive restarts when the database is on persistent
storage (as in the Render blueprint). `LESSON_DB=off` disables the library;
downloads still work. Save edits before closing or reloading the page.

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
| `src/storybook.ts` | Shared Turkish stories and validated Norwegian subtitles |
| `storybook/` | Bundled MP3 story audio only |
| `storybook-translations/` | Translations, exports, and original source links |

The subtitle page includes the shared [storybook](storybook-translations/README.md) for all
visitors. Its files ship with the repository and Docker image; no production
transcription is needed. Saving edits to a shared story creates a separate shared copy.

YouTube links can also be imported from the subtitle upload page. Watch, youtu.be,
mobile, and Shorts links are accepted; playlist parameters are ignored. Videos
must be non-live and at most two hours. The browser streams video directly from
YouTube. New imports do not download a complete MP4 or apply a video-size cap.
yt-dlp resolves the audio stream; FFmpeg seeks to and decodes each requested
section into temporary in-memory mono PCM. At most three sections are in flight.
Pause, replay, speed and timeline controls use the YouTube IFrame API. Audio
fades are available only for local media; embedded controls stay available.
Imports do not use browser cookies or YouTube logins. YouTube may reject server
IPs or disable embedding for a video; these errors are shown in the player.

Subtitle translations refer to numbered whole words from the transcript. The
server constructs Turkish chunks from those original words and validates complete,
non-overlapping coverage, so model spelling corrections cannot move the timing.

Docker includes yt-dlp and its JavaScript support. For Windows development:

```powershell
python -m venv data/tools/ytdlp
data/tools/ytdlp/Scripts/python.exe -m pip install "yt-dlp[default]==2026.8.19"
```

On other hosts, install `yt-dlp[default]`, FFmpeg and Node, and set `YTDLP_PATH`
if the executable is not on PATH. Existing files in `data/youtube` (overridden
with `YOUTUBE_MEDIA_DIR`) remain readable through the legacy media endpoint,
but new imports do not create video cache files. Persist the subtitle database
to retain translations and section progress across restarts.
The extractor is pinned in Docker; update it when YouTube changes its delivery.
