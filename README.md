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

From then on, every message posted there is reposted translated. By default the
translation appears under the original author's name and avatar (via a webhook),
which reads far better in a busy mixed-language channel than a wall of bot
replies. Switch to plain replies with `mode: Reply to the message` if you would
rather not grant the Manage Webhooks permission — the bot also falls back to
replies on its own if that permission is missing.

Editing an original message rewrites its translation; deleting it deletes the
translation too. That link is kept in memory for the last 1000 translated
messages, so it survives normal use but not a restart.

Other commands: `/translator status` and `/translator disable`. All three
require the Manage Server permission and reply only to you.

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
   - Send Messages in Threads
   - Read Message History
   - Manage Webhooks *(only needed for the default posting mode)*
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
| `DEFAULT_POST_MODE` | `webhook` | `webhook` or `reply`. |
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

The bot ignores messages from bots and webhooks. That is what stops it
translating its own output in a loop, since translations are themselves posted
through a webhook — worth keeping in mind before relaxing that check.
