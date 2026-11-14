// The photo journal: one polaroid per thing bought with a prize token (Abbie's
// plushies). Turned on for someone by `journal` in passes.js; the colours and
// fonts to choose from are in journal-palette.js.
//
// Photos are cropped square and shrunk to an 800x800 JPEG in the browser before
// saving, so each is roughly 100 KB. The page state has entries without their
// photos; each photo is fetched once its polaroid scrolls into view.

import { BACKDROPS, DEFAULT_STYLE, FONTS, FRAMES, PAGE, TAPES } from "./journal-palette.js";
import { $, escapeHtml, fmtDay, rpc, today } from "./util.js";

const PHOTO_SIZE = 800;
const PHOTO_QUALITY = 0.82;
const NAME_MAX = 24;

// Each polaroid sits at a slight angle, always the same one for the same entry.
const TILTS = [-2.5, 1.8, -1.2, 2.6, -1.8, 1.2];

// From app.js: { code(), myId(), players(), passFor(player), tokensFor(player), apply(state) }
let ctx;

export function initJournal(context) {
  ctx = context;
  const root = document.documentElement.style;
  root.setProperty("--j-bg", PAGE.bg);
  root.setProperty("--j-dot", PAGE.dot);
  root.setProperty("--j-ink", PAGE.ink);
  root.setProperty("--j-accent", PAGE.accent);
  root.setProperty("--j-accent-ink", PAGE.accentInk);
  root.setProperty("--j-soft", PAGE.soft);
  root.setProperty("--j-heading-font", `'${PAGE.headingFont}'`);
  buildEditor();

  $("journal-view").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) openEditor(Number(add.dataset.add));
    const tile = e.target.closest("[data-entry]");
    if (tile) openViewer(Number(tile.dataset.entry));
  });
  $("j-viewer").addEventListener("click", onViewerClick);
}

// ---------- Journal page ----------

export function renderJournal() {
  loadFonts();
  const view = $("journal-view");
  view.innerHTML = ctx.players().filter((p) => ctx.passFor(p).journal).map(journalHtml).join("");
  watchPhotos(view);
}

function journalHtml(player) {
  const { prize, title } = ctx.passFor(player).journal;
  const mine = isMine(player);
  const token = tokenFor(player, prize);
  const entries = [...(player.journal ?? [])].reverse(); // newest first
  const thing = prize.toLowerCase();
  const things = (n) => `${n} ${thing}${n === 1 ? "" : "s"}`;

  const sub = [
    entries.length ? things(entries.length) : "",
    token ? `${token.prize.icon} ${token.left} ${token.left === 1 ? "token" : "tokens"} to spend` : "",
  ].filter(Boolean);

  const tiles = entries.length
    ? entries.map((e) => polaroidHtml({ ...e, tag: "button", attrs: `type="button" data-entry="${e.id}"` })).join("")
    : `<p class="j-empty">${mine ? `Your first ${thing} goes here!` : `No ${thing}s yet.`}</p>`;

  return `
    <section class="journal">
      <header class="j-head">
        <div>
          <h2>${escapeHtml(`${token?.prize.icon ?? "📔"} ${player.name}'s ${title}`)}</h2>
          <p class="j-sub">${sub.map(escapeHtml).join(" · ")}</p>
        </div>
        ${mine ? `<button class="j-add" type="button" data-add="${player.id}">＋ Add a ${escapeHtml(thing)}</button>` : ""}
      </header>
      <div class="j-grid">${tiles}</div>
    </section>`;
}

// ---------- Polaroids ----------

const pick = (list, id, fallback) => list.find((o) => o.id === id) ?? list.find((o) => o.id === fallback) ?? list[0];

// The palette choices behind a saved style. Anything unknown falls back to the default.
function resolveStyle(style = {}) {
  return {
    frame: pick(FRAMES, style.frame, DEFAULT_STYLE.frame),
    backdrop: pick(BACKDROPS, style.backdrop, DEFAULT_STYLE.backdrop),
    tape: pick(TAPES, style.tape, DEFAULT_STYLE.tape),
    font: pick(FONTS, style.font, DEFAULT_STYLE.font),
  };
}

// A backdrop tile with the polaroid taped to it. `src` is a photo to show
// straight away; otherwise the photo for entry `id` loads when it's in view.
function polaroidHtml({ id, name, date, style, src, tilt, tag = "div", attrs = "" }) {
  const s = resolveStyle(style);
  const vars = [
    `--bd: ${s.backdrop.hex}`,
    `--bd-pat: ${s.backdrop.patternHex ?? "transparent"}`,
    `--frame: ${s.frame.hex}`,
    `--ink: ${s.frame.ink}`,
    `--tape: ${s.tape.hex}`,
    `--tape-pat: ${s.tape.patternHex ?? "transparent"}`,
    `--name-font: '${s.font.family}'`,
    `--name-weight: ${s.font.weight}`,
    `--name-scale: ${s.font.scale}`,
    `--fit: ${nameFit(name)}`,
    `--tilt: ${tilt ?? (id ? TILTS[id % TILTS.length] : -2)}deg`,
  ].join("; ");

  const photo = src
    ? `<img alt="" src="${escapeHtml(src)}">`
    : id
    ? `<img alt="" data-photo="${id}">`
    : `<span class="photo-empty" aria-hidden="true">📷</span>`;

  return `
    <${tag} class="tile bd-${s.backdrop.pattern}" style="${escapeHtml(vars)}" ${attrs}>
      <span class="polaroid">
        <span class="tape tape-${s.tape.pattern}" aria-hidden="true"></span>
        <span class="photo">${photo}</span>
        <span class="caption">
          <span class="pname">${escapeHtml(name || "")}</span>
          <span class="pdate">${date ? escapeHtml(fmtDay(date, { year: "numeric" })) : ""}</span>
        </span>
      </span>
    </${tag}>`;
}

// Long names get smaller so they still fit on one line.
function nameFit(name = "") {
  const fits = 11; // characters that fit at full size
  return name.length > fits ? Math.max(0.55, fits / name.length).toFixed(2) : 1;
}

// ---------- Photos ----------

const photos = new Map(); // entry id -> Promise of its data: URL

function photoFor(id) {
  if (!photos.has(id)) {
    const loading = rpc("get_journal_photo", { p_code: ctx.code(), p_entry_id: id });
    loading.catch(() => photos.delete(id)); // try again next time it's shown
    photos.set(id, loading);
  }
  return photos.get(id);
}

async function showPhoto(img) {
  const frame = img.closest(".photo");
  try {
    const src = await photoFor(Number(img.dataset.photo));
    if (!src) throw new Error("No photo"); // removed since the page loaded
    img.src = src;
  } catch {
    frame?.classList.add("failed");
  }
}

const observer =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (seen) => {
          for (const e of seen) {
            if (!e.isIntersecting) continue;
            observer.unobserve(e.target);
            showPhoto(e.target);
          }
        },
        { rootMargin: "300px" }
      )
    : null;

function watchPhotos(root) {
  for (const img of root.querySelectorAll("img[data-photo]")) {
    if (observer) observer.observe(img);
    else showPhoto(img);
  }
}

// Crops the middle square of a photo and shrinks it to a JPEG data: URL.
export async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(PHOTO_SIZE, side);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; // transparent PNGs would otherwise turn black
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The handwriting fonts come from Google Fonts, loaded the first time the journal opens.
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  const families = [...new Map(
    [...FONTS, { family: PAGE.headingFont, weight: 700 }].map((f) => [`${f.family}:${f.weight}`, f])
  ).values()];
  const byFamily = new Map();
  for (const f of families) byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f.weight]);
  const query = [...byFamily]
    .map(([family, weights]) => `family=${family.replace(/ /g, "+")}:wght@${[...new Set(weights)].sort((a, b) => a - b).join(";")}`)
    .join("&");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  document.head.append(link);
}

// ---------- Viewing one entry ----------

let viewing = null; // { player, entry }

function findEntry(id) {
  for (const player of ctx.players()) {
    const entry = (player.journal ?? []).find((e) => e.id === id);
    if (entry) return { player, entry };
  }
  return null;
}

function openViewer(id) {
  viewing = findEntry(id);
  if (!viewing) return;
  const { player, entry } = viewing;
  const spend = (player.spends ?? []).find((s) => s.id === entry.spendId);
  const icon = tokenFor(player, ctx.passFor(player).journal.prize)?.prize.icon ?? "";

  $("j-viewer").innerHTML = `
    <div class="sheet-bar">
      <h2>${escapeHtml(entry.name)}</h2>
      <button class="sheet-close" type="button" data-close aria-label="Close">✕</button>
    </div>
    <div class="j-big">${polaroidHtml({ ...entry, tilt: 0 })}</div>
    <p class="j-meta">${
      spend
        ? `${escapeHtml(icon)} Bought with the token used on ${escapeHtml(fmtDay(spend.date, { year: "numeric" }))}`
        : `Added for ${escapeHtml(fmtDay(entry.date, { year: "numeric" }))}`
    }</p>
    ${
      isMine(player)
        ? `<div class="j-actions">
             <button type="button" data-edit>Edit</button>
             <button type="button" class="link danger" data-delete>Remove from journal</button>
           </div>
           <p class="error" id="j-viewer-error"></p>`
        : ""
    }`;
  watchPhotos($("j-viewer"));
  $("j-viewer").showModal();
}

async function onViewerClick(e) {
  const dialog = $("j-viewer");
  if (e.target === dialog || e.target.closest("[data-close]")) return dialog.close(); // backdrop or ✕
  if (!viewing) return;
  const { player, entry } = viewing;

  if (e.target.closest("[data-edit]")) {
    dialog.close();
    openEditor(player.id, { entry });
  } else if (e.target.closest("[data-delete]")) {
    if (!confirm(`Remove ${entry.name} from the journal? The token stays used.`)) return;
    try {
      const state = await rpc("delete_journal_entry", { p_code: ctx.code(), p_player_id: player.id, p_entry_id: entry.id });
      dialog.close();
      ctx.apply(state);
    } catch (err) {
      $("j-viewer-error").textContent = `Couldn't remove it: ${err.message}`;
    }
  }
}

// ---------- Adding or changing an entry ----------

// What's being edited: { player, entry (when changing one), photo (new data: URL), style }
let draft = null;

function swatchGroup(name, legend, options, inner) {
  return `
    <fieldset class="swatches swatches-${name}">
      <legend>${legend}</legend>
      <div class="swatch-row">
        ${options
          .map(
            (o) => `
              <label class="swatch" title="${escapeHtml(o.label)}">
                <input type="radio" name="${name}" value="${escapeHtml(o.id)}">
                ${inner(o)}
              </label>`
          )
          .join("")}
      </div>
    </fieldset>`;
}

function buildEditor() {
  const dialog = $("j-editor");
  dialog.innerHTML = `
    <form id="j-form" class="j-form">
      <div class="j-sticky">
        <div class="sheet-bar">
          <h2 id="j-title"></h2>
          <button class="sheet-close" type="button" data-close aria-label="Close">✕</button>
        </div>
        <div class="j-preview" id="j-preview"></div>
      </div>
      <div class="j-fields">
        <label class="j-photo-btn">
          <span id="j-photo-label">📷 Choose a photo</span>
          <input id="j-photo" type="file" accept="image/*">
        </label>
        <label for="j-name">Name</label>
        <input id="j-name" maxlength="${NAME_MAX}" autocomplete="off" placeholder="e.g. Mr Buttons" required>
        <label for="j-date">Date</label>
        <input id="j-date" type="date" required>
        ${swatchGroup("font", "Font", FONTS, (f) =>
          `<span class="sw-font" style="${escapeHtml(`font-family: '${f.family}', cursive; font-weight: ${f.weight}; font-size: ${1.15 * f.scale}rem`)}">${escapeHtml(f.label)}</span>`)}
        ${swatchGroup("frame", "Frame", FRAMES, (f) =>
          `<span class="sw-frame" style="${escapeHtml(`--frame: ${f.hex}; --ink: ${f.ink}`)}">Aa</span>`)}
        ${swatchGroup("backdrop", "Background", BACKDROPS, (b) =>
          `<span class="sw-backdrop bd-${b.pattern}" style="${escapeHtml(`--bd: ${b.hex}; --bd-pat: ${b.patternHex ?? "transparent"}`)}"></span>`)}
        ${swatchGroup("tape", "Tape", TAPES, (t) =>
          `<span class="sw-tape tape-${t.pattern}" style="${escapeHtml(`--tape: ${t.hex}; --tape-pat: ${t.patternHex ?? "transparent"}`)}"></span>`)}
        <div id="j-token-row" class="j-token-row">
          <label for="j-token">Token</label>
          <select id="j-token"></select>
        </div>
        <p class="error" id="j-error"></p>
        <button type="submit" id="j-save">Save to journal</button>
      </div>
    </form>`;

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
  $("j-form").addEventListener("input", updatePreview);
  $("j-form").addEventListener("submit", saveEntry);
  $("j-photo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $("j-error").textContent = "";
    $("j-photo-label").textContent = "Shrinking photo…";
    try {
      draft.photo = await shrinkPhoto(file);
    } catch {
      $("j-error").textContent = "Couldn't read that photo. Try a different one, or a JPEG or PNG.";
    }
    updatePreview();
  });
}

// Opens the editor for a new entry, or for `entry` to change it. `token: "new"`
// starts with "use a new token" chosen (when coming from the token button).
export function openEditor(playerId, { entry = null, token = null } = {}) {
  loadFonts();
  const player = ctx.players().find((p) => p.id === playerId);
  const { prize } = ctx.passFor(player).journal;
  draft = { player, entry, photo: null };

  $("j-title").textContent = entry ? `Edit ${entry.name}` : `New ${prize.toLowerCase()}`;
  $("j-photo").value = "";
  $("j-name").value = entry?.name ?? "";
  $("j-date").value = entry?.date ?? today();
  $("j-date").max = today();
  $("j-error").textContent = "";

  const style = { ...DEFAULT_STYLE, ...resolveIds(entry?.style) };
  for (const key of ["font", "frame", "backdrop", "tape"]) {
    const input = $("j-form").querySelector(`input[name="${key}"][value="${CSS.escape(style[key])}"]`);
    if (input) input.checked = true;
  }

  // Which token this was bought with. Only asked for new entries.
  $("j-token-row").hidden = Boolean(entry);
  if (!entry) $("j-token").innerHTML = tokenOptions(player, prize, token);

  updatePreview();
  $("j-editor").showModal();
  $("j-editor").scrollTop = 0;
}

// Saved style ids that still exist in the palette.
function resolveIds(style) {
  const s = resolveStyle(style);
  return { font: s.font.id, frame: s.frame.id, backdrop: s.backdrop.id, tape: s.tape.id };
}

// Choices for the token: one already spent but not in the journal yet, a new
// one if there are any left, or none.
function tokenOptions(player, prize, preferred) {
  const token = tokenFor(player, prize);
  if (!token) return `<option value="">No token</option>`;
  const icon = token.prize.icon;
  const inJournal = new Set((player.journal ?? []).map((e) => e.spendId));
  const unlinked = token.spends.filter((s) => !inJournal.has(s.id)).reverse();

  const options = [
    ...unlinked.map((s) => ({ value: String(s.id), text: `${icon} The token used on ${fmtDay(s.date)}` })),
    ...(token.left ? [{ value: "new", text: `${icon} Use a new token (${token.left} left)` }] : []),
    { value: "", text: "No token" },
  ];
  const chosen = preferred === "new" && token.left ? "new" : options[0].value;
  return options
    .map((o) => `<option value="${escapeHtml(o.value)}"${o.value === chosen ? " selected" : ""}>${escapeHtml(o.text)}</option>`)
    .join("");
}

function formStyle() {
  const form = $("j-form");
  const value = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
  return { font: value("font"), frame: value("frame"), backdrop: value("backdrop"), tape: value("tape") };
}

function updatePreview() {
  draft.style = formStyle();
  const existing = draft.entry && !draft.photo;
  $("j-preview").innerHTML = polaroidHtml({
    id: existing ? draft.entry.id : null,
    src: draft.photo,
    name: $("j-name").value.trim() || "Name me!",
    date: $("j-date").value,
    style: draft.style,
    tilt: -2,
  });
  if (existing) watchPhotos($("j-preview"));

  const hasPhoto = Boolean(draft.photo || draft.entry);
  $("j-photo-label").textContent = hasPhoto ? "📷 Change photo" : "📷 Choose a photo";
  $("j-save").disabled = !hasPhoto || !$("j-name").value.trim();
}

async function saveEntry(e) {
  e.preventDefault();
  const { player, entry, photo, style } = draft;
  const token = $("j-token").value;
  $("j-save").disabled = true;
  $("j-error").textContent = "";
  const before = new Set((player.journal ?? []).map((x) => x.id));

  try {
    const state = await rpc("save_journal_entry", {
      p_code: ctx.code(),
      p_player_id: player.id,
      p_entry_id: entry?.id ?? null,
      p_name: $("j-name").value.trim(),
      p_date: $("j-date").value,
      p_photo: photo,
      p_style: style,
      p_spend_id: !entry && /^\d+$/.test(token) ? Number(token) : null,
      p_new_token: !entry && token === "new" ? ctx.passFor(player).journal.prize : null,
    });

    // Show the new photo straight away instead of downloading it again.
    if (photo) {
      const saved = state.players.find((p) => p.id === player.id);
      const id = entry?.id ?? saved?.journal.find((x) => !before.has(x.id))?.id;
      if (id) photos.set(id, Promise.resolve(photo));
    }
    $("j-editor").close();
    ctx.apply(state);
  } catch (err) {
    $("j-error").textContent = `Couldn't save: ${err.message}`;
    $("j-save").disabled = false;
  }
}

// ---------- Helpers ----------

function isMine(player) {
  return String(player.id) === ctx.myId();
}

function tokenFor(player, prizeName) {
  return ctx.tokensFor(player).find((t) => t.prize.name === prizeName);
}
