# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A two-player calorie "battle pass" for Michael (player 1) and Abbie (player 2). It's a static site on GitHub Pages
(plain ES modules, no framework, no build step, no package.json) backed by Supabase Postgres, plus one Supabase
Edge Function (`group-photo`) that calls OpenAI. Pushing to `main` deploys to the live site, and GitHub Pages
caches files for about 10 minutes, so after a deploy the page needs a hard refresh (Ctrl+Shift+R).

## Commands

There is no build, lint or test tooling, and no tests are committed.

- **Run locally:** ES modules don't load from `file://`, so serve the folder with any static server (for example
  `npx http-server .`, or VS Code Live Server). It talks to the real Supabase project in `config.js`.
- **Preview Hardcore Mode:** add `?hardcore` to the URL. It fakes a 7-day period on this device only, without
  saving anything.
- **Offline preview / UI checks:** every network call goes through `rpc()` or `callFunction()` in `util.js`, both
  of which use `fetch`. Stubbing `window.fetch` with a fake `get_state` payload, and setting the localStorage keys
  `calorie-pass-code` and `calorie-pass-player`, gives a full preview without touching real data. Headless
  Edge/Chrome screenshots of that are how UI changes have been checked before pushing.
- **Testing the rules:** `rules.js` is pure. Its only import is `passes.js`, and it touches no DOM, so Node (22+)
  can import it directly and call `playPass` (or `playStreak`) with made-up logs and reading sessions.
- **Testing the edge function:** `supabase/functions/group-photo/index.ts` exports `handle(req)`. Mock
  `Deno.env`, `EdgeRuntime.waitUntil` and `fetch` to exercise it.
- **Database changes:** edit `supabase/schema.sql`. Claude can't apply it, because the site only has the
  publishable key. Michael pastes the whole file into the Supabase SQL Editor and runs it. Until then the live
  site will error on any new or changed function, so say so plainly whenever a change needs this.
- **Edge function changes:** edit the repo file, then Michael pastes it into Supabase's dashboard editor
  (Edge Functions > group-photo) and redeploys. There's no CLI deploy, so the repo copy is the source of truth.

## Architecture

### Data flow: one big read, server-computed nothing

- `get_state(p_code)` returns everything in one JSON blob:
  - every player's full calorie logs, reading sessions, token spends, journal entries and group photos;
  - Hardcore periods and opt-ins.
- Photos are left out of that blob (see below).
- Every write RPC (`submit_log`, `spend_token`, `save_journal_entry`, …) returns `get_state` again. The page then
  calls `setState()` and `show()`, which re-render the whole view with `innerHTML`. Module-level variables in
  `app.js` are the only client state.

### Game logic lives in the browser, not the database

The database stores raw facts only: logs, reading sessions, Hardcore periods, token spends and journal rows.

A player can have several passes (Michael has a calorie pass and a Chinese study pass). On every render,
`rules.js` `playPass` replays each pass from scratch and derives:
- the streak (which is also their tier);
- prizes earned;
- streak freezes, and the days they covered;
- what ended the last streak.

What counts as a day depends on the pass (`passDays`):
- **A calorie pass** counts each day with a calorie log. Hardcore Mode applies only to calorie passes.
- **A study pass** (`study` in `passes.js`) counts each day on which every tool in `needs` sent a long enough
  session (`studyOn`, `studied`). `needs` is a dated list, like `goal`. Sessions live in `reading_sessions`
  with a `source` (the tool's name). Rows from before that column existed are the e-reader's, and the client
  treats a missing `source` as `ereader` too.

Tokens are worked out as:
- **tokens left** = earned (from `playStreak`, including any `gift`) − rows in `token_spends` with that prize's
  `name` (`tokensLeft`).

Consequences:
- **Prize names are keys.** `token_spends.prize`, journal entries and group photos all refer to a prize by its
  display name, with no pass column. Renaming a prize in `passes.js` orphans its spends, so it would need a data
  migration. A player's prize names must also be unique across all their passes.
- **Never edit a past rule in place.** Settings that change over time (`goal`, a prize's `every`) are lists of
  `{ from: "YYYY-MM-DD", ... }` entries, and each day uses the entry in force on that day. To change a rule, add a
  new dated entry, so streaks and tokens already earned don't change. A prize with no entry yet in force isn't
  running.
- Dates everywhere are `YYYY-MM-DD` strings compared as strings. `today()` is the browser's local date. Write
  RPCs only accept dates within a day of the server's `current_date`, so past days can't be backfilled from
  the site.
- The server can't enforce token counts. Rate limits in SQL (for example, at most 4 group photo tries a day)
  are the backstop.

### Config vs code

- `passes.js`: each player's list of passes, keyed by the player's `name`, which must match the `players` table.
  A player's first pass supplies their emoji and colours elsewhere (picker, "Logging as"). Its header comment
  documents every option: colours, `title`, `goal`, `study`, `prizes` (`every`, `first`, `gift`) and `journal`.
  `STUDY_TOOLS` there names the study tools and how each is shown.
- `journal-palette.js`: the journal's design tokens: frames, backdrops, tapes, fonts, page colours, and the
  default styles for entries and group photos. Each entry's `style` jsonb stores only these ids.
  `resolveStyle()` falls back to the defaults for unknown ids.
- `README.md` "Rules" describes the game for humans. Keep it in sync when rules or prize schedules change.

### Security model

- Every table has Row Level Security on and **no policies**, so the publishable key can't touch tables.
- All access is through `SECURITY DEFINER` functions that start with `perform check_code(p_code)` (a single
  shared code in `settings`).
- The page stores the code in localStorage, and the client chooses `p_player_id`. That's acceptable for two
  trusted people, and is by design.
- A new RPC needs a `grant execute on function name(<full arg types>) to anon;` line at the bottom of
  `schema.sql`.
- The publishable key in `config.js` is meant to be public. The OpenAI key exists only as the Supabase secret
  `OPENAI_API_KEY`.

### schema.sql is re-run whole

`schema.sql` must stay idempotent, because it's re-run from top to bottom every time:
- `create table if not exists`, then `alter table … add column if not exists` for later columns.
- Functions use `create or replace`.
- When a function's arguments change, Postgres treats it as a new overload. Add a
  `drop function if exists name(<old arg types>);` before it, and update its grant line.
- One-off data fixes go at the end, guarded so that re-running them is harmless.

### External callers of the RPCs

Not everything goes through this site, so keep these signatures stable or update their callers:
- `submit_log`: called nightly for **both** players by the scheduler in Michael's separate `yazio-mcp` project
  (Fly.io), which overwrites the calories with Yazio's figure.
- `submit_reading`: called by Michael's e-reader when a 25-minute session finishes. It feeds his Chinese study
  pass. The request format is in the README.
- `submit_study`: the same thing for every other study tool, named in `p_source` (`hsk` for Michael's HSK
  pomodoro tool, which is still being built). It only accepts names in its list, which must match
  `STUDY_TOOLS` in `passes.js`.

### Two views, two modules

- `app.js` handles login, the player picker, passes, the timeline, tokens and Hardcore Mode.
- `journal.js` is the photo journal. `app.js` calls `initJournal(ctx)` with accessors (`players`, `journalFor`,
  `tokensFor`, `apply`, `refresh`, …), so the journal doesn't import app state.
- The view is chosen by the URL hash (`#journal`), and the tab only appears if some pass has `journal`.
- The Hardcore bee/zombie frame (`body.hardcore`) is deliberately hidden on the journal view.
- Per-pass colours are applied as CSS variables from `pass.colors` (`themeStyle`). The journal page's colours
  are `--j-*` variables taken from `PAGE`.

### Photos are text in Postgres

- The browser crops journal photos square and shrinks them (`shrinkPhoto`: 800px JPEG data URL), then saves
  them in `journal_entries.photo`. There's no storage bucket.
- `get_state` omits photos. Each is fetched on demand (`get_journal_photo` / `get_group_photo`) when its tile
  scrolls into view (IntersectionObserver), and cached in memory for the session.
- Group photos are JPEG data URLs in `group_photos.photo`.

### Group photo pipeline

1. The page calls `callFunction("group-photo", { code, playerId, prize, prompt, entryIds, date })`.
2. The edge function calls `begin_group_photo` through the same public RPC interface with the publishable key
   (it never uses the service role). That function checks the code and token, enforces one pending photo at a
   time and 4 tries a day, inserts a `pending` row and returns the chosen plushies' names, species and photos.
3. The function replies **202** straight away, then finishes in `EdgeRuntime.waitUntil`:
   - it calls OpenAI `POST /v1/images/edits`, sending each plushie photo as an `image[]` field and a prompt that
     numbers them by name and species;
   - it then calls `finish_group_photo`, which **spends the token** and makes the photo the one shown, or
     `fail_group_photo` with a friendly error.
4. While a photo is pending, the page polls `get_state` every 5 seconds. A photo pending for more than 5 minutes
   counts as failed, and the client (`DEVELOPING_FOR`) and SQL both apply that rule.
5. Supabase's free plan stops functions after 150 seconds. That's why `QUALITY` is `"high"` and
   `TIME_LIMIT_MS` is 140s. The model, quality and art style are the constants at the top of `index.ts`.

## Working with Michael

- Michael is new to web development. Explain in plain language, and spell out any step only Michael can do:
  re-running `schema.sql`, re-pasting the edge function, a hard refresh after a deploy.
- Commit and push each finished change to `main`, because Michael checks every change on the live site.
- Code comments are plain English and explain *why*. Match that style, and keep the header comments in
  `passes.js`, `rules.js` and `index.ts` accurate when behaviour changes.
