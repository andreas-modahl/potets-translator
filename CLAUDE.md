# Working in this repo

## The dev server is mine, not yours

I run `npm run web` myself while we work. It serves the app on
http://localhost:3000.

- Do not start a server of your own. Point the browser at mine.
- Do not stop the server between checks, and never stop mine.
- If nothing answers on :3000, tell me; do not start one to fill the gap.

## Keep the Playwright browser open

The Playwright MCP browser is for looking at the app. Open it once and
reuse it for every check in the session.

- Do not close the browser or the tab after each check.
- Navigating again to reload after an edit is fine; closing is not.
- Leave it open at the end of a turn too. I may be looking at it.

## After a change

Commit and push to `main` when a change is done and checked. Render
deploys from `main`.
