// Each person's battle pass: colours and prizes.
// Names must match the players table in Supabase exactly.
// Passes are shown on the page in the order they're listed here.
// One tier = one day of your streak (see rules.js). A prize with `every: 14`
// unlocks at tiers 14, 28, 42, ...
// `goal`: during Bee Jim Hardcore Mode, logging more than this resets your streak.
// To change it from a given day without affecting earlier days, list the changes:
//   goal: [{ kcal: 1937 }, { from: "2026-10-03", kcal: 1800 }]

// Tiers shown on the timeline. When someone reaches the end, it extends by
// the same amount again (100, then 200, ...).
export const TIMELINE_LENGTH = 100;

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
    prizes: [
      { every: 14, name: "Plushie", icon: "🧸" },
      { every: 20, name: "Takeaway", icon: "🥡" },
    ],
  },

  Michael: {
    emoji: "🧌",
    goal: 1900,
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
    prizes: [{ every: 20, name: "Video game", icon: "🎮" }],
  },
};
