// What can be chosen for each photo journal polaroid (see journal.js).
// Curated so any combination stays pastel: frames are mid-pastel, backdrops are
// paler paper so the polaroid always stands out, and each frame's `ink` (the
// name and date) is a dark shade of the frame, at least 7:1 contrast.
//
// Entries save the `id`s, so labels and colours can be tweaked later and old
// entries follow along. Don't change or remove an id that's in use: an entry
// with an id that's no longer here falls back to the default.
//
// Fonts are Google Fonts families. `scale` evens out their sizes.
// Patterns: solid, dots, gingham, stripes or grid (tapes: solid, dots or stripes).

export const FRAMES = [
  { id: "cream", label: "Cream", hex: "#fffdf8", ink: "#5e402a" },
  { id: "strawberry", label: "Strawberry Milk", hex: "#fbd6e1", ink: "#7a2747" },
  { id: "peach", label: "Peach", hex: "#ffdcc7", ink: "#6e3115" },
  { id: "butter", label: "Butter", hex: "#ffeda8", ink: "#5e4607" },
  { id: "pistachio", label: "Pistachio", hex: "#e0f0c1", ink: "#33520f" },
  { id: "mint", label: "Mint", hex: "#cdeee5", ink: "#084c4a" },
  { id: "sky", label: "Baby Blue", hex: "#d5e8f8", ink: "#1f4570" },
  { id: "lavender", label: "Lavender", hex: "#e3d9f7", ink: "#46337d" },
];

export const BACKDROPS = [
  { id: "meadow", label: "Meadow", hex: "#f3f9e4", pattern: "gingham", patternHex: "#deedc0" },
  { id: "bubbles", label: "Bubbles", hex: "#e8f6f3", pattern: "dots", patternHex: "#c9e8e2" },
  { id: "lemonade", label: "Lemonade", hex: "#fff8df", pattern: "stripes", patternHex: "#fcebb2" },
  { id: "picnic", label: "Picnic", hex: "#fdf0f3", pattern: "gingham", patternHex: "#f7dae2" },
  { id: "lilac", label: "Lilac", hex: "#f3eefc", pattern: "dots", patternHex: "#e4dcf5" },
  { id: "notebook", label: "Notebook", hex: "#eef5fc", pattern: "grid", patternHex: "#d5e5f4" },
  { id: "sorbet", label: "Sorbet", hex: "#fff2e9", pattern: "stripes", patternHex: "#fce3d5" },
  { id: "oatmeal", label: "Oatmeal", hex: "#f2ebe0", pattern: "solid" },
];

export const TAPES = [
  { id: "strawberry", label: "Strawberry", hex: "#f6b8c9", pattern: "stripes", patternHex: "#fde4eb" },
  { id: "lime", label: "Lime", hex: "#cce89a", pattern: "dots", patternHex: "#f3fadf" },
  { id: "butter", label: "Butter", hex: "#ffdc7a", pattern: "solid" },
  { id: "lagoon", label: "Lagoon", hex: "#9fdbd3", pattern: "stripes", patternHex: "#ddf3ef" },
  { id: "lilac", label: "Lilac", hex: "#d2c2f0", pattern: "dots", patternHex: "#f1ebfd" },
  { id: "peach", label: "Peach", hex: "#ffc6a3", pattern: "solid" },
];

export const FONTS = [
  { id: "scribbly", label: "Scribbly", family: "Caveat", weight: 600, scale: 1.25 },
  { id: "neat", label: "Neat", family: "Patrick Hand", weight: 400, scale: 1.1 },
  { id: "bubbly", label: "Bubbly", family: "Fredoka", weight: 500, scale: 1.0 },
  { id: "loopy", label: "Loopy", family: "Pacifico", weight: 400, scale: 0.9 },
  { id: "puffy", label: "Puffy", family: "DynaPuff", weight: 400, scale: 0.9 },
  { id: "marker", label: "Marker", family: "Gochi Hand", weight: 400, scale: 1.1 },
];

// What a new entry starts with: Abbie's lime and teal.
export const DEFAULT_STYLE = { frame: "cream", backdrop: "meadow", tape: "lagoon", font: "scribbly" };

// The journal screen itself: lime-cream dotted paper, teal ink, a yellow button.
export const PAGE = {
  bg: "#fbfcf4",
  dot: "#dfe7c8",
  headingFont: "Fredoka",
  ink: "#0c5856",
  accent: "#ffd95e",
  accentInk: "#0c5856",
  soft: "#eaf5d3",
};
