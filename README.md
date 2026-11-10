# Calorie Pass

A tiny battle pass for two: log your calories each day, move one tier up the bar, unlock prizes.

It's a static site (GitHub Pages) that talks to Supabase. There's no build step and no server.

## Rules

- Your tier on the battle pass is your **streak**: how many days in a row you've logged.
- Miss a day and your streak goes back to 0.
- **Bee Jim Hardcore Mode:** once you've both opted in, it's on for 7 days, starting that day.
  Logging more than your goal during it also sends your streak back to 0.
- **Reading (Michael, from 11 Nov 2026):** a day only counts once the e-reader has also sent a finished
  25-minute reading session. Calories without a session count as a missed day.
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
- The logo: replace [static/logo.png](static/logo.png), then remake the tab and app icons with
  `powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1`

## The e-reader

When its 25-minute timer finishes, the e-reader sends one request:

```
POST https://trgjhvsfeoidurgmrhai.supabase.co/rest/v1/rpc/submit_reading
Content-Type: application/json
apikey: <the publishable key from config.js>

{ "p_code": "<the shared code>", "p_player_id": 1, "p_date": "2026-11-11", "p_minutes": 25 }
```

- `p_date` is the e-reader's own local date (`YYYY-MM-DD`). Only today or yesterday is accepted.
- Michael is player 1. `p_minutes` is optional and defaults to 25.
- Success is HTTP 200 with `{ "date": ..., "minutes": ... }` (that day's longest session). Anything else
  failed and is worth retrying; a wrong code gives `{ "message": "Invalid code" }`.
- Sending twice is harmless: it just records another session.

To change who needs reading, from when, or for how long: `reading` in [passes.js](passes.js).

## Installing it as an app

- **Android, or Chrome/Edge on a computer:** open the site, then use the browser menu's "Install app"
  (or the install icon at the end of the address bar).
- **iPhone:** open the site in Safari, then Share > Add to Home Screen. The home-screen app keeps its
  own storage, separate from Safari, so you'll enter the code and pick your name once more there.

## How it's secured

The tables have Row Level Security on with no policies, so the website can't read or write them directly.
It can only call four database functions (`get_state`, `submit_log`, `set_hardcore_optin`,
`submit_reading`), and all of them check the shared code first.
The anon key in `config.js` is designed to be public. **Never commit the service_role / secret key.**

## Running locally

ES modules don't load from `file://`, so serve the folder. In VS Code, the "Live Server" extension works,
or run `python -m http.server` in this folder and open http://localhost:8000.
