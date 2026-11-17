// The group photo camera: draws Abbie's plushies together, alive, with OpenAI's
// image model, and saves the picture to her journal.
//
// It runs on Supabase as an Edge Function called "group-photo", so the OpenAI
// key stays on the server and never reaches the website. Setting it up is in
// the README ("The group photo camera").
//
// The page sends the shared code, whose journal it is, what they're doing and
// which plushies are in it. This replies straight away and carries on in the
// background (about a minute), then saves the picture (finish_group_photo) or
// what went wrong (fail_group_photo). The page checks back until it's there.
// A token is only used once a picture is saved.

// ---------- Settings ----------

// The model and how carefully it draws. Higher quality is slower and costs more.
// Supabase's free plan stops a function after 150 seconds, so stay on "high"
// unless the project is on a paid plan (400 seconds), where "xhigh" or "max" fit.
const MODEL = "gpt-image-2.6-sunburst";
const QUALITY = "high"; // low, medium, high, xhigh or max
const SIZE = "1536x1024"; // landscape, 3:2
const TIME_LIMIT_MS = 140_000; // give up just before Supabase would stop us
const MAX_PLUSHIES = 16;

// Neopets, which Abbie loves, but in the soft look of its Pastel pets and the
// journal's own colours (the frame names in journal-palette.js), so the picture
// sits calmly on the page. The first try asked for glossy, saturated Neopets
// colours and a detailed background, and came out too bright and busy.
const STYLE = [
  "Neopets-style art in the soft look of Neopets' Pastel pets: the cute, rounded characters",
  "and big, friendly, expressive eyes of early-2000s Neopets illustrations, in gentle pastel colours.",
  "A pastel palette: cream, strawberry-milk pink, peach, butter yellow, pistachio green, mint,",
  "baby blue and lavender, kept light and slightly muted.",
  "The characters keep their own colours and markings from their photos, just softened into",
  "pastel versions (a brown patch becomes a soft cocoa brown).",
  "Matte colouring with simple, soft shading: no gloss or shiny highlights.",
  "Thin outlines in a darker shade of each colour rather than black.",
  "Gentle, even light with low contrast and no dark areas.",
  "A simple, uncluttered background: a few large, soft shapes that set the scene,",
  "with calm space around the characters so they stand out.",
  "No sparkles, glitter, glowing lights or busy patterns.",
].join(" ");

// ---------- The function ----------

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

type Plushie = { name: string; species: string | null; photo: string };
type Db = (fn: string, args: Record<string, unknown>) => Promise<any>;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ message: "Use POST" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply({ message: "Bad request" }, 400);
  }
  const { code, playerId, prize, prompt, entryIds, date } = body ?? {};

  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return reply({ message: "The camera isn't set up yet: OPENAI_API_KEY is missing from the Edge Function secrets" }, 500);

  const db = database(req);
  let started: { id: number; plushies: Plushie[] };
  try {
    // Checks the code and the daily limit, and records the attempt as pending.
    started = await db("begin_group_photo", {
      p_code: code,
      p_player_id: playerId,
      p_prize: prize,
      p_prompt: prompt,
      p_entry_ids: (entryIds ?? []).slice(0, MAX_PLUSHIES),
      p_date: date,
    });
  } catch (err) {
    return reply({ message: (err as Error).message }, 400);
  }

  EdgeRuntime.waitUntil(develop(db, code, started.id, started.plushies, String(prompt), playerId, key));
  return reply({ id: started.id }, 202);
}

// Sends the photos to OpenAI and saves whatever comes back.
async function develop(db: Db, code: string, id: number, plushies: Plushie[], scene: string, playerId: number, key: string) {
  try {
    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", buildPrompt(plushies, scene));
    form.append("size", SIZE);
    form.append("quality", QUALITY);
    form.append("output_format", "jpeg");
    form.append("output_compression", "85");
    form.append("safety_identifier", await sha256(`calorie-pass-player-${playerId}`));
    plushies.forEach((p, i) => form.append("image[]", toBlob(p.photo), `plushie-${i + 1}.jpg`));

    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(TIME_LIMIT_MS),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok) throw new Error(explain(res.status, out?.error));

    const b64 = out?.data?.[0]?.b64_json;
    if (!b64) throw new Error("No picture came back. Try again.");
    await db("finish_group_photo", { p_code: code, p_id: id, p_photo: `data:image/jpeg;base64,${b64}` });
  } catch (err) {
    const e = err as Error;
    const message = e.name === "TimeoutError" ? "It took too long. Try again, maybe with fewer plushies." : e.message;
    console.error("group photo failed:", message);
    await db("fail_group_photo", { p_code: code, p_id: id, p_error: message }).catch(() => {});
  }
}

// What to ask for. Each plushie's photo goes along as a numbered reference image.
export function buildPrompt(plushies: Plushie[], scene: string) {
  const cast = plushies
    .map((p, i) => {
      const what = p.species ? `${/^[aeiou]/i.test(p.species) ? "an" : "a"} ${p.species}` : "a plush toy";
      return `${i + 1}. ${p.name}: ${what} (reference image ${i + 1})`;
    })
    .join("\n");

  return [
    "Create one brand-new illustration of these plush toys brought to life as living creatures, all together in one scene.",
    "",
    "The characters (each reference image is a photo of one plush toy):",
    cast,
    "",
    "Keep every character recognisable from its photo: the same kind of animal, colours, markings, outfit and accessories, " +
      "but drawn as a lively, expressive creature rather than a stuffed toy.",
    "",
    `What they're doing: ${scene.trim()}`,
    "",
    `Art style: ${STYLE}`,
    "",
    // "Interacting with each other" only makes sense when there's more than one.
    plushies.length > 1
      ? "A wide landscape picture. Every character fully in view, none cut off or hidden, looking happy and " +
        "interacting with each other. No text, letters, names, logos or watermarks."
      : "A wide landscape picture. The character fully in view, not cut off or hidden, and looking happy. " +
        "No text, letters, names, logos or watermarks.",
  ].join("\n");
}

// A friendly version of an OpenAI error.
function explain(status: number, error: { code?: string; message?: string } | undefined) {
  if (error?.code === "moderation_blocked") return "OpenAI's safety filter stopped this one. Try wording it differently.";
  if (status === 401) return "The OpenAI key isn't working. Check OPENAI_API_KEY in the Edge Function secrets.";
  if (status === 429) return "OpenAI is busy, or the account is out of credit. Try again later.";
  return error?.message || `OpenAI said no (${status}). Try again later.`;
}

// Calls one of the database functions in supabase/schema.sql, as the website does.
function database(req: Request): Db {
  const url = Deno.env.get("SUPABASE_URL");
  const apikey = publishableKey() ?? Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
  return async (fn, args) => {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify(args),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok) throw new Error(out?.message || `${fn} failed (${res.status})`);
    return out;
  };
}

function publishableKey(): string | undefined {
  try {
    return JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default;
  } catch {
    return undefined;
  }
}

function toBlob(dataUrl: string) {
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/jpeg" });
}

// OpenAI asks for a stable, anonymous id for who a picture is for.
async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(handle);
