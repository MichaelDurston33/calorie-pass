import { FREEZE_EVERY, PASSES, TIMELINE_LENGTH } from "./passes.js";
import { addDays, goalOn, hardcorePeriodOn, needsReading, netCalories, playStreak, readOn, stepKcal, tokensLeft } from "./rules.js";
import { $, escapeHtml, fmtDay, rpc, today } from "./util.js";
import { initJournal, openEditor, renderJournal } from "./journal.js";

const CODE_KEY = "calorie-pass-code";
const PLAYER_KEY = "calorie-pass-player";

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
function storageRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

// ---------- State ----------
// The code and who's using this device are remembered, so each is only asked for once.

let code = storageGet(CODE_KEY);
let myId = storageGet(PLAYER_KEY);
// [{ id, name, logs: [{ date, calories, steps }], reading: [{ date, minutes }],
//    spends: [{ id, prize, date }], journal: [{ id, name, date, style, spendId }] }], oldest first
let players = [];
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

// "pass" or "journal", from the address (#journal), so the back button works.
function currentView() {
  return location.hash === "#journal" && players.some((p) => passFor(p).journal) ? "journal" : "pass";
}

function showMain(me) {
  showScreen("main");
  const day = today();
  const period = hardcorePeriodOn(day, hardcore.periods);
  const view = currentView();

  $("tabs").hidden = !players.some((p) => passFor(p).journal);
  for (const tab of document.querySelectorAll("#tabs a")) {
    tab.classList.toggle("active", tab.dataset.view === view);
    if (tab.dataset.view === view) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  $("pass-view").hidden = view !== "pass";
  $("journal-view").hidden = view !== "journal";

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

  const { goal, reading } = passFor(me);
  const goalToday = goalOn(goal, day);
  const todays = me.logs.find((l) => l.date === day);
  $("me").textContent = displayName(me);
  $("status").textContent = [
    todays
      ? `Logged today: ${describeDay(todays)}. Submit again to correct it.`
      : "Not logged today yet. Log before midnight to keep your streak.",
    needsReading(reading, day) && !readOn(reading, me.reading ?? [], day)
      ? `Today also needs a finished ${reading.minutes}-minute reading session on the e-reader.`
      : "",
    period && goalToday ? `Hardcore goal: ${fmtKcal(goalToday)} kcal or less.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (view === "journal") renderJournal();
  else {
    renderPasses(day);
    renderHardcoreCard(me, day, period);
  }
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

function isMe(player) {
  return String(player.id) === myId;
}

// "🐝 Abbie"
function displayName(player) {
  const emoji = passFor(player).emoji;
  return emoji ? `${emoji} ${player.name}` : player.name;
}

// Replays someone's logs: their streak, prizes earned and freezes (see rules.js).
function streakFor(player, day = today()) {
  const pass = passFor(player);
  return playStreak(player.logs, {
    goal: pass.goal,
    prizes: pass.prizes,
    periods: hardcore.periods,
    today: day,
    reading: pass.reading,
    sessions: player.reading ?? [],
  });
}

// Each prize's tokens: how many were earned, which were spent, and how many are left.
function tokensFor(player, day = today()) {
  const { prizes } = passFor(player);
  const { earned } = streakFor(player, day);
  const spends = player.spends ?? [];
  const left = tokensLeft(prizes, earned, spends);
  return prizes.map((prize, i) => ({
    prize,
    earned: earned[i],
    left: left[i],
    spends: spends.filter((s) => s.prize === prize.name),
  }));
}

function renderPass(player, day) {
  const pass = passFor(player);
  const { run, reset, freezes, frozen } = streakFor(player, day);
  const streak = run.length;
  const upcoming = pass.prizes.map((p) => ({ ...p, tier: nextPrizeTier(streak, p.every) }));

  // The pass never ends: show TIMELINE_LENGTH tiers, extending by that much
  // each time the end is reached, and always far enough to show one of each
  // prize still to come.
  const end = Math.max(
    Math.ceil((streak + 1) / TIMELINE_LENGTH) * TIMELINE_LENGTH,
    ...upcoming.map((p) => p.tier)
  );
  const tiers = reset ? [renderReset(reset, player)] : [];
  for (let t = 1; t <= end; t++) tiers.push(renderTier(t, run[t - 1], streak, pass.prizes, pass.reading));

  const loggedToday = player.logs.some((l) => l.date === day);
  const goalToday = goalOn(pass.goal, day);
  const showGoal = goalToday && hardcorePeriodOn(day, hardcore.periods);
  const showReading = needsReading(pass.reading, day);
  const readToday = showReading && readOn(pass.reading, player.reading ?? [], day);

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
            ${
              showReading
                ? readToday
                  ? `<span class="today is-done">📖 Read today</span>`
                  : `<span class="today">📖 Not read today</span>`
                : ""
            }
            ${showGoal ? `<span class="goal">Goal ${fmtKcal(goalToday)} kcal</span>` : ""}
          </div>
        </div>
        <div class="tier-big">
          <span>Streak</span><strong>${streak}</strong>
          ${renderFreezes(streak, freezes, frozen)}
        </div>
      </header>
      <div class="timeline-wrap">
        <button class="scroll-btn" type="button" data-dir="-1" aria-label="Scroll back">‹</button>
        <div class="timeline"><ol class="tiers">${tiers.join("")}</ol></div>
        <button class="scroll-btn" type="button" data-dir="1" aria-label="Scroll forward">›</button>
      </div>
      ${renderFooter(streak, pass.prizes, upcoming, tokensFor(player, day), isMe(player))}
    </section>`;
}

// "❄️ 2" under the streak, with when the next one comes and the last day one covered.
function renderFreezes(streak, freezes, frozen) {
  const toNext = FREEZE_EVERY - (streak % FREEZE_EVERY);
  const title = [
    `${freezes} streak ${freezes === 1 ? "freeze" : "freezes"}: each covers a missed day automatically.`,
    `Next one in ${toNext} ${toNext === 1 ? "day" : "days"}.`,
    frozen.length && `Last used for ${fmtDay(frozen[frozen.length - 1])}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return `<span class="freezes" title="${escapeHtml(title)}">❄️ ${freezes}</span>`;
}

// `log` is the day that earned this tier, if it's been earned.
function renderTier(t, log, streak, prizes, reading) {
  const rewards = prizes.filter((p) => t % p.every === 0);
  const earned = t <= streak;
  const cls = ["tier", earned && "done", t === streak + 1 && "next", rewards.length && "has-prize", log?.hardcore && "hc"]
    .filter(Boolean)
    .join(" ");
  const title = [
    `Tier ${t}`,
    log && `${fmtDay(log.date)}: ${describeDay(log)}${needsReading(reading, log.date) ? " + reading" : ""}${log.hardcore ? " (Hardcore)" : ""}`,
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
      ${renderEntry(log && fmtKcal(log.calories), log?.date, log?.steps)}
      ${cards}
    </li>`;
}

// Tier 0: what ended the last streak, so it stays visible to both of you.
function renderReset(reset, player) {
  // A missed day that did have calories logged was missing its reading session.
  const noReading = reset.missed && player.logs.some((l) => l.date === reset.date);
  const title = noReading
    ? `Streak reset: no reading session on ${fmtDay(reset.date)}`
    : reset.missed
    ? `Streak reset: nothing logged on ${fmtDay(reset.date)}`
    : `Streak reset: ${fmtKcal(reset.calories)} kcal net on ${fmtDay(reset.date)}, over the ${fmtKcal(reset.goal)} kcal Hardcore goal`;
  return `
    <li class="tier reset" title="${escapeHtml(title)}">
      <span class="tier-num">0</span>
      <span class="rail"><span class="node">💥</span></span>
      ${renderEntry(noReading ? "No reading" : reset.missed ? "Missed" : fmtKcal(reset.calories), reset.date)}
    </li>`;
}

// "1,850 kcal" or "1,850 kcal − 200 kcal from 8,000 steps = 1,650 kcal net"
function describeDay(log) {
  if (!log.steps) return `${fmtKcal(log.calories)} kcal`;
  const burned = stepKcal(log.steps);
  return `${fmtKcal(log.calories)} kcal − ${fmtKcal(burned)} kcal from ${fmtKcal(log.steps)} steps = ${fmtKcal(log.calories - burned)} kcal net`;
}

// Calories, steps and date under a tier. Always there (empty for tiers still to come)
// so prize cards line up.
function renderEntry(text, date, steps) {
  return `
    <span class="entry">
      <span class="kcal">${text ? escapeHtml(text) : ""}</span>
      <span class="steps">${steps ? `👟 −${fmtKcal(stepKcal(steps))}` : ""}</span>
      <span class="day">${date ? escapeHtml(fmtDay(date)) : ""}</span>
    </span>`;
}

// What's next, and each prize's tokens to spend. On your own pass the token
// counts are buttons that open the token sheet.
function renderFooter(streak, prizes, upcoming, tokens, mine) {
  if (!prizes.length) return "";

  const soonest = Math.min(...upcoming.map((p) => p.tier));
  const toGo = soonest - streak;
  const nextNames = upcoming
    .filter((p) => p.tier === soonest)
    .map((p) => `${p.icon} ${p.name}`)
    .join(" + ");

  const chips = tokens
    .map(({ prize, left, earned }) => {
      const label = `${prize.name}: ${left} ${left === 1 ? "token" : "tokens"} to spend (${earned} earned)`;
      const inner = `<span aria-hidden="true">${escapeHtml(prize.icon)}</span><strong>${left}</strong>`;
      const cls = `token${left ? " has-left" : ""}`;
      return mine
        ? `<button class="${cls}" type="button" data-token="${escapeHtml(prize.name)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${inner}</button>`
        : `<span class="${cls}" title="${escapeHtml(label)}">${inner}</span>`;
    })
    .join("");

  return `
    <div class="pass-foot">
      <span>Next: <strong>${escapeHtml(nextNames)}</strong> in ${toGo} ${toGo === 1 ? "day" : "days"}</span>
      <span class="tokens">Tokens to spend ${chips}</span>
    </div>`;
}

// ---------- Tokens ----------
// Each prize earned is a token. Tapping your token count opens a sheet to use
// one (recorded with the date) or undo one used by mistake.

let tokenPrize = null; // the prize whose sheet is open

function openTokenSheet(prizeName) {
  tokenPrize = prizeName;
  const me = players.find((p) => isMe(p));
  $("token-dialog").setAttribute("style", themeStyle(passFor(me).colors));
  renderTokenSheet();
  $("token-dialog").showModal();
}

function renderTokenSheet(message = "") {
  const me = players.find((p) => isMe(p));
  const token = me && tokensFor(me).find((t) => t.prize.name === tokenPrize);
  if (!token) return $("token-dialog").close();
  const { prize, left, earned, spends } = token;
  const forJournal = passFor(me).journal?.prize === prize.name;
  const named = new Map((me.journal ?? []).filter((e) => e.spendId).map((e) => [e.spendId, e.name]));
  const thing = prize.name.toLowerCase();

  const history = [...spends]
    .reverse()
    .map(
      (s) => `
        <li>
          <span>${escapeHtml(fmtDay(s.date, { year: "numeric" }))}${named.has(s.id) ? ` · <strong>${escapeHtml(named.get(s.id))}</strong>` : ""}</span>
          <button class="link" type="button" data-unspend="${s.id}">Undo</button>
        </li>`
    )
    .join("");

  let actions;
  if (!left) actions = `<p class="muted">No tokens to spend right now. Keep your streak going!</p>`;
  else if (forJournal)
    actions = `
      <button class="token-use" type="button" data-use="journal">＋ Use one for a new ${escapeHtml(thing)}</button>
      <button class="link" type="button" data-use="plain">Use one without a journal entry</button>`;
  else actions = `<button class="token-use" type="button" data-use="plain">Use a ${escapeHtml(thing)} token</button>`;

  $("token-dialog").innerHTML = `
    <div class="sheet-bar">
      <h2>${escapeHtml(`${prize.icon} ${prize.name} tokens`)}</h2>
      <button class="sheet-close" type="button" data-close aria-label="Close">✕</button>
    </div>
    <p class="token-count"><strong>${left}</strong> to spend <span class="muted">· ${earned} earned · ${spends.length} used</span></p>
    ${message ? `<p class="token-msg">${escapeHtml(message)}</p>` : ""}
    <div class="token-actions">${actions}</div>
    <h3>Used</h3>
    ${history ? `<ul class="token-history">${history}</ul>` : `<p class="muted">None yet.</p>`}
    <p class="error" id="token-error"></p>`;
}

$("token-dialog").addEventListener("click", async (e) => {
  const dialog = $("token-dialog");
  if (e.target === dialog || e.target.closest("[data-close]")) return dialog.close(); // backdrop or ✕
  const use = e.target.closest("[data-use]");
  const unspend = e.target.closest("[data-unspend]");

  if (use?.dataset.use === "journal") {
    dialog.close();
    location.hash = "journal";
    openEditor(Number(myId), { token: "new" });
    return;
  }

  try {
    if (use) {
      use.disabled = true;
      setState(await rpc("spend_token", { p_code: code, p_player_id: Number(myId), p_prize: tokenPrize, p_date: today() }));
      show();
      renderTokenSheet("Token used. Enjoy! 🎉");
    } else if (unspend) {
      if (!confirm("Undo this one? It goes back to your tokens to spend.")) return;
      setState(await rpc("unspend_token", { p_code: code, p_player_id: Number(myId), p_spend_id: Number(unspend.dataset.unspend) }));
      show();
      renderTokenSheet("Undone: it's back with your tokens to spend.");
    }
  } catch (err) {
    $("token-error").textContent = `Couldn't save: ${err.message}`;
    if (use) use.disabled = false;
  }
});

// The opt-in card. Hidden while Hardcore Mode is on (the banner takes over).
function renderHardcoreCard(me, day, period) {
  const card = $("hardcore");
  card.hidden = Boolean(period);
  if (period) return;

  const meIn = hardcore.optins.includes(me.id);
  const others = players.filter((p) => p.id !== me.id);
  const othersIn = others.filter((p) => hardcore.optins.includes(p.id));
  const waitingOnMe = !meIn && othersIn.length > 0;
  const goal = goalOn(passFor(me).goal, day);
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
          const g = goalOn(passFor(p).goal, day);
          return log && g && netCalories(log) > g;
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

function daysBetween(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
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
        // Only sent when filled in; blank keeps any steps already logged today.
        ...($("steps").value !== "" && { p_steps: Number($("steps").value) }),
      })
    );
    $("calories").value = "";
    $("steps").value = "";
    $("log-details").open = false;
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
  const token = e.target.closest("[data-token]");
  if (token) return openTokenSheet(token.dataset.token);
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

initJournal({
  code: () => code,
  myId: () => myId,
  players: () => players,
  passFor,
  tokensFor,
  apply(state) {
    setState(state);
    show();
  },
});

// Switching between the pass and the journal.
window.addEventListener("hashchange", () => {
  if (!players.length) return;
  window.scrollTo(0, 0);
  show();
});

if (code) load(code);
else showLogin();
