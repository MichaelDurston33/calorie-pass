import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { PASSES, TIMELINE_LENGTH } from "./passes.js";
import { addDays, hardcorePeriodOn, playStreak } from "./rules.js";

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
let players = []; // [{ id, name, logs: [{ date, calories }] }], logs oldest first
let hardcore = { periods: [], optins: [] }; // periods: [{ start, end }], optins: [player id]

// Add ?hardcore to the address to preview Hardcore Mode on this device only.
// Nothing is saved and nobody else sees it.
const PREVIEW_HARDCORE = new URLSearchParams(location.search).has("hardcore");

function setState(state) {
  players = state.players;
  hardcore = state.hardcore;
  if (PREVIEW_HARDCORE) {
    const day = today();
    hardcore = {
      ...hardcore,
      periods: [...hardcore.periods, { start: day, end: addDays(day, 6), preview: true }],
    };
  }
}

// ---------- Screens ----------

function showScreen(name) {
  for (const id of ["login", "pick", "main"]) $(id).hidden = id !== name;
  if (name !== "main") document.body.classList.remove("hardcore");
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
  const day = today();
  const period = hardcorePeriodOn(day, hardcore.periods);

  document.body.classList.toggle("hardcore", Boolean(period));
  $("hc-banner").hidden = !period;
  if (period) {
    const dayNumber = daysBetween(period.start, day) + 1;
    const length = daysBetween(period.start, period.end) + 1;
    $("hc-status").textContent =
      `Day ${dayNumber} of ${length}, last day ${fmtDay(period.end, { weekday: "short" })}. ` +
      "Go over your goal and your streak resets." +
      (period.preview ? " (Preview on this device only: nothing is saved.)" : "");
  }

  const goal = passFor(me).goal;
  const todays = me.logs.find((l) => l.date === day);
  $("me").textContent = displayName(me);
  $("status").textContent = [
    todays
      ? `Logged today: ${fmtKcal(todays.calories)} kcal. Submit again to correct it.`
      : "Not logged today yet. Log before midnight to keep your streak.",
    period && goal ? `Hardcore goal: ${fmtKcal(goal)} kcal or less.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  renderPasses(day);
  renderHardcoreCard(me, day, period);
}

function renderPasses(day) {
  $("passes").innerHTML = inPassOrder(players).map((p) => renderPass(p, day)).join("");

  // Start each timeline centred on the next tier to earn.
  for (const timeline of document.querySelectorAll(".timeline")) {
    const next = timeline.querySelector(".tier.next");
    if (next) timeline.scrollLeft = next.offsetLeft - (timeline.clientWidth - next.offsetWidth) / 2;
  }
}

// First tier after `streak` where a prize repeating `every` N tiers unlocks.
function nextPrizeTier(streak, every) {
  return (Math.floor(streak / every) + 1) * every;
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

function renderPass(player, day) {
  const pass = passFor(player);
  const { run, reset, earned } = playStreak(player.logs, {
    goal: pass.goal,
    prizes: pass.prizes,
    periods: hardcore.periods,
    today: day,
  });
  const streak = run.length;
  const upcoming = pass.prizes.map((p) => ({ ...p, tier: nextPrizeTier(streak, p.every) }));

  // The pass never ends: show TIMELINE_LENGTH tiers, extending by that much
  // each time the end is reached, and always far enough to show one of each
  // prize still to come.
  const end = Math.max(
    Math.ceil((streak + 1) / TIMELINE_LENGTH) * TIMELINE_LENGTH,
    ...upcoming.map((p) => p.tier)
  );
  const tiers = reset ? [renderReset(reset, pass.goal)] : [];
  for (let t = 1; t <= end; t++) tiers.push(renderTier(t, run[t - 1], streak, pass.prizes));

  const loggedToday = player.logs.some((l) => l.date === day);
  const showGoal = pass.goal && hardcorePeriodOn(day, hardcore.periods);

  return `
    <section class="pass" style="${escapeHtml(themeStyle(pass.colors))}">
      <header class="pass-head">
        <div class="who">
          ${pass.emoji ? `<span class="avatar" aria-hidden="true">${escapeHtml(pass.emoji)}</span>` : ""}
          <div>
            <h2>${escapeHtml(player.name)}</h2>
            ${
              loggedToday
                ? `<span class="today is-done">✓ Logged today</span>`
                : `<span class="today">Not logged today</span>`
            }
            ${showGoal ? `<span class="goal">Goal ${fmtKcal(pass.goal)} kcal</span>` : ""}
          </div>
        </div>
        <div class="tier-big"><span>Streak</span><strong>${streak}</strong></div>
      </header>
      <div class="timeline-wrap">
        <button class="scroll-btn" type="button" data-dir="-1" aria-label="Scroll back">‹</button>
        <div class="timeline"><ol class="tiers">${tiers.join("")}</ol></div>
        <button class="scroll-btn" type="button" data-dir="1" aria-label="Scroll forward">›</button>
      </div>
      ${renderFooter(streak, pass.prizes, upcoming, earned)}
    </section>`;
}

// `log` is the day that earned this tier, if it's been earned.
function renderTier(t, log, streak, prizes) {
  const rewards = prizes.filter((p) => t % p.every === 0);
  const earned = t <= streak;
  const cls = ["tier", earned && "done", t === streak + 1 && "next", rewards.length && "has-prize", log?.hardcore && "hc"]
    .filter(Boolean)
    .join(" ");
  const title = [
    `Tier ${t}`,
    log && `${fmtDay(log.date)}: ${fmtKcal(log.calories)} kcal${log.hardcore ? " (Hardcore)" : ""}`,
    rewards.length && rewards.map((r) => r.name).join(" + "),
  ]
    .filter(Boolean)
    .join(" · ");

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
      ${renderEntry(log && fmtKcal(log.calories), log?.date)}
      ${cards}
    </li>`;
}

// Tier 0: what ended the last streak, so it stays visible to both of you.
function renderReset(reset, goal) {
  const title = reset.missed
    ? `Streak reset: nothing logged on ${fmtDay(reset.date)}`
    : `Streak reset: ${fmtKcal(reset.calories)} kcal on ${fmtDay(reset.date)}, over the ${fmtKcal(goal)} kcal Hardcore goal`;
  return `
    <li class="tier reset" title="${escapeHtml(title)}">
      <span class="tier-num">0</span>
      <span class="rail"><span class="node">💥</span></span>
      ${renderEntry(reset.missed ? "Missed" : fmtKcal(reset.calories), reset.date)}
    </li>`;
}

// Calories and date under a tier. Always there (empty for tiers still to come)
// so prize cards line up.
function renderEntry(text, date) {
  return `
    <span class="entry">
      <span class="kcal">${text ? escapeHtml(text) : ""}</span>
      <span class="day">${date ? escapeHtml(fmtDay(date)) : ""}</span>
    </span>`;
}

function renderFooter(streak, prizes, upcoming, earned) {
  if (!prizes.length) return "";

  const soonest = Math.min(...upcoming.map((p) => p.tier));
  const toGo = soonest - streak;
  const nextNames = upcoming
    .filter((p) => p.tier === soonest)
    .map((p) => `${p.icon} ${p.name}`)
    .join(" + ");
  const earnedText = prizes.map((p, i) => `${p.icon} ×${earned[i]}`).join(" · ");

  return `
    <p class="pass-foot">
      <span>Next: <strong>${escapeHtml(nextNames)}</strong> in ${toGo} ${toGo === 1 ? "day" : "days"}</span>
      <span>Earned: ${escapeHtml(earnedText)}</span>
    </p>`;
}

// The opt-in card. Hidden while Hardcore Mode is on (the banner takes over).
function renderHardcoreCard(me, day, period) {
  const card = $("hardcore");
  card.hidden = Boolean(period);
  if (period) return;

  const meIn = hardcore.optins.includes(me.id);
  const others = players.filter((p) => p.id !== me.id);
  const othersIn = others.filter((p) => hardcore.optins.includes(p.id));
  const waitingOnMe = !meIn && othersIn.length > 0;
  const goal = passFor(me).goal;
  const names = (list) => escapeHtml(list.map(displayName).join(" and "));

  let body;
  if (meIn) {
    body = `
      <p>You're in. Waiting for ${names(others.filter((p) => !othersIn.includes(p)))} to opt in.</p>
      <button class="link" type="button" data-opt-in="false">Cancel</button>`;
  } else {
    // Hardcore counts the day it starts, so anyone already over goal today resets straight away.
    const overToday = waitingOnMe
      ? players.filter((p) => {
          const log = p.logs.find((l) => l.date === day);
          const g = passFor(p).goal;
          return log && g && log.calories > g;
        })
      : [];
    body = `
      ${waitingOnMe ? `<p><strong>${names(othersIn)} wants to start it!</strong></p>` : ""}
      <p>7 days, starting today. Log over your goal${goal ? ` (${fmtKcal(goal)} kcal)` : ""} and your streak resets to 0. You both have to opt in.</p>
      ${
        overToday.length
          ? `<p class="warn">Heads up: ${names(overToday)} ${overToday.length === 1 ? "is" : "are"} already over goal today, so starting now resets ${overToday.length === 1 ? "that streak" : "those streaks"}.</p>`
          : ""
      }
      <button class="hc-join" type="button" data-opt-in="true">${waitingOnMe ? "I'm in: start Hardcore" : "I'm in"}</button>`;
  }

  card.innerHTML = `<h2>🐝🧟 Bee Jim Hardcore Mode</h2>${body}`;

  // Above the passes when someone's waiting on you, otherwise below them.
  $("passes").insertAdjacentElement(waitingOnMe ? "beforebegin" : "afterend", card);
}

// { prizeInk: "#fff" } -> "--pass-prize-ink: #fff"
function themeStyle(colors = {}) {
  return Object.entries(colors)
    .map(([key, value]) => `--pass-${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}: ${value}`)
    .join("; ");
}

const fmtKcal = (n) => n.toLocaleString();

// "30 Sep", in the browser's own date style.
function fmtDay(date, options = {}) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", ...options });
}

function daysBetween(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// ---------- Actions ----------

async function load(enteredCode) {
  try {
    setState(await rpc("get_state", { p_code: enteredCode }));
    code = enteredCode;
    storageSet(CODE_KEY, code);
    show();
  } catch (err) {
    // Only forget the code if it's wrong, not if Supabase couldn't be reached.
    if (err.message === "Invalid code") {
      code = null;
      storageRemove(CODE_KEY);
    }
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
    setState(
      await rpc("submit_log", {
        p_code: code,
        p_player_id: Number(myId),
        p_calories: Number($("calories").value),
        p_date: today(),
      })
    );
    $("calories").value = "";
    show();
  } catch (err) {
    $("status").textContent = `Couldn't save: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

$("hardcore").addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-opt-in]");
  if (!button) return;
  button.disabled = true;
  try {
    setState(
      await rpc("set_hardcore_optin", {
        p_code: code,
        p_player_id: Number(myId),
        p_opt_in: button.dataset.optIn === "true",
        p_today: today(),
      })
    );
    show();
  } catch (err) {
    button.disabled = false;
    button.insertAdjacentHTML("afterend", `<p class="error">${escapeHtml(err.message)}</p>`);
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

// Fill the Hardcore frame. Each strip is two identical halves, so its scrolling loops seamlessly.
for (const strip of document.querySelectorAll(".hc-top span, .hc-bottom span")) {
  strip.textContent = "🐝  🧟  ".repeat(100);
}
for (const strip of document.querySelectorAll(".hc-left span, .hc-right span")) {
  strip.textContent = "🐝\n🧟\n".repeat(60);
}

if (code) load(code);
else showLogin();
