# Calorie Pass

A tiny battle pass for two: log your calories each day, move one tier up the bar, unlock prizes.

It's a static site (GitHub Pages) that talks to Supabase. There's no build step and no server.

## Rules

- Your tier on the battle pass is your **streak**: how many days in a row you've logged.
- Miss a day and your streak goes back to 0.
- **Bee Jim Hardcore Mode:** once you've both opted in, it's on for 7 days, starting that day.
  Logging more than your goal during it also sends your streak back to 0.
- Prizes you've earned are kept after a reset, and you earn them again as you climb back up.
- Everyone's calories are shown under each day of their pass, and a 💥 marks what ended the last streak.

## Setup

1. **Database:** open Supabase > SQL Editor, paste in [supabase/schema.sql](supabase/schema.sql), click Run.
   Run it again whenever that file changes. It's safe to re-run and keeps your logs.
2. **Set the shared code:** in the SQL Editor, run
   ```sql
   update settings set value = 'your-secret-code' where key = 'access_code';
   ```
3. **Player names:** edit them in Supabase > Table Editor > `players`. They must match the names in [passes.js](passes.js).
4. **Connect the site:** copy the Project URL and the anon / publishable key from
   Supabase > Project Settings > API into [config.js](config.js).
5. **Deploy:** push to GitHub, then go to Settings > Pages, choose "Deploy from a branch", pick `main` / root.

## Customising

- Each person's colours, prizes and Hardcore goal: [passes.js](passes.js)
- The streak rules: [rules.js](rules.js)
- Look and feel: [style.css](style.css)

## How it's secured

The tables have Row Level Security on with no policies, so the website can't read or write them directly.
It can only call three database functions (`get_state`, `submit_log`, `set_hardcore_optin`), and all of
them check the shared code first.
The anon key in `config.js` is designed to be public. **Never commit the service_role / secret key.**

## Running locally

ES modules don't load from `file://`, so serve the folder. In VS Code, the "Live Server" extension works,
or run `python -m http.server` in this folder and open http://localhost:8000.
