import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { PASSES, TIMELINE_LENGTH } from "./passes.js";

const CODE_KEY = "calorie-pass-code";
const PLAYER_KEY = "calorie-pass-player";

const $ = (id) => document.getElementById(id);

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

// Browser-local date as YYYY-MM-DD.
function today() {
  return new Date().toLocaleDateString("en-CA");
}

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`);
  return body;
}

// ---------- State ----------
// The code and who's using this device are remembered, so each is only asked for once.

let code = storageGet(CODE_KEY);
let myId = storageGet(PLAYER_KEY);
let players = [];

// ---------- Screens ----------

function showScreen(name) {
  for (const id of ["login", "pick", "main"]) $(id).hidden = id !== name;
}

function showLogin(error = "") {
  showScreen("login");
  $("login-error").textContent = error;
}

// The main screen if we know who's on this device, otherwise ask.
function show() {
  const me = players.find((p) => String(p.id) === myId);
  if (me) showMain(me);
  else showPicker();
}

function showPicker() {
  showScreen("pick");
  $("pick-buttons").innerHTML = inPassOrder(players)
    .map((p) => {
      const pass = passFor(p);
      return `
        <button class="pick-btn" type="button" data-id="${p.id}" style="${escapeHtml(themeStyle(pass.colors))}">
          ${pass.emoji ? `<span class="pick-emoji">${escapeHtml(pass.emoji)}</span>` : ""}
          <span>${escapeHtml(p.name)}</span>
        </button>`;
    })
    .join("");
}

function showMain(me) {
  showScreen("main");
  $("me").textContent = displayName(me);
  $("status").textContent =
    me.today_calories != null
      ? `Logged today: ${me.today_calories} kcal. Submit again to correct it.`
      : "Not logged today yet.";
  renderPasses(players);
}

function renderPasses(players) {
  $("passes").innerHTML = inPassOrder(players).map(renderPass).join("");

  // Start each timeline centred on the next tier to earn.
  for (const timeline of document.querySelectorAll(".timeline")) {
    const next = timeline.querySelector(".tier.next");
    if (next) timeline.scrollLeft = next.offsetLeft - (timeline.clientWidth - next.offsetWidth) / 2;
  }
}

// First tier after `days` where a prize repeating `every` N tiers unlocks.
function nextPrizeTier(days, every) {
  return (Math.floor(days / every) + 1) * every;
}

function passFor(player) {
  return PASSES[player.name] ?? { prizes: [] };
}

// Position in passes.js; anyone not listed there goes last.
function passRank(player) {
  const names = Object.keys(PASSES);
  const index = names.indexOf(player.name);
  return index === -1 ? names.length : index;
}

function inPassOrder(players) {
  return [...players].sort((a, b) => passRank(a) - passRank(b));
}

// "🐝 Abbie"
function displayName(player) {
  const emoji = passFor(player).emoji;
  return emoji ? `${emoji} ${player.name}` : player.name;
}

function renderPass(player) {
  const days = player.days_logged;
  const pass = passFor(player);
  const upcoming = pass.prizes.map((p) => ({ ...p, tier: nextPrizeTier(days, p.every) }));

  // The pass never ends: show TIMELINE_LENGTH tiers, extending by that much
  // each time the end is reached, and always far enough to show one of each
  // prize still to come.
  const end = Math.max(
    Math.ceil((days + 1) / TIMELINE_LENGTH) * TIMELINE_LENGTH,
    ...upcoming.map((p) => p.tier)
  );
  const tiers = [];
  for (let t = 1; t <= end; t++) tiers.push(renderTier(t, days, pass.prizes));

  return `
    <section class="pass" style="${escapeHtml(themeStyle(pass.colors))}">
      <header class="pass-head">
        <div class="who">
          ${pass.emoji ? `<span class="avatar" aria-hidden="true">${escapeHtml(pass.emoji)}</span>` : ""}
          <div>
            <h2>${escapeHtml(player.name)}</h2>
            ${
              player.today_calories != null
                ? `<span class="today is-done">✓ Logged today</span>`
                : `<span class="today">Not logged today</span>`
            }
          </div>
        </div>
        <div class="tier-big"><span>Tier</span><strong>${days}</strong></div>
      </header>
      <div class="timeline-wrap">
        <button class="scroll-btn" type="button" data-dir="-1" aria-label="Scroll back">‹</button>
        <div class="timeline"><ol class="tiers">${tiers.join("")}</ol></div>
        <button class="scroll-btn" type="button" data-dir="1" aria-label="Scroll forward">›</button>
      </div>
      ${renderFooter(days, pass.prizes, upcoming)}
    </section>`;
}

function renderTier(t, days, prizes) {
  const rewards = prizes.filter((p) => t % p.every === 0);
  const earned = t <= days;
  const cls = ["tier", earned && "done", t === days + 1 && "next", rewards.length && "has-prize"]
    .filter(Boolean)
    .join(" ");
  const title = rewards.length ? `Tier ${t}: ${rewards.map((r) => r.name).join(" + ")}` : `Tier ${t}`;

  const cards = rewards
    .map(
      (r) => `
        <div class="reward${earned ? " earned" : ""}">
          ${earned ? `<span class="check" aria-label="Earned">✓</span>` : ""}
          <span class="reward-icon">${escapeHtml(r.icon)}</span>
          <span class="reward-name">${escapeHtml(r.name)}</span>
        </div>`
    )
    .join("");

  return `
    <li class="${cls}" title="${escapeHtml(title)}">
      <span class="tier-num">${t}</span>
      <span class="rail"><span class="node"></span></span>
      ${cards}
    </li>`;
}

function renderFooter(days, prizes, upcoming) {
  if (!prizes.length) return "";

  const soonest = Math.min(...upcoming.map((p) => p.tier));
  const toGo = soonest - days;
  const nextNames = upcoming
    .filter((p) => p.tier === soonest)
    .map((p) => `${p.icon} ${p.name}`)
    .join(" + ");
  const earned = prizes.map((p) => `${p.icon} ×${Math.floor(days / p.every)}`).join(" · ");

  return `
    <p class="pass-foot">
      <span>Next: <strong>${escapeHtml(nextNames)}</strong> in ${toGo} ${toGo === 1 ? "day" : "days"}</span>
      <span>Earned: ${escapeHtml(earned)}</span>
    </p>`;
}

// { prizeInk: "#fff" } -> "--pass-prize-ink: #fff"
function themeStyle(colors = {}) {
  return Object.entries(colors)
    .map(([key, value]) => `--pass-${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${value}`)
    .join("; ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// ---------- Actions ----------

async function load(enteredCode) {
  try {
    players = await rpc("get_state", { p_code: enteredCode, p_today: today() });
    code = enteredCode;
    storageSet(CODE_KEY, code);
    show();
  } catch (err) {
    code = null;
    storageRemove(CODE_KEY);
    showLogin(err.message);
  }
}

$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  load($("code").value.trim());
});

$("pick-buttons").addEventListener("click", (e) => {
  const button = e.target.closest(".pick-btn");
  if (!button) return;
  myId = button.dataset.id;
  storageSet(PLAYER_KEY, myId);
  show();
});

$("switch-player").addEventListener("click", () => {
  myId = null;
  storageRemove(PLAYER_KEY);
  show();
});

$("log-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    players = await rpc("submit_log", {
      p_code: code,
      p_player_id: Number(myId),
      p_calories: Number($("calories").value),
      p_date: today(),
    });
    $("calories").value = "";
    show();
  } catch (err) {
    $("status").textContent = `Couldn't save: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

$("passes").addEventListener("click", (e) => {
  const button = e.target.closest(".scroll-btn");
  if (!button) return;
  const timeline = button.parentElement.querySelector(".timeline");
  timeline.scrollBy({ left: Number(button.dataset.dir) * timeline.clientWidth * 0.8, behavior: "smooth" });
});

$("logout").addEventListener("click", () => {
  code = null;
  myId = null;
  storageRemove(CODE_KEY);
  storageRemove(PLAYER_KEY);
  showLogin();
});

// ---------- Start ----------

if (code) load(code);
else showLogin();
