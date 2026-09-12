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
