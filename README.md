# Calorie Pass

A tiny battle pass for two: log your calories each day, move one tier up the bar, unlock prizes.

It's a static site (GitHub Pages) that talks to Supabase. There's no build step. The only server code
is one Supabase Edge Function, for group photos.

## Rules

- Your tier on a battle pass is your **streak**: how many days in a row you've logged.
- Miss a day and your streak goes back to 0.
- **Bee Jim Hardcore Mode:** once you've both opted in, it's on for 7 days, starting that day.
  Logging more than your goal during it also sends your streak back to 0. It only affects calorie passes.
- **Michael's Chinese pass:** a second timeline on Michael's card (📚 Chinese), with its own streak, separate
  from his calories. From 20 Nov 2026 a day counts once he's finished both a 25-minute reading session on
  the e-reader and a 25-minute HSK pomodoro. Before then, the e-reader session alone counted (from 11 Nov).
  Its prizes: £100 at day 7 of a streak, then another £100 every 14 days after that (days 21, 35, 49, ...),
  and a trip to China at day 100. It has its own streak freezes too.
- **Pomodoro bank (Chinese pass, from 21 Nov 2026):** every extra pomodoro done on a day (a second reading
  session, say) is banked for that tool. A later day that's missing that tool's pomodoro uses a banked one
  automatically and counts as a full day. The bank is used before any streak freeze, a missed day is only
  covered if every missing pomodoro has one banked, and today never uses the bank (it isn't over yet). The
  card shows what's banked under today's progress, and 🏦 marks a day the bank covered.
- **Abbie's Lift weights pass (from 23 Nov 2026):** a second timeline on Abbie's card (🏋️‍♀️ Lift weights), with
  its own streak, separate from her calories. A day counts once she logs how many reps she did, in the box on
  that timeline. She can log today, or yesterday the next morning if she forgot, and logging a day again
  replaces its reps. It has no prizes, but it has its own streak freezes.
- **Bee Jim's daily visit:** the first time the app opens each day (on each phone or computer), Bee Jim
  appears. If your calorie streak has broken, he's awake: "You have broken your streak. Bee Jim is coming for
  you." If it held, he's asleep: "You have kept your streak. Bee Jim remains asleep. You are safe for now."
  He doesn't appear on the Journal tab.
- Prizes you've earned are kept after a reset, and you earn them again as you climb back up.
- **Tokens:** each prize earned is a token to spend. Tap your token count at the bottom of your pass
  to use one (it's saved with the date) or undo one used by mistake.
- **Abbie's prizes (from 16 Nov 2026):** a Plushie Accessory every 14 days, Merch every 20, a Plushie
  every 25 and a Group Photo every 50, plus three Group Photos as gifts. Plushies earned before then are kept.
- **Plushie Journal (Abbie):** the Journal tab. Each plushie gets a polaroid with its photo, name and
  what animal it is, in the frame, background, tape and font Abbie picks. It can be bought with a
  Plushie token.
- **Group photos:** a Group Photo token turns the plushies into a picture of them all alive together,
  doing whatever Abbie types ("all camping together"). It goes across the top of the journal.
- Everyone's calories (or minutes studied on the Chinese pass, or reps on Lift weights) are shown under each
  day of their pass, and a
  💥 marks what ended the last streak.

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

- Each person's passes, with their colours, prizes, Hardcore goal and journal: [passes.js](passes.js)
- The journal's frames, backgrounds, tapes and fonts: [journal-palette.js](journal-palette.js)
- The streak rules: [rules.js](rules.js)
- Look and feel: [style.css](style.css)
- The Bee Jim pictures: remake them with [tools/make-bee-jim.mjs](tools/make-bee-jim.mjs), which needs an
  OpenAI key in a `.env` file (the top of that file says how). The wording on them must match `BEE_JIM` in
  [app.js](app.js).
- The logo: replace [static/logo.png](static/logo.png), then remake the tab and app icons with
  `powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1`

## Study tools

Michael's Chinese pass is moved on by timed sessions that his study tools send when their timer finishes.

### The e-reader

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
- Sending twice is harmless. The same length sent again within 20 minutes counts as a resend and is ignored,
  so a retry can't add a pomodoro to the bank. Two real pomodoros always finish at least 25 minutes apart.
  The one catch: if two sessions are saved offline and then sent together, only one counts.

### HSK, and any other tool

Every other tool sends the same kind of request to `submit_study`, with its name in `p_source`:

```
POST https://trgjhvsfeoidurgmrhai.supabase.co/rest/v1/rpc/submit_study
Content-Type: application/json
apikey: <the publishable key from config.js>

{ "p_code": "<the shared code>", "p_player_id": 1, "p_source": "hsk", "p_date": "2026-11-11", "p_minutes": 25 }
```

- `p_source` is the tool's name. Today only `hsk` (and `ereader`) are accepted. Any other name gives
  `{ "message": "Unknown study tool: ..." }`, so a typo can't quietly send sessions that never count.
- `p_date`, `p_minutes`, sending twice and the errors all work as they do for the e-reader.
- Success is HTTP 200 with `{ "date": ..., "source": "hsk", "minutes": ... }` (that day's longest session
  from that tool).

**What a day needs** is `study` in [passes.js](passes.js): from 20 Nov 2026, both an e-reader session and an
HSK pomodoro of 25 minutes. To change it, add a new dated line there rather than editing an old one, so
earlier days keep counting as they did.

**Adding another tool** (e.g. Anki): add its name to `STUDY_TOOLS` in [passes.js](passes.js) and to the list in
`submit_study` in [supabase/schema.sql](supabase/schema.sql), then re-run schema.sql.

## The group photo camera

Group photos are drawn by OpenAI's image model (`gpt-image-2.6-sunburst`) from the plushies' photos.
That needs an OpenAI API key, which lives in Supabase as a secret. It's never in this repo or the website.
The code is [supabase/functions/group-photo/index.ts](supabase/functions/group-photo/index.ts).

One-time setup:

1. **OpenAI:** at platform.openai.com, create an API key. It's worth setting a monthly budget under
   Settings > Limits. OpenAI may ask you to verify your organisation before its image models work.
2. **Add the key to Supabase:** Edge Functions > Secrets. Name `OPENAI_API_KEY`, value the key. Save.
3. **Add the function:** Edge Functions > Deploy a new function > Via Editor. Name it `group-photo`
   (exactly), replace the example code with everything in `supabase/functions/group-photo/index.ts`,
   then Deploy function.
4. **Let the website call it:** in the function's settings, turn off JWT verification ("Verify JWT" /
   "Enforce JWT verification"). The function checks the shared code itself.
5. **Database:** re-run [supabase/schema.sql](supabase/schema.sql) as usual.

How it behaves:

- A picture takes about a minute. The journal shows it "developing" and fills it in when it's done.
- The token is only used once a picture comes back. If it fails, the journal says why.
- At most 4 tries a day, so nothing can run up the OpenAI bill.
- The model, quality and art style are at the top of `index.ts`. After changing them, paste the file into
  the function again in Supabase and click Deploy updates. On Supabase's free plan a function gets 150
  seconds, so the quality stays at "high". "xhigh" and "max" need the 400 seconds of a paid plan.
- If something goes wrong: Supabase > Edge Functions > group-photo > Logs.

## Installing it as an app

- **Android, or Chrome/Edge on a computer:** open the site, then use the browser menu's "Install app"
  (or the install icon at the end of the address bar).
- **iPhone:** open the site in Safari, then Share > Add to Home Screen. The home-screen app keeps its
  own storage, separate from Safari, so you'll enter the code and pick your name once more there.

## How it's secured

The tables have Row Level Security on with no policies, so the website can't read or write them directly.
It can only call the database functions in [supabase/schema.sql](supabase/schema.sql) (`get_state`,
`submit_log`, `set_hardcore_optin`, `submit_reading`, `submit_study`, and the token and journal ones), and all of them
check the shared code first. Journal photos are shrunk in the browser and kept in the database the
same way, so there's no separate storage bucket to secure. The group-photo function goes through the
same functions, and the OpenAI key stays in Supabase's secrets.
The anon key in `config.js` is designed to be public. **Never commit the service_role / secret key.**

## Running locally

ES modules don't load from `file://`, so serve the folder. In VS Code, the "Live Server" extension works,
or run `python -m http.server` in this folder and open http://localhost:8000.
