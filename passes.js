// Each person's battle pass: colours and prizes.
// Names must match the players table in Supabase exactly.
// One tier = one day logged. A prize with `every: 14` unlocks at tiers 14, 28, 42, ...

export const PASSES = {
  Michael: {
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

  Abbie: {
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
};
