# Shared Turkish storybook

The `storybook/` folder contains only MP3 audio. This `storybook-translations/`
folder contains validated `.translation.json` files with Turkish word timestamps
and Norwegian meaning chunks, SRT/VTT exports, and source notes. Both folders ship
with the server, including Docker deployments.

Original audio sources and titles are recorded in `sources.json`. These recordings
were downloaded from MebDers's Sesli Çocuk Masalları collection. Attribution does
not imply that the recordings are public domain or that this project owns them.

All visitors can open and play the shared stories. Editing and saving creates a
personal database copy; it never modifies these shared files. Existing private
uploads stay private. Old `example-…` links continue to resolve.

To add a story, place a safely named `lowercase-hyphenated.mp3` in `storybook/` and record its
source in `sources.json`. With the development server running, execute:

    node scripts/translate-storybook.mjs

The script reuses existing translations, generates missing ones through the app's
Azure/Claude pipeline, and writes translations and SRT/VTT files to `storybook-translations/`. Commit both folders
to include it in the next deployment. Generation uses the configured paid APIs.

To add natural Norwegian sentences below the word-order glosses, run:

    node --import tsx scripts/translate-natural-subtitles.mjs

This uses Claude only for missing translations and saves each sentence's `natural`
text on its first cue. Playback joins split cues into complete display sentences.
Stories with saved translations need no translation calls during playback. For
older uploads without this text, the page translates the displayed Turkish sentence
through the app's translator and caches up to 200 sentences in the browser.

To save synchronized phrase highlights for these natural sentences, run:

    node --import tsx scripts/align-natural-subtitles.mjs

Each `naturalLinks` entry links an exact Norwegian substring to indices in the
complete display sentence's meaning chunks. A group can highlight multiple,
separated Norwegian phrases. Unmatched words stay plain. The script reuses valid
links and leaves text and timing unchanged. Older uploads fetch missing links
through `/api/subtitle-alignment`, with a separate browser cache. Invalid links
leave the sentence readable without guessing a highlight.

Optional emoji hints are saved separately on each meaning chunk as `hint`, with
one meaning emoji and up to three Turkish suffix cues. To populate missing hints:

    node --import tsx scripts/add-subtitle-emoji-hints.mjs

The **Vis emojihint** checkbox is off by default and remembers its setting. It
shows hints beside the Turkish words, in the Turkish focus line, and in the
Turkish badges above the natural Norwegian sentence. Suffix
symbols have dashed borders and Norwegian tooltips (for example ⏪ past, 🔮 future,
👥 plural, 🚫 negation). These are approximate learning aids; all subtitle wording,
timings, and exported subtitle text remain unchanged. Older uploads request and
cache hints only when the option is enabled.
