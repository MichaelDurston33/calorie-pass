// The photo journal: one polaroid per thing bought with a prize token (Abbie's
// plushies), and at the top, a group photo of them all brought to life.
// Turned on for someone by `journal` in passes.js; the colours and fonts to
// choose from are in journal-palette.js.
//
// Photos are cropped square and shrunk to an 800x800 JPEG in the browser before
// saving, so each is roughly 100 KB. The page state has entries without their
// photos; each photo is fetched once its polaroid scrolls into view.
//
// Group photos are drawn by OpenAI from the plushies' photos. The page asks the
// group-photo Edge Function to start one (supabase/functions/group-photo), shows
// it "developing", and checks back every few seconds until it's done.

import {
  BACKDROPS, DEFAULT_GROUP_STYLE, DEFAULT_STYLE, FONTS, FRAMES, GROUP_IDEAS, PAGE, SPECIES, TAPES,
} from "./journal-palette.js";
import { $, callFunction, escapeHtml, fmtDay, rpc, today } from "./util.js";

const PHOTO_SIZE = 800;
const PHOTO_QUALITY = 0.82;
const NAME_MAX = 24;
const CAPTION_MAX = 40;
const PROMPT_MAX = 150;
const GROUP_MAX = 16; // plushies in one group photo
const DEVELOPING_FOR = 5 * 60_000; // after this a group photo has stalled (the server agrees)
const CHECK_EVERY = 5000;

// Each polaroid sits at a slight angle, always the same one for the same entry.
const TILTS = [-2.5, 1.8, -1.2, 2.6, -1.8, 1.2];

// From app.js: { code(), myId(), players(), passFor(player), tokensFor(player), apply(state), refresh() }
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
  buildGroupMaker();

  $("journal-view").addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) openEditor(Number(add.dataset.add));
    const make = e.target.closest("[data-make]");
    if (make) openGroupMaker(Number(make.dataset.make));
    const tile = e.target.closest("[data-entry]");
    if (tile) openViewer(Number(tile.dataset.entry));
    const group = e.target.closest("[data-group]");
    if (group) openGroupViewer(Number(group.dataset.group));
  });
  $("j-viewer").addEventListener("click", onViewerClick);
}

// ---------- Journal page ----------

export function renderJournal() {
  loadFonts();
  const view = $("journal-view");
  const people = ctx.players().filter((p) => ctx.passFor(p).journal);
  view.innerHTML = people.map(journalHtml).join("");
  watchPhotos(view);
  checkBackIfDeveloping(people);
}

function journalHtml(player) {
  const { prize, groupPrize, title } = ctx.passFor(player).journal;
  const mine = isMine(player);
  const token = tokenFor(player, prize);
  const groupToken = groupPrize && tokenFor(player, groupPrize);
  const group = groupState(player);
  const entries = [...(player.journal ?? [])].reverse(); // newest first
  const thing = prize.toLowerCase();
  const things = (n) => `${n} ${thing}${n === 1 ? "" : "s"}`;

  const tokens = [token, groupToken].filter(Boolean).map((t) => `${t.prize.icon} ${t.left}`);
  const sub = [entries.length ? things(entries.length) : "", tokens.length ? `${tokens.join(" · ")} to spend` : ""]
    .filter(Boolean);
  const canMake = mine && groupToken?.left > 0 && !group.developing && entries.length > 0;

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
        ${
          mine
            ? `<div class="j-buttons">
                 <button class="j-add" type="button" data-add="${player.id}">＋ Add a ${escapeHtml(thing)}</button>
                 ${canMake && group.shown ? `<button class="j-add j-make" type="button" data-make="${player.id}">📸 Group photo</button>` : ""}
               </div>`
            : ""
        }
      </header>
      ${groupPrize ? heroHtml(player, group, { mine, canMake, groupToken }) : ""}
      <div class="j-grid">${tiles}</div>
    </section>`;
}

// The group photo, between the title and the plushies: the one being drawn,
// the one on show, or a space for the first one.
function heroHtml(player, group, { mine, canMake, groupToken }) {
  const notice =
    mine && group.failed
      ? `<p class="j-notice">📸 The last group photo didn't work: ${escapeHtml(group.failed.error || "something went wrong")}
           Your token wasn't used.${canMake ? ` <button class="link" type="button" data-make="${player.id}">Try again</button>` : ""}</p>`
      : "";

  if (group.developing) {
    const g = group.developing;
    return `${bandHtml(g.style, polaroidHtml({ ...g, name: g.caption, wide: true, developing: true, tilt: -1 }))}${notice}`;
  }
  if (group.shown) {
    const g = group.shown;
    const fresh = Date.now() - Date.parse(g.shownAt) < 3 * 60_000;
    return `${bandHtml(
      g.style,
      polaroidHtml({ ...g, name: g.caption, wide: true, kind: "group", tilt: -1, tag: "button",
                     attrs: `type="button" data-group="${g.id}"${fresh ? ' data-fresh=""' : ""}` })
    )}${notice}`;
  }
  if (!mine) return "";
  const icon = groupToken?.prize.icon ?? "📸";
  return `
    <div class="j-hero j-hero-empty">
      <p>${icon} Your plushies' first group photo goes here!</p>
      ${canMake ? `<button class="j-add" type="button" data-make="${player.id}">${icon} Make a group photo</button>` : ""}
    </div>${notice}`;
}

// The full-width strip of backdrop paper the group photo is taped to.
function bandHtml(style, inner) {
  const s = resolveStyle(style, DEFAULT_GROUP_STYLE);
  const vars = `--bd: ${s.backdrop.hex}; --bd-pat: ${s.backdrop.patternHex ?? "transparent"}`;
  return `<div class="j-hero bd-${s.backdrop.pattern}" style="${escapeHtml(vars)}">${inner}</div>`;
}

// Someone's group photos: the one developing, the last failed attempt (if
// that was the latest thing to happen), the done ones, and the one on show.
function groupState(player) {
  const all = player.groupPhotos ?? [];
  const latest = all[all.length - 1];
  const stalled = latest?.status === "pending" && Date.now() - Date.parse(latest.createdAt) > DEVELOPING_FOR;
  const done = all.filter((g) => g.status === "done");
  const shown = [...done].sort((a, b) => String(a.shownAt).localeCompare(String(b.shownAt))).pop();
  return {
    developing: latest?.status === "pending" && !stalled ? latest : null,
    failed: latest?.status === "failed" || stalled ? { ...latest, error: latest.error || "It took too long." } : null,
    done,
    shown,
  };
}

// While a group photo is being drawn, check back every few seconds.
let checkTimer = null;
function checkBackIfDeveloping(people) {
  clearTimeout(checkTimer);
  if (!people.some((p) => groupState(p).developing)) return;
  checkTimer = setTimeout(async () => {
    if ($("journal-view").hidden) return;
    try {
      await ctx.refresh();
    } catch {
      checkBackIfDeveloping(people); // try again shortly
    }
  }, CHECK_EVERY);
}

// ---------- Polaroids ----------

const pick = (list, id, fallback) => list.find((o) => o.id === id) ?? list.find((o) => o.id === fallback) ?? list[0];

// The palette choices behind a saved style. Anything unknown falls back to the default.
function resolveStyle(style = {}, defaults = DEFAULT_STYLE) {
  style = style ?? {};
  return {
    frame: pick(FRAMES, style.frame, defaults.frame),
    backdrop: pick(BACKDROPS, style.backdrop, defaults.backdrop),
    tape: pick(TAPES, style.tape, defaults.tape),
    font: pick(FONTS, style.font, defaults.font),
  };
}

// A backdrop tile with the polaroid taped to it. `src` is a photo to show
// straight away; otherwise the photo for `id` loads when it's in view. `wide`
// is the landscape group photo (its band is drawn by bandHtml).
function polaroidHtml({ id, name, date, style, src, tilt, tag = "div", attrs = "", wide = false, kind = "entry", developing = false }) {
  const s = resolveStyle(style, wide ? DEFAULT_GROUP_STYLE : DEFAULT_STYLE);
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
    `--fit: ${nameFit(name, wide ? 24 : 11)}`,
    `--tilt: ${tilt ?? (id ? TILTS[id % TILTS.length] : -2)}deg`,
  ].join("; ");

  let photo;
  if (developing) {
    photo = `<span class="developing-text">📸 Developing…<small>This takes about a minute</small></span>`;
  } else if (src) photo = `<img alt="" src="${escapeHtml(src)}">`;
  else if (id) photo = `<img alt="" data-photo="${id}" data-kind="${kind}">`;
  else photo = `<span class="photo-empty" aria-hidden="true">📷</span>`;

  const tape = (n = "") => `<span class="tape tape-${s.tape.pattern}${n}" aria-hidden="true"></span>`;
  const cls = wide ? "tile wide" : `tile bd-${s.backdrop.pattern}`;

  return `
    <${tag} class="${cls}" style="${escapeHtml(vars)}" ${attrs}>
      <span class="polaroid">
        ${tape()}${wide ? tape(" tape-2") : ""}
        <span class="photo${developing ? " developing" : ""}">${photo}</span>
        <span class="caption">
          <span class="pname">${escapeHtml(name || "")}</span>
          <span class="pdate">${date ? escapeHtml(fmtDay(date, { year: "numeric" })) : ""}</span>
        </span>
      </span>
    </${tag}>`;
}

// Long names get smaller so they still fit on one line.
function nameFit(name = "", fits = 11) {
  return name.length > fits ? Math.max(0.55, fits / name.length).toFixed(2) : 1;
}

// ---------- Photos ----------

const photos = new Map(); // "entry:12" or "group:3" -> Promise of its data: URL

function photoFor(kind, id) {
  const key = `${kind}:${id}`;
  if (!photos.has(key)) {
    const loading =
      kind === "group"
        ? rpc("get_group_photo", { p_code: ctx.code(), p_id: id })
        : rpc("get_journal_photo", { p_code: ctx.code(), p_entry_id: id });
    loading.catch(() => photos.delete(key)); // try again next time it's shown
    photos.set(key, loading);
  }
  return photos.get(key);
}

async function showPhoto(img) {
  const frame = img.closest(".photo");
  try {
    const src = await photoFor(img.dataset.kind || "entry", Number(img.dataset.photo));
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

// ---------- Viewing one entry or group photo ----------

let viewing = null; // { player, entry } or { player, group }

function findEntry(id) {
  for (const player of ctx.players()) {
    const entry = (player.journal ?? []).find((e) => e.id === id);
    if (entry) return { player, entry };
  }
  return null;
}

function findGroup(id) {
  for (const player of ctx.players()) {
    const group = (player.groupPhotos ?? []).find((g) => g.id === id);
    if (group) return { player, group };
  }
  return null;
}

// "goat" -> "Goat"
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function openViewer(id) {
  viewing = findEntry(id);
  if (!viewing) return;
  const { player, entry } = viewing;
  const spend = (player.spends ?? []).find((s) => s.id === entry.spendId);
  const icon = tokenFor(player, ctx.passFor(player).journal.prize)?.prize.icon ?? "";
  const how = spend
    ? `${icon} Bought with the token used on ${fmtDay(spend.date, { year: "numeric" })}`
    : `Added for ${fmtDay(entry.date, { year: "numeric" })}`;

  $("j-viewer").innerHTML = `
    <div class="sheet-bar">
      <h2>${escapeHtml(entry.name)}</h2>
      <button class="sheet-close" type="button" data-close aria-label="Close">✕</button>
    </div>
    <div class="j-big">${polaroidHtml({ ...entry, tilt: 0 })}</div>
    <p class="j-meta">${escapeHtml([entry.species && capitalise(entry.species), how].filter(Boolean).join(" · "))}</p>
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
  if (!$("j-viewer").open) $("j-viewer").showModal();
}

function openGroupViewer(id) {
  viewing = findGroup(id);
  if (!viewing) return;
  const { player, group } = viewing;
  const state = groupState(player);
  const others = state.done.filter((g) => g.id !== id).reverse();
  const onShow = state.shown?.id === id;

  $("j-viewer").innerHTML = `
    <div class="sheet-bar">
      <h2>${escapeHtml(group.caption || "Group photo")}</h2>
      <button class="sheet-close" type="button" data-close aria-label="Close">✕</button>
    </div>
    <div class="j-big wide">${polaroidHtml({ ...group, name: group.caption, wide: true, kind: "group", tilt: 0 })}</div>
    <p class="j-meta">“${escapeHtml(group.prompt)}” · ${escapeHtml(fmtDay(group.date, { year: "numeric" }))}</p>
    ${
      isMine(player)
        ? `<div class="j-actions">
             <span class="j-actions-left">
               <button type="button" data-edit>Customise</button>
               ${onShow ? "" : `<button type="button" data-show>Show at the top</button>`}
             </span>
             <button type="button" class="link danger" data-delete>Remove</button>
           </div>
           <p class="error" id="j-viewer-error"></p>`
        : ""
    }
    ${
      others.length
        ? `<h3>${onShow ? "Older group photos" : "Other group photos"}</h3>
           <div class="j-others">${others
             .map((g) => `<button class="j-other" type="button" data-open-group="${g.id}" title="${escapeHtml(g.caption)}">
                            <img alt="${escapeHtml(g.caption)}" data-photo="${g.id}" data-kind="group">
                          </button>`)
             .join("")}</div>`
        : ""
    }`;
  watchPhotos($("j-viewer"));
  if (!$("j-viewer").open) $("j-viewer").showModal();
}

async function onViewerClick(e) {
  const dialog = $("j-viewer");
  if (e.target === dialog || e.target.closest("[data-close]")) return dialog.close(); // backdrop or ✕
  const other = e.target.closest("[data-open-group]");
  if (other) return openGroupViewer(Number(other.dataset.openGroup));
  if (!viewing) return;
  const { player, entry, group } = viewing;
  const call = async (fn, args, failed) => {
    try {
      const state = await rpc(fn, { p_code: ctx.code(), p_player_id: player.id, ...args });
      dialog.close();
      ctx.apply(state);
    } catch (err) {
      $("j-viewer-error").textContent = `${failed}: ${err.message}`;
    }
  };

  if (e.target.closest("[data-edit]")) {
    dialog.close();
    openEditor(player.id, entry ? { entry } : { group });
  } else if (e.target.closest("[data-show]")) {
    await call("show_group_photo", { p_id: group.id }, "Couldn't change it");
  } else if (e.target.closest("[data-delete]")) {
    const what = entry ? entry.name : "this group photo";
    if (!confirm(`Remove ${what} from the journal? The token stays used.`)) return;
    if (entry) await call("delete_journal_entry", { p_entry_id: entry.id }, "Couldn't remove it");
    else await call("delete_group_photo", { p_id: group.id }, "Couldn't remove it");
  }
}

// ---------- Adding or changing an entry, or customising a group photo ----------

// What's being edited: { player, entry or group (when changing one), photo (new data: URL), style }
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
        <label class="j-photo-btn" id="j-photo-row">
          <span id="j-photo-label">📷 Choose a photo</span>
          <input id="j-photo" type="file" accept="image/*">
        </label>
        <label for="j-name" id="j-name-label">Name</label>
        <input id="j-name" maxlength="${NAME_MAX}" autocomplete="off" placeholder="e.g. Mr Buttons" required>
        <div class="j-row" id="j-species-row">
          <label for="j-species">What animal are they? <span class="optional">(for group photos)</span></label>
          <input id="j-species" list="j-species-list" maxlength="40" autocomplete="off" placeholder="e.g. goat, bunny, frog">
          <datalist id="j-species-list">${SPECIES.map((s) => `<option value="${escapeHtml(s)}">`).join("")}</datalist>
        </div>
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
        <div id="j-token-row" class="j-row j-token-row">
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

// Opens the editor for a new entry, for `entry` to change it, or for `group`
// to customise a group photo. `token: "new"` starts with "use a new token"
// chosen (when coming from the token button).
export function openEditor(playerId, { entry = null, group = null, token = null } = {}) {
  loadFonts();
  const player = ctx.players().find((p) => p.id === playerId);
  const { prize } = ctx.passFor(player).journal;
  draft = { player, entry, group, photo: null };

  $("j-title").textContent = group ? "Customise group photo" : entry ? `Edit ${entry.name}` : `New ${prize.toLowerCase()}`;
  $("j-photo").value = "";
  $("j-photo-row").hidden = Boolean(group);
  $("j-species-row").hidden = Boolean(group);
  $("j-name-label").textContent = group ? "Caption" : "Name";
  $("j-name").maxLength = group ? CAPTION_MAX : NAME_MAX;
  $("j-name").placeholder = group ? "e.g. Camping trip!" : "e.g. Mr Buttons";
  $("j-name").value = (group ? group.caption : entry?.name) ?? "";
  $("j-species").value = entry?.species ?? "";
  $("j-date").value = group?.date ?? entry?.date ?? today();
  $("j-date").max = today();
  $("j-error").textContent = "";
  $("j-save").textContent = group ? "Save" : "Save to journal";
  $("j-preview").classList.toggle("wide", Boolean(group));

  const style = resolveIds((group ?? entry)?.style, group ? DEFAULT_GROUP_STYLE : DEFAULT_STYLE);
  for (const key of ["font", "frame", "backdrop", "tape"]) {
    const input = $("j-form").querySelector(`input[name="${key}"][value="${CSS.escape(style[key])}"]`);
    if (input) input.checked = true;
  }

  // Which token this was bought with. Only asked for new entries.
  $("j-token-row").hidden = Boolean(entry || group);
  if (!entry && !group) $("j-token").innerHTML = tokenOptions(player, prize, token);

  updatePreview();
  $("j-editor").showModal();
  $("j-editor").scrollTop = 0;
}

// Saved style ids that still exist in the palette.
function resolveIds(style, defaults) {
  const s = resolveStyle(style, defaults);
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
  const { entry, group } = draft;
  const name = $("j-name").value.trim();
  const preview = $("j-preview");

  if (group) {
    preview.innerHTML = bandHtml(
      draft.style,
      polaroidHtml({ id: group.id, kind: "group", wide: true, name, date: $("j-date").value, style: draft.style, tilt: -1 })
    );
    watchPhotos(preview);
    $("j-save").disabled = false;
    return;
  }

  const existing = entry && !draft.photo;
  preview.innerHTML = polaroidHtml({
    id: existing ? entry.id : null,
    src: draft.photo,
    name: name || "Name me!",
    date: $("j-date").value,
    style: draft.style,
    tilt: -2,
  });
  if (existing) watchPhotos(preview);

  const hasPhoto = Boolean(draft.photo || entry);
  $("j-photo-label").textContent = hasPhoto ? "📷 Change photo" : "📷 Choose a photo";
  $("j-save").disabled = !hasPhoto || !name;
}

async function saveEntry(e) {
  e.preventDefault();
  const { player, entry, group, photo, style } = draft;
  const token = $("j-token").value;
  $("j-save").disabled = true;
  $("j-error").textContent = "";
  const before = new Set((player.journal ?? []).map((x) => x.id));

  try {
    const state = group
      ? await rpc("save_group_photo", {
          p_code: ctx.code(),
          p_player_id: player.id,
          p_id: group.id,
          p_caption: $("j-name").value.trim(),
          p_date: $("j-date").value,
          p_style: style,
        })
      : await rpc("save_journal_entry", {
          p_code: ctx.code(),
          p_player_id: player.id,
          p_entry_id: entry?.id ?? null,
          p_name: $("j-name").value.trim(),
          p_date: $("j-date").value,
          p_photo: photo,
          p_style: style,
          p_spend_id: !entry && /^\d+$/.test(token) ? Number(token) : null,
          p_new_token: !entry && token === "new" ? ctx.passFor(player).journal.prize : null,
          p_species: $("j-species").value.trim().toLowerCase() || null,
        });

    // Show the new photo straight away instead of downloading it again.
    if (photo) {
      const saved = state.players.find((p) => p.id === player.id);
      const id = entry?.id ?? saved?.journal.find((x) => !before.has(x.id))?.id;
      if (id) photos.set(`entry:${id}`, Promise.resolve(photo));
    }
    $("j-editor").close();
    ctx.apply(state);
  } catch (err) {
    $("j-error").textContent = `Couldn't save: ${err.message}`;
    $("j-save").disabled = false;
  }
}

// ---------- Making a group photo ----------

let making = null; // the player whose group photo is being set up

function buildGroupMaker() {
  const dialog = $("j-group");
  dialog.innerHTML = `
    <form id="g-form" class="g-form">
      <div class="sheet-bar">
        <h2>📸 New group photo</h2>
        <button class="sheet-close" type="button" data-close aria-label="Close">✕</button>
      </div>
      <p class="g-intro">Your plushies come to life together in one picture!</p>
      <fieldset class="g-cast">
        <legend>Who's in it?</legend>
        <div class="g-cast-list" id="g-cast"></div>
      </fieldset>
      <p class="g-tip" id="g-tip" hidden></p>
      <label for="g-prompt">What are they doing?</label>
      <textarea id="g-prompt" rows="2" maxlength="${PROMPT_MAX}" placeholder="e.g. all camping together under the stars" required></textarea>
      <div class="g-ideas">
        ${GROUP_IDEAS.map((i) => `<button type="button" class="g-idea" data-idea="${escapeHtml(i.text)}">${escapeHtml(i.label)}</button>`).join("")}
      </div>
      <p class="muted" id="g-cost"></p>
      <p class="error" id="g-error"></p>
      <button type="submit" id="g-go" class="j-add">📸 Take the group photo</button>
    </form>`;

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || e.target.closest("[data-close]")) return dialog.close();
    const idea = e.target.closest("[data-idea]");
    if (idea) {
      $("g-prompt").value = idea.dataset.idea;
      updateGroupMaker();
    }
  });
  $("g-form").addEventListener("input", updateGroupMaker);
  $("g-form").addEventListener("submit", startGroupPhoto);
}

export function openGroupMaker(playerId) {
  loadFonts();
  const player = ctx.players().find((p) => p.id === playerId);
  const { groupPrize } = ctx.passFor(player).journal;
  const token = tokenFor(player, groupPrize);
  making = player;

  $("g-cast").innerHTML = (player.journal ?? [])
    .map(
      (e, i) => `
        <label class="g-chip">
          <input type="checkbox" value="${e.id}"${i < GROUP_MAX ? " checked" : ""}>
          <img alt="" data-photo="${e.id}" data-kind="entry">
          <span>${escapeHtml(e.name)}<small>${escapeHtml(e.species ?? "what animal?")}</small></span>
        </label>`
    )
    .join("");
  $("g-prompt").value = "";
  $("g-error").textContent = "";
  $("g-cost").textContent =
    `Takes about a minute. Uses 1 ${token?.prize.icon ?? "📸"} token (${token?.left ?? 0} left), ` +
    "but only once the picture is ready.";
  watchPhotos($("g-cast"));
  updateGroupMaker();
  $("j-group").showModal();
  $("j-group").scrollTop = 0;
}

function chosenPlushies() {
  return [...$("g-cast").querySelectorAll("input:checked")].map((i) => Number(i.value));
}

function updateGroupMaker() {
  const ids = chosenPlushies();
  const unknown = (making.journal ?? []).filter((e) => ids.includes(e.id) && !e.species).map((e) => e.name);
  $("g-tip").hidden = !unknown.length;
  $("g-tip").textContent = unknown.length
    ? `Tip: say what animal ${listNames(unknown)} ${unknown.length === 1 ? "is" : "are"} (tap them in the journal, then Edit) so they come out right.`
    : "";
  const tooMany = ids.length > GROUP_MAX;
  $("g-error").textContent = tooMany ? `Up to ${GROUP_MAX} plushies fit in one photo.` : "";
  $("g-go").disabled = !ids.length || tooMany || !$("g-prompt").value.trim();
}

// "Mochi", "Mochi and Bun Bun", "Mochi, Bun Bun and Waddles"
function listNames(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

async function startGroupPhoto(e) {
  e.preventDefault();
  $("g-go").disabled = true;
  $("g-error").textContent = "";
  try {
    await callFunction("group-photo", {
      code: ctx.code(),
      playerId: making.id,
      prize: ctx.passFor(making).journal.groupPrize,
      prompt: $("g-prompt").value.trim(),
      entryIds: chosenPlushies(),
      date: today(),
    });
    $("j-group").close();
    window.scrollTo(0, 0);
    await ctx.refresh(); // shows it developing
  } catch (err) {
    $("g-error").textContent = `Couldn't start it: ${err.message}`;
    $("g-go").disabled = false;
  }
}

// ---------- Helpers ----------

function isMine(player) {
  return String(player.id) === ctx.myId();
}

function tokenFor(player, prizeName) {
  return ctx.tokensFor(player).find((t) => t.prize.name === prizeName);
}
