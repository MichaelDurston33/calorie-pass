// Each person's battle passes: colours and prizes.
// Names must match the players table in Supabase exactly.
// Someone can have more than one pass, each with its own streak and prizes.
// Passes are shown on the page in the order they're listed here. A person's
// first pass gives them their emoji and colours elsewhere (e.g. the "Who's
// using this device?" buttons).
//
// What moves a pass on:
// - A calorie pass (the default) counts each day with calories logged.
// - `study` makes it a study pass instead: a day counts once each tool it
//   `needs` has sent a session of at least that many minutes that day.
//     study: { needs: { ereader: 25 } }
//   To change what's needed from a given day without affecting earlier days,
//   list the changes:
//     study: [{ needs: { ereader: 25 } }, { from: "2026-12-01", needs: { ereader: 25, hsk: 25 } }]
//   The tools are in STUDY_TOOLS below. Bee Jim Hardcore Mode doesn't apply to
//   study passes.
// `title` names a pass when someone has several (shown after their name).
//
// One tier = one day of the pass's streak (see rules.js). A prize with
// `every: 14` unlocks at tiers 14, 28, 42, ...
// `first` moves the first one: `first: 7, every: 14` unlocks at 7, 21, 35, ...
// A prize with only `first` unlocks once per streak, at that tier.
// To change how often a prize comes from a given day, without changing what was
// earned before, list the changes (a prize with no entry yet isn't running):
//   every: [{ days: 14 }, { from: "2026-11-16", days: 25 }]
// `gift: 1` starts someone off with one token of that prize.
// A prize's name is how its spent tokens are found, so give each of a person's
// prizes a different name (across all their passes), and don't rename one
// that's been spent.
// `goal`: during Bee Jim Hardcore Mode, logging more than this resets your streak.
// To change it from a given day without affecting earlier days, list the changes:
//   goal: [{ kcal: 1937 }, { from: "2026-10-03", kcal: 1800 }]
// Each prize earned is a token to spend. Tap your token count on your pass to
// use one; it's recorded with the date.
// `journal`: gives that person a photo journal (see journal.js). Entries can be
// bought with a token of the `prize` named, and the journal is called `title`.
// A `groupPrize` token makes a group photo of everything in the journal (see
// supabase/functions/group-photo).

// Tiers shown on the timeline. When someone reaches the end, it extends by
// the same amount again (100, then 200, ...).
export const TIMELINE_LENGTH = 100;

// A streak freeze is earned every this many days of a streak. Each one covers
// one missed day automatically, so the streak carries on (see rules.js).
export const FREEZE_EVERY = 15;

// Calories walking burns per step, deducted from what you ate when you log steps.
// Conservative: walking costs about 0.5 kcal per kg per km on top of resting
// (lower than the ~0.8 often quoted for brisk walking). At 71 kg that's ~35 kcal/km,
// and at ~1,400 steps/km that's 0.025 kcal a step, so 10,000 steps = 250 kcal.
export const KCAL_PER_STEP = 0.025;

// The tools that send timed study sessions, by the name each one sends
// (see "Study tools" in the README). A new tool also needs adding to
// submit_study in supabase/schema.sql, which turns away names it doesn't know.
export const STUDY_TOOLS = {
  ereader: { name: "e-reader", icon: "📖", done: "Read today", todo: "Not read today" },
  hsk: { name: "HSK", icon: "📝", done: "HSK done today", todo: "No HSK today" },
};

export const PASSES = {
  Abbie: [
    {
      emoji: "🐝",
      goal: [{ kcal: 1937 }, { from: "2026-10-03", kcal: 1800 }],
      // Lime green, teal and yellow
      colors: {
        bg: "#f6fbe8",
        border: "#d5eab0",
        ink: "#0e6b69",
        track: "#d3e6b3",
        line: "#8ccf3a",
        node: "#12928f",
        prize: "#ffd43b",
        prizeInk: "#0e4f4e",
      },
      // From 16 Nov 2026 the Plushie moves to every 25 days and an Accessory takes
      // its old every-14 spot. Plushies earned before then are kept.
      prizes: [
        { every: [{ from: "2026-11-16", days: 14 }], name: "Plushie Accessory", icon: "🎀" },
        { every: 20, name: "Merch", icon: "👕" },
        { every: [{ days: 14 }, { from: "2026-11-16", days: 25 }], name: "Plushie", icon: "🧸" },
        { every: [{ from: "2026-11-16", days: 50 }], name: "Group Photo!", icon: "📸", gift: 2 },
      ],
      journal: { prize: "Plushie", groupPrize: "Group Photo!", title: "Plushie Journal" },
    },
  ],

  Michael: [
    {
      emoji: "🧌",
      goal: [{ kcal: 1900 }, { from: "2026-10-20", kcal: 2100 }],
      // Drampa blue and Drampa beige
      colors: {
        bg: "#f4efe1", // panel
        border: "#dcd2ba",
        ink: "#1f5857", // name, tier number
        track: "#d3c7aa", // timeline not reached yet
        line: "#3a8a89", // timeline reached
        node: "#3a8a89",
        prize: "#2b7271", // earned prize card
        prizeInk: "#f4efe1",
      },
      prizes: [{ every: 20, name: "Takeaway", icon: "🥡" }],
    },
    {
      // Chinese study, separate from calories. For now that's a 25-minute
      // session on the e-reader, which has been sending them since 11 Nov 2026.
      title: "Chinese",
      emoji: "🏮",
      study: [
        { needs: { ereader: 25 } },
        // Once the HSK tool is sending pomodoros, add a line like this, with
        // the day it starts, to need both every day from then on:
        // { from: "2026-12-01", needs: { ereader: 25, hsk: 25 } },
      ],
      // Lantern red and gold
      colors: {
        bg: "#fdf4ee",
        border: "#f1d5c6",
        ink: "#9b1c1c",
        track: "#efd3c3",
        line: "#c8333a",
        node: "#c8333a",
        prize: "#f2b630",
        prizeInk: "#7a1414",
      },
      // £100 at day 7 of a streak, then another every 14 days after that
      // (21, 35, 49, ...). A trip to China at day 100.
      prizes: [
        { first: 7, every: 14, name: "£100", icon: "💷" },
        { first: 100, name: "Trip to China", icon: "✈️" },
      ],
    },
  ],
};
