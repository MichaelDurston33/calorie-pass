// Each person's battle pass: colours and prizes.
// Names must match the players table in Supabase exactly.
// Passes are shown on the page in the order they're listed here.
// One tier = one day of your streak (see rules.js). A prize with `every: 14`
// unlocks at tiers 14, 28, 42, ...
// To change how often a prize comes from a given day, without changing what was
// earned before, list the changes (a prize with no entry yet isn't running):
//   every: [{ days: 14 }, { from: "2026-11-16", days: 25 }]
// `gift: 1` starts someone off with one token of that prize.
// `goal`: during Bee Jim Hardcore Mode, logging more than this resets your streak.
// To change it from a given day without affecting earlier days, list the changes:
//   goal: [{ kcal: 1937 }, { from: "2026-10-03", kcal: 1800 }]
// `reading`: from that day on, a day only counts once there's also a finished
// reading session of at least that many minutes, sent by the e-reader. A day
// without one counts as a missed day (see rules.js).
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

export const PASSES = {
  Abbie: {
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

  Michael: {
    emoji: "🧌",
    goal: [{ kcal: 1900 }, { from: "2026-10-20", kcal: 2100 }],
    reading: { from: "2026-11-11", minutes: 25 },
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
};
