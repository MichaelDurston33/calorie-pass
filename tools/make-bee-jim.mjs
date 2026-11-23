// Makes the two Bee Jim pictures the app shows the first time each day it's
// opened (see "Bee Jim's daily visit" in app.js):
//   static/bee-jim-awake.jpg  - your calorie streak has broken: he's coming for you
//   static/bee-jim-asleep.jpg - it held: he sleeps
// The sleeping one is drawn from the awake one, so it's the same zombie.
//
// It needs an OpenAI API key in a file called .env in the calorie-pass folder,
// on one line:   OPENAI_API_KEY=sk-...
// git ignores .env, so the key is never committed. Then, from that folder:
//   node tools/make-bee-jim.mjs           both pictures (about a minute each)
//   node tools/make-bee-jim.mjs asleep    just one ("awake" or "asleep")
// Each picture costs a little OpenAI credit. Delete the key when you're done.

import { readFileSync, writeFileSync } from "node:fs";

const MODEL = "gpt-image-2.6-sunburst"; // the same model as the group photo camera
const QUALITY = "high";
const SIZE = "1024x1536"; // portrait, to fill a phone screen

const STYLE = [
  "A surrealist oil painting in the style of Salvador Dalí's 1940 painting \"The Face of War\", turned into a horror scene:",
  "a vast, empty, sun-scorched desert plain under a hazy sky, long hard shadows, a dreamlike, hallucinatory stillness,",
  "smooth glazed brushwork, and a muted palette of ochre, sand, bone white and dusty blue-grey.",
].join(" ");

// The words go on the picture exactly as the app's text has them (BEE_JIM in app.js).
const lettering = (lines) =>
  [
    "At the bottom of the picture, on a plain band of sand-coloured space, large, clear, old-fashioned serif",
    `lettering in dark brown reads exactly, on ${lines.length} lines, spelled exactly as written:`,
    ...lines.map((line) => `"${line}"`),
    "No other words, letters, signatures or watermarks anywhere.",
  ].join("\n");

const PROMPTS = {
  awake: [
    STYLE,
    "",
    "In the centre, filling most of the picture, is Bee Jim: a gaunt, withered zombie with cracked, grey-green skin,",
    "seen head and shoulders. Like the face in Dalí's painting, his hollow eye sockets and gaping mouth each hold",
    "something inside them, but here it's dense clusters of honeybees and dripping honeycomb rather than skulls.",
    "Bees crawl out of the cracks in his skin, honeycomb grows from his skull and shoulders, and instead of Dalí's",
    "snakes, ribbons of swarming bees coil around his head. He stares straight at the viewer, menacing and hungry.",
    "Eerie and unsettling rather than gory: no blood.",
    "",
    lettering(["You have broken your streak.", "Bee Jim is coming for you."]),
  ].join("\n"),

  asleep: [
    "The reference image is Bee Jim, a zombie infested with bees, in the style of Salvador Dalí's \"The Face of War\".",
    "Paint a new picture of the same zombie, in the same desert, the same painting style and the same colours, but now",
    "Bee Jim is fast asleep: eyelids peacefully closed, head tilted and resting, mouth gently closed. His bees are",
    "asleep too, settled quietly on his honeycomb with their wings folded, none of them flying. It's evening, with a",
    "large pale moon low in the sky: calm, quiet and still, but still a little eerie.",
    "",
    lettering(["You have kept your streak.", "Bee Jim remains asleep.", "You are safe for now."]),
  ].join("\n"),
};

const file = (which) => new URL(`../static/bee-jim-${which}.jpg`, import.meta.url);

// The key from .env. It's never printed.
function apiKey() {
  let env = "";
  try {
    env = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {}
  const key = env.match(/^\s*OPENAI_API_KEY\s*=\s*["']?([^"'\s]+)/m)?.[1];
  if (!key) {
    console.error("No key found: put OPENAI_API_KEY=... in a file called .env in the calorie-pass folder.");
    process.exit(1);
  }
  return key;
}

async function draw(which, key) {
  console.log(`Drawing Bee Jim ${which}... (about a minute)`);
  const common = { model: MODEL, prompt: PROMPTS[which], size: SIZE, quality: QUALITY, output_format: "jpeg" };
  let res;
  if (which === "awake") {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...common, output_compression: 85 }),
      signal: AbortSignal.timeout(300_000),
    });
  } else {
    // Drawn from the awake picture, so it's recognisably the same zombie.
    const form = new FormData();
    for (const [name, value] of Object.entries(common)) form.append(name, value);
    form.append("output_compression", "85");
    form.append("image[]", new Blob([readFileSync(file("awake"))], { type: "image/jpeg" }), "bee-jim-awake.jpg");
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
  }
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`OpenAI said no (${res.status}): ${out?.error?.message ?? "no details"}`);
  const b64 = out?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No picture came back");
  writeFileSync(file(which), Buffer.from(b64, "base64"));
  console.log(`Saved static/bee-jim-${which}.jpg`);
}

const which = process.argv[2];
if (which && !PROMPTS[which]) {
  console.error('Say "awake", "asleep", or nothing for both.');
  process.exit(1);
}
const key = apiKey();
try {
  for (const w of which ? [which] : ["awake", "asleep"]) await draw(w, key);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
