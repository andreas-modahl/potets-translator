# Shared Turkish storybook

This folder is shipped with the server (including Docker deployments). Each story
has an MP3, a validated `.translation.json` containing Turkish word timestamps and
Norwegian meaning chunks, and downloadable SRT/VTT exports.

Original audio sources and titles are recorded in `sources.json`. These recordings
were downloaded from MebDers's Sesli Çocuk Masalları collection. Attribution does
not imply that the recordings are public domain or that this project owns them.

All visitors can open and play the shared stories. Editing and saving creates a
personal database copy; it never modifies these shared files. Existing private
uploads stay private. Old `example-…` links continue to resolve.

To add a story, place a safely named `lowercase-hyphenated.mp3` here and record its
source in `sources.json`. With the development server running, execute:

    node scripts/translate-storybook.mjs

The script reuses existing translations, generates missing ones through the app's
Azure/Claude pipeline, and writes SRT/VTT files for every story. Commit the folder
to include it in the next deployment. Generation uses the configured paid APIs.
