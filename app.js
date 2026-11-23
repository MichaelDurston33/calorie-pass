import { FREEZE_EVERY, PASSES, STUDY_TOOLS, TIMELINE_LENGTH } from "./passes.js";
import { addDays, goalOn, hardcorePeriodOn, isCaloriePass, netCalories, playPass, pomodoros, prizesAt, stepKcal, studyDays, studyOn, tokensLeft, unlocksAt } from "./rules.js";
import { $, escapeHtml, fmtDay, rpc, today } from "./util.js";
import { initJournal, openEditor, openGroupMaker, renderJournal } from "./journal.js";

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
// [{ id, name, logs: [{ date, calories, steps }], reading: [{ date, source, minutes }],
//    workouts: [{ date, reps }], spends: [{ id, prize, date }], journal: [{ id, name, species, date, style, spendId }],
//    groupPhotos: [{ id, status, error, prompt, caption, date, style, spendId, shownAt, createdAt }] }], oldest first
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
      const pass = mainPass(p);
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
  return location.hash === "#journal" && players.some((p) => journalFor(p)) ? "journal" : "pass";
}

function showMain(me) {
  showScreen("main");
  const day = today();
  const period = hardcorePeriodOn(day, hardcore.periods);
  const view = currentView();

  $("tabs").hidden = !players.some((p) => journalFor(p));
  for (const tab of document.querySelectorAll("#tabs a")) {
    tab.classList.toggle("active", tab.dataset.view === view);
    if (tab.dataset.view === view) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  $("pass-view").hidden = view !== "pass";
  $("journal-view").hidden = view !== "journal";

  // The bee and zombie frame and banner stay off the journal, to keep it cute.
  const showHardcore = Boolean(period) && view === "pass";
  document.body.classList.toggle("hardcore", showHardcore);
  $("hc-banner").hidden = !showHardcore;
  if (period) {
    const dayNumber = daysBetween(period.start, day) + 1;
    const length = daysBetween(period.start, period.end) + 1;
    $("hc-status").textContent =
      `Day ${dayNumber} of ${length}, last day ${fmtDay(period.end, { weekday: "short" })}. ` +
      "Go over your goal and your streak resets." +
      (period.preview ? " (Preview on this device only: nothing is saved.)" : "");
  }

  const goalToday = goalOn(caloriePass(me)?.goal, day);
  const todays = me.logs.find((l) => l.date === day);
  $("me").textContent = displayName(me);
  $("status").textContent = [
    todays
      ? `Logged today: ${describeDay(todays)}. Submit again to correct it.`
      : "Not logged today yet. Log before midnight to keep your streak.",
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
  $("passes").innerHTML = inPassOrder(players).map((p) => renderCard(p, day)).join("");

  // Start each timeline centred on the next tier to earn.
  for (const timeline of document.querySelectorAll(".timeline")) {
    const next = timeline.querySelector(".tier.next");
    if (next) timeline.scrollLeft = next.offsetLeft - (timeline.clientWidth - next.offsetWidth) / 2;
  }
}

// First tier after `streak` where `prize` unlocks, or null if it isn't coming.
// `dateOf(t)` is the day tier t would be reached.
function nextPrizeTier(prize, streak, dateOf) {
  for (let t = streak + 1; t <= streak + 1000; t++) {
    if (unlocksAt(prize, t, dateOf(t))) return t;
  }
  return null;
}

// Someone's passes, in the order they're listed in passes.js.
function passesFor(player) {
  return PASSES[player.name] ?? [{ prizes: [] }];
}

// Their first pass, which gives them their emoji and colours.
function mainPass(player) {
  return passesFor(player)[0];
}

// The pass their calories count towards, which has their Hardcore goal.
function caloriePass(player) {
  return passesFor(player).find(isCaloriePass);
}

// Their photo journal's settings, if they have one.
function journalFor(player) {
  return passesFor(player).find((pass) => pass.journal)?.journal;
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
  const emoji = mainPass(player).emoji;
  return emoji ? `${emoji} ${player.name}` : player.name;
}

// Replays one of someone's passes: its streak, prizes earned and freezes (see rules.js).
function streakFor(player, pass, day = today()) {
  return playPass(pass, player, { periods: hardcore.periods, today: day });
}

// Each prize's tokens, across all of someone's passes: the pass it's on, how
// many were earned, which were spent, and how many are left.
function tokensFor(player, day = today()) {
  const spends = player.spends ?? [];
  return passesFor(player).flatMap((pass) => {
    const { earned } = streakFor(player, pass, day);
    const left = tokensLeft(pass.prizes, earned, spends);
    return pass.prizes.map((prize, i) => ({
      pass,
      prize,
      earned: earned[i],
      left: left[i],
      spends: spends.filter((s) => s.prize === prize.name),
    }));
  });
}

// One card per person, in their first pass's colours, with a timeline for
// each of their passes. A later pass's colours only change its own timeline.
function renderCard(player, day) {
  const [main, ...others] = passesFor(player);
  return `
    <section class="pass" style="${escapeHtml(themeStyle(main.colors))}">
      ${renderPass(player, main, day, true)}
      ${others.map((pass) => renderPass(player, pass, day, false)).join("")}
    </section>`;
}

// One pass's timeline, with its streak, today's progress and tokens. The first
// is headed with the person's avatar and name, later ones with their own
// emoji and title (e.g. "📚 Chinese").
function renderPass(player, pass, day, first) {
  const { run, reset, freezes, frozen, bank } = streakFor(player, pass, day);
  const streak = run.length;
  // The day each tier was (or would be) reached, if the streak keeps going. A
  // prize's schedule can change from a date, so this decides which tiers have it.
  const countedToday = run[streak - 1]?.date === day;
  const dateOf = (t) => run[t - 1]?.date ?? addDays(day, t - streak - (countedToday ? 0 : 1));
  const upcoming = pass.prizes
    .map((p) => ({ ...p, tier: nextPrizeTier(p, streak, dateOf) }))
    .filter((p) => p.tier);

  // The pass never ends: show TIMELINE_LENGTH tiers, extending by that much
  // each time the end is reached, and always far enough to show one of each
  // prize still to come.
  const end = Math.max(
    Math.ceil((streak + 1) / TIMELINE_LENGTH) * TIMELINE_LENGTH,
    ...upcoming.map((p) => p.tier)
  );
  const tiers = reset ? [renderReset(reset, pass, player)] : [];
  for (let t = 1; t <= end; t++) {
    tiers.push(renderTier(t, run[t - 1], streak, prizesAt(pass.prizes, t, dateOf(t)), pass));
  }

  // What today still needs: calories logged, or a pomodoro from each study tool
  // ("×2" when there's an extra one for the bank), then what's in the bank.
  let todayChips;
  if (pass.study) {
    const sessions = studyDays(player).find((d) => d.date === day)?.sessions ?? {};
    const needs = needsOn(pass, day);
    todayChips = needs
      .map(([tool, minutes]) => {
        const t = toolInfo(tool);
        const done = pomodoros(sessions[tool], minutes);
        return done
          ? `<span class="today is-done">${escapeHtml(`${t.icon} ${t.done}${done > 1 ? ` ×${done}` : ""}`)}</span>`
          : `<span class="today">${escapeHtml(`${t.icon} ${t.todo}`)}</span>`;
      })
      .join(" ");
    if (pass.bank && day >= pass.bank.from) {
      const saved = needs.map(([tool]) => `${toolInfo(tool).icon} ${bank[tool] ?? 0}`).join(" · ");
      const title = "Extra pomodoros you've done. One is used automatically to cover a day that's missing that pomodoro.";
      todayChips += `<span class="today bank" title="${escapeHtml(title)}">${escapeHtml(`🏦 Banked: ${saved}`)}</span>`;
    }
  } else if (pass.workout) {
    const done = (player.workouts ?? []).find((w) => w.date === day);
    todayChips = done
      ? `<span class="today is-done">${escapeHtml(`✓ Done today: ${fmtKcal(done.reps)} reps`)}</span>`
      : `<span class="today">Not done today</span>`;
  } else {
    todayChips = player.logs.some((l) => l.date === day)
      ? `<span class="today is-done">✓ Logged today</span>`
      : `<span class="today">Not logged today</span>`;
  }
  const goalToday = goalOn(pass.goal, day);
  const showGoal = goalToday && hardcorePeriodOn(day, hardcore.periods);
  const status = `${todayChips}${showGoal ? ` <span class="goal">Goal ${fmtKcal(goalToday)} kcal</span>` : ""}`;

  const heading = first
    ? `<div class="who">
         ${pass.emoji ? `<span class="avatar" aria-hidden="true">${escapeHtml(pass.emoji)}</span>` : ""}
         <div><h2>${escapeHtml(player.name)}</h2>${status}</div>
       </div>`
    : `<div><h3>${escapeHtml([pass.emoji, pass.title].filter(Boolean).join(" "))}</h3>${status}</div>`;

  return `
    <div class="lane${pass.study ? " study" : ""}"${first ? "" : ` style="${escapeHtml(themeStyle(pass.colors))}"`}>
      <header class="pass-head">
        ${heading}
        <div class="tier-big">
          <span>Streak</span><strong>${streak}</strong>
          ${renderFreezes(streak, freezes, frozen)}
        </div>
      </header>
      ${pass.workout && isMe(player) ? renderWorkoutForm() : ""}
      <div class="timeline-wrap">
        <button class="scroll-btn" type="button" data-dir="-1" aria-label="Scroll back">‹</button>
        <div class="timeline"><ol class="tiers">${tiers.join("")}</ol></div>
        <button class="scroll-btn" type="button" data-dir="1" aria-label="Scroll forward">›</button>
      </div>
      ${renderFooter(streak, pass.prizes, upcoming, tokensFor(player, day).filter((t) => t.pass === pass), isMe(player))}
    </div>`;
}

// The box on your own workout pass for logging the day's reps. Yesterday is
// there so a forgotten day can still be logged the next morning (the database
// takes nothing older). Logging a day again replaces its reps.
function renderWorkoutForm() {
  return `
    <form class="workout-form">
      <input name="reps" type="number" inputmode="numeric" min="1" max="10000" placeholder="Reps" aria-label="Reps done" required>
      <select name="day" aria-label="Which day">
        <option value="0">Today</option>
        <option value="-1">Yesterday</option>
      </select>
      <button type="submit">Log it</button>
      <p class="error workout-error"></p>
    </form>`;
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

// `log` is the day that earned this tier, if it's been earned: calories logged
// on a calorie pass, that day's study sessions on a study pass, or the reps
// done on a workout pass.
// `rewards` are the prizes that unlock at this tier.
function renderTier(t, log, streak, rewards, pass) {
  const earned = t <= streak;
  const cls = ["tier", earned && "done", t === streak + 1 && "next", rewards.length && "has-prize", log?.hardcore && "hc"]
    .filter(Boolean)
    .join(" ");
  const title = [
    `Tier ${t}`,
    log && `${fmtDay(log.date)}: ${describeLog(log, pass)}${log.hardcore ? " (Hardcore)" : ""}`,
    rewards.length && rewards.map((r) => r.name).join(" + "),
  ]
    .filter(Boolean)
    .join(" · ");

  // One card per tier. Several prizes on the same tier are listed on one card,
  // so the timeline doesn't grow taller.
  const check = earned ? `<span class="check" aria-label="Earned">✓</span>` : "";
  let cards = "";
  if (rewards.length === 1) {
    cards = `
      <div class="reward${earned ? " earned" : ""}">
        ${check}
        <span class="reward-icon">${escapeHtml(rewards[0].icon)}</span>
        <span class="reward-name">${escapeHtml(rewards[0].name)}</span>
      </div>`;
  } else if (rewards.length) {
    cards = `
      <div class="reward multi${earned ? " earned" : ""}">
        ${check}
        ${rewards
          .map((r) => `<span class="reward-row"><span>${escapeHtml(r.icon)}</span>${escapeHtml(r.name)}</span>`)
          .join("")}
      </div>`;
  }

  return `
    <li class="${cls}" title="${escapeHtml(title)}">
      <span class="tier-num">${t}</span>
      <span class="rail"><span class="node"></span></span>
      ${log ? renderEntry(...logEntry(log, pass), log.date) : renderEntry()}
      ${cards}
    </li>`;
}

// Tier 0: what ended the last streak, so it stays visible to both of you.
function renderReset(reset, pass, player) {
  let title;
  if (!reset.missed) {
    title = `Streak reset: ${fmtKcal(reset.calories)} kcal net on ${fmtDay(reset.date)}, over the ${fmtKcal(reset.goal)} kcal Hardcore goal`;
  } else if (pass.study) {
    // Just the pomodoros that day was missing, not everything it needed.
    const sessions = studyDays(player).find((d) => d.date === reset.date)?.sessions ?? {};
    const missing = needsOn(pass, reset.date).filter(([tool, minutes]) => !pomodoros(sessions[tool], minutes));
    title = `Streak reset: ${fmtDay(reset.date)} didn't have ${describeNeeds(missing)}`;
  } else if (pass.workout) {
    title = `Streak reset: no reps logged on ${fmtDay(reset.date)}`;
  } else {
    title = `Streak reset: nothing logged on ${fmtDay(reset.date)}`;
  }
  return `
    <li class="tier reset" title="${escapeHtml(title)}">
      <span class="tier-num">0</span>
      <span class="rail"><span class="node">💥</span></span>
      ${renderEntry(reset.missed ? "Missed" : fmtKcal(reset.calories), "", reset.date)}
    </li>`;
}

// "1,850 kcal" or "1,850 kcal − 200 kcal from 8,000 steps = 1,650 kcal net"
function describeDay(log) {
  if (!log.steps) return `${fmtKcal(log.calories)} kcal`;
  const burned = stepKcal(log.steps);
  return `${fmtKcal(log.calories)} kcal − ${fmtKcal(burned)} kcal from ${fmtKcal(log.steps)} steps = ${fmtKcal(log.calories - burned)} kcal net`;
}

// What earned a tier, in words, for its tooltip.
function describeLog(log, pass) {
  if (pass.study) return describeStudy(log, pass);
  if (pass.workout) return `${fmtKcal(log.reps)} reps`;
  return describeDay(log);
}

// The two lines under an earned tier, whichever kind of pass it's on.
function logEntry(log, pass) {
  if (pass.study) return studyEntry(log, pass);
  if (pass.workout) return [fmtKcal(log.reps), "reps"];
  return calorieEntry(log);
}

// The two lines under a calorie tier: "1,850" and, if steps were logged, "👟 −200".
function calorieEntry(log) {
  return [fmtKcal(log.calories), log.steps ? `👟 −${fmtKcal(stepKcal(log.steps))}` : ""];
}

// What a study pass needed on `date`, as [tool, minutes] pairs.
function needsOn(pass, date) {
  return Object.entries(studyOn(pass.study, date) ?? {});
}

// How a study tool is shown (STUDY_TOOLS in passes.js). Unknown ones still show, plainly.
function toolInfo(tool) {
  return STUDY_TOOLS[tool] ?? { name: tool, icon: "⏱️", done: `${tool} done today`, todo: `No ${tool} today` };
}

// Minutes of full pomodoros a tool did on a study day, added up: 50 for two.
function minutesOn(log, tool, minutes) {
  return (log.sessions[tool] ?? []).filter((m) => m >= minutes).reduce((sum, m) => sum + m, 0);
}

// The lines under a study tier: "25 min", or "📖 25" and "📝 25" when the day
// needed several tools. A tool covered by a banked pomodoro shows 🏦.
function studyEntry(log, pass) {
  const needs = needsOn(pass, log.date);
  const show = ([tool, minutes]) => (log.banked?.includes(tool) ? "🏦" : minutesOn(log, tool, minutes));
  if (needs.length === 1) return [log.banked?.length ? "🏦 banked" : `${show(needs[0])} min`, ""];
  const lines = needs.map((need) => `${toolInfo(need[0]).icon} ${show(need)}`);
  return [lines[0], lines.slice(1).join(" ")];
}

// "50 min e-reader + a banked HSK pomodoro"
function describeStudy(log, pass) {
  return needsOn(pass, log.date)
    .map(([tool, minutes]) =>
      log.banked?.includes(tool)
        ? `a banked ${toolInfo(tool).name} pomodoro`
        : `${minutesOn(log, tool, minutes)} min ${toolInfo(tool).name}`
    )
    .join(" + ");
}

// "a 25-minute e-reader session and a 25-minute HSK session"
function describeNeeds(needs) {
  return needs.map(([tool, minutes]) => `a ${minutes}-minute ${toolInfo(tool).name} session`).join(" and ");
}

// The lines under a tier (calories and steps, or minutes studied) and its date.
// Always there (empty for tiers still to come) so prize cards line up.
function renderEntry(text = "", extra = "", date = "") {
  return `
    <span class="entry">
      <span class="kcal">${escapeHtml(text)}</span>
      <span class="entry-extra">${escapeHtml(extra)}</span>
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
  const next = upcoming.length
    ? `<span>Next: <strong>${escapeHtml(nextNames)}</strong> in ${toGo} ${toGo === 1 ? "day" : "days"}</span>`
    : "";

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
      ${next}
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
  // In the colours of the timeline the prize is on.
  const token = tokensFor(me).find((t) => t.prize.name === prizeName);
  $("token-dialog").setAttribute("style", themeStyle({ ...mainPass(me).colors, ...token?.pass.colors }));
  renderTokenSheet();
  $("token-dialog").showModal();
}

function renderTokenSheet(message = "") {
  const me = players.find((p) => isMe(p));
  const token = me && tokensFor(me).find((t) => t.prize.name === tokenPrize);
  if (!token) return $("token-dialog").close();
  const { prize, left, earned, spends } = token;
  const journal = journalFor(me);
  const forJournal = journal?.prize === prize.name;
  const forGroup = journal?.groupPrize === prize.name;
  // What each token was used on, where it's in the journal.
  const named = new Map([
    ...(me.journal ?? []).filter((e) => e.spendId).map((e) => [e.spendId, e.name]),
    ...(me.groupPhotos ?? []).filter((g) => g.spendId).map((g) => [g.spendId, g.caption || "Group photo"]),
  ]);
  const thing = prize.name.toLowerCase();
  const gift = prize.gift ? ` (${prize.gift} ${prize.gift === 1 ? "was a gift" : "were gifts"} 🎁)` : "";

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
  else if (forGroup)
    actions = `<button class="token-use" type="button" data-use="group">📸 Make a group photo</button>`;
  else if (forJournal)
    actions = `
      <button class="token-use" type="button" data-use="journal">＋ Use one for a new ${escapeHtml(thing)}</button>
      <button class="link" type="button" data-use="plain">Use one without a journal entry</button>`;
  // The name as written, so "Trip to China" keeps its capital C.
  else actions = `<button class="token-use" type="button" data-use="plain">Use a ${escapeHtml(prize.name)} token</button>`;

  $("token-dialog").innerHTML = `
    <div class="sheet-bar">
      <h2>${escapeHtml(`${prize.icon} ${prize.name} tokens`)}</h2>
      <button class="sheet-close" type="button" data-close aria-label="Close">✕</button>
    </div>
    <p class="token-count"><strong>${left}</strong> to spend <span class="muted">· ${earned} earned${escapeHtml(gift)} · ${spends.length} used</span></p>
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

  if (use?.dataset.use === "journal" || use?.dataset.use === "group") {
    dialog.close();
    location.hash = "journal";
    if (use.dataset.use === "group") openGroupMaker(Number(myId));
    else openEditor(Number(myId), { token: "new" });
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
  const goal = goalOn(caloriePass(me)?.goal, day);
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
          const g = goalOn(caloriePass(p)?.goal, day);
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

// Logging reps on your own workout pass, for today or yesterday.
$("passes").addEventListener("submit", async (e) => {
  const form = e.target.closest(".workout-form");
  if (!form) return;
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    setState(
      await rpc("submit_workout", {
        p_code: code,
        p_player_id: Number(myId),
        p_date: addDays(today(), Number(form.elements.day.value)),
        p_reps: Number(form.elements.reps.value),
      })
    );
    show();
  } catch (err) {
    form.querySelector(".workout-error").textContent = `Couldn't save: ${err.message}`;
    button.disabled = false;
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
  journalFor,
  tokensFor,
  apply(state) {
    setState(state);
    show();
  },
  // Fetches the latest state, e.g. to see if a group photo has finished.
  async refresh() {
    setState(await rpc("get_state", { p_code: code }));
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
