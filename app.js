import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { SEASON_LENGTH, PRIZES } from "./prizes.js";

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

// ---------- Screens ----------

function showLogin(error = "") {
  $("login").hidden = false;
  $("main").hidden = true;
  $("login-error").textContent = error;
}

function showMain(players) {
  $("login").hidden = true;
  $("main").hidden = false;

  const select = $("player");
  const saved = storageGet(PLAYER_KEY);
  select.innerHTML = players
    .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
    .join("");
  if (saved && players.some((p) => String(p.id) === saved)) select.value = saved;

  renderStatus(players);
  renderBars(players);
}

function renderStatus(players) {
  const me = players.find((p) => String(p.id) === $("player").value);
  $("status").textContent =
    me?.today_calories != null
      ? `Logged today: ${me.today_calories} kcal. Submit again to correct it.`
      : "Not logged today yet.";
}

function renderBars(players) {
  $("bars").innerHTML = players.map(renderBar).join("");
}

function renderBar(player) {
  const days = player.days_logged;
  const tiers = Array.from({ length: SEASON_LENGTH }, (_, i) => i + 1);
  const prizeAt = new Map(PRIZES.map((p) => [p.tier, p.prize]));

  const stops = tiers
    .map((t) => {
      const cls = ["stop", t <= days && "done", prizeAt.has(t) && "prize"]
        .filter(Boolean)
        .join(" ");
      const title = prizeAt.has(t) ? `Tier ${t}: ${prizeAt.get(t)}` : `Tier ${t}`;
      return `<li class="${cls}" title="${escapeHtml(title)}">${prizeAt.has(t) ? "★" : ""}</li>`;
    })
    .join("");

  const unlocked = PRIZES.filter((p) => p.tier <= days);
  const next = PRIZES.find((p) => p.tier > days);

  return `
    <section class="bar">
      <header>
        <h2>${escapeHtml(player.name)}</h2>
        <span class="tier">Tier ${Math.min(days, SEASON_LENGTH)} / ${SEASON_LENGTH}</span>
      </header>
      <ol class="track">${stops}</ol>
      <p class="next">${
        next
          ? `Next prize at tier ${next.tier}: ${escapeHtml(next.prize)}`
          : "Season complete!"
      }</p>
      ${
        unlocked.length
          ? `<ul class="unlocked">${unlocked
              .map((p) => `<li>★ Tier ${p.tier}: ${escapeHtml(p.prize)}</li>`)
              .join("")}</ul>`
          : ""
      }
    </section>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// ---------- Actions ----------

let players = [];

async function load(code) {
  try {
    players = await rpc("get_state", { p_code: code, p_today: today() });
    storageSet(CODE_KEY, code);
    showMain(players);
  } catch (err) {
    storageRemove(CODE_KEY);
    showLogin(err.message);
  }
}

$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  load($("code").value.trim());
});

$("player").addEventListener("change", () => {
  storageSet(PLAYER_KEY, $("player").value);
  renderStatus(players);
});

$("log-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    players = await rpc("submit_log", {
      p_code: storageGet(CODE_KEY),
      p_player_id: Number($("player").value),
      p_calories: Number($("calories").value),
      p_date: today(),
    });
    storageSet(PLAYER_KEY, $("player").value);
    $("calories").value = "";
    showMain(players);
  } catch (err) {
    $("status").textContent = `Couldn't save: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

$("logout").addEventListener("click", () => {
  storageRemove(CODE_KEY);
  showLogin();
});

// ---------- Start ----------

const savedCode = storageGet(CODE_KEY);
if (savedCode) load(savedCode);
else showLogin();
