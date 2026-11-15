// The rules of the game. Your tier on a battle pass is your current streak.
// Someone can have more than one pass (see passes.js), each with its own
// streak, freezes and prizes, all following these same rules.
//
// - Do the pass's thing every day to keep its streak going. For a calorie pass
//   that's logging your calories; for a study pass (`study` in passes.js) it's
//   a long enough session from each study tool it needs (the e-reader, HSK).
// - Miss a day, in either mode, and your streak goes back to 0.
//   Unless you have a streak freeze: one is earned every FREEZE_EVERY days of a
//   streak, and each covers one missed day (used automatically). Freezes are
//   kept after an ordinary reset.
// - During Bee Jim Hardcore Mode, going over your goal also sends a calorie
//   pass back to 0. Hardcore Mode is only about calories, so study passes
//   carry on as normal while it's on.
//   Logged steps count: the goal is checked against calories eaten minus steps.
//   A Bee Jim failure is final: freezes can't cover any day in Hardcore (going
//   over goal or missing a day), and failing wipes out every freeze you have.
// - Prizes are earned each time your streak reaches their tier. A reset
//   doesn't take them away, and climbing back up earns them again. If how often
//   a prize comes changes, each day uses the setting for that day, so prizes
//   earned before the change are kept.
//
// Dates are "YYYY-MM-DD" strings, which compare correctly as plain strings.

import { FREEZE_EVERY, KCAL_PER_STEP } from "./passes.js";

// Calories burned walking, rounded down.
export function stepKcal(steps) {
  return Math.floor((steps || 0) * KCAL_PER_STEP);
}

// What a day counts as: calories eaten minus any logged steps.
export function netCalories(log) {
  return log.calories - stepKcal(log.steps);
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Someone's goal on `date`. `goal` is a number, or a list of changes, oldest
// first: [{ kcal: 1937 }, { from: "2026-10-03", kcal: 1800 }].
export function goalOn(goal, date) {
  if (!Array.isArray(goal)) return goal;
  let kcal;
  for (const g of goal) if (!g.from || g.from <= date) kcal = g.kcal;
  return kcal;
}

// How many days apart a prize comes on `date`, or null if it isn't running yet.
// `every` is a number, or a list of changes, oldest first:
// [{ days: 14 }, { from: "2026-11-16", days: 25 }].
export function everyOn(every, date) {
  if (!Array.isArray(every)) return every;
  let days = null;
  for (const e of every) if (!e.from || e.from <= date) days = e.days;
  return days;
}

// Whether `prize` unlocks at `tier` when it's reached on `date`. The first one
// comes at tier `first` (or `every` if there's no `first`), then one every
// `every` tiers after that. A prize with only `first` comes once per streak.
export function unlocksAt(prize, tier, date) {
  const days = everyOn(prize.every, date); // undefined if it doesn't repeat
  if (days === null) return false; // its schedule hasn't started yet
  const first = prize.first ?? days;
  if (tier === first) return true;
  return Boolean(days) && tier > first && (tier - first) % days === 0;
}

// The prizes that unlock at `tier` when it's reached on `date`.
export function prizesAt(prizes, tier, date) {
  return prizes.filter((p) => unlocksAt(p, tier, date));
}

// What a study pass needs on `date`: { tool: minutes }, e.g. { ereader: 25 },
// or null if it hasn't started. `study` is one setting or a list of changes,
// oldest first: [{ needs: { ereader: 25 } }, { from: "...", needs: { ereader: 25, hsk: 25 } }].
export function studyOn(study, date) {
  let needs = null;
  for (const s of [study].flat()) if (!s.from || s.from <= date) needs = s.needs;
  return needs;
}

// Whether a day's sessions ({ tool: minutes }) cover everything `needs` asks for.
export function studied(needs, sessions) {
  return Boolean(needs) && Object.entries(needs).every(([tool, minutes]) => (sessions[tool] ?? 0) >= minutes);
}

// Someone's study sessions as one entry per day, oldest first, with the
// longest session from each tool that day: [{ date, sessions: { ereader: 25, hsk: 25 } }].
export function studyDays(player) {
  const days = new Map();
  for (const r of player.reading ?? []) {
    const day = days.get(r.date) ?? { date: r.date, sessions: {} };
    const tool = r.source ?? "ereader"; // before tools were recorded, only the e-reader sent sessions
    day.sessions[tool] = Math.max(day.sessions[tool] ?? 0, r.minutes);
    days.set(r.date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// The days that move a pass on, oldest first. A calorie pass counts every day
// with calories logged ([{ date, calories, steps }]). A study pass counts days
// with everything it needed that day ([{ date, sessions }], see studyDays).
export function passDays(pass, player) {
  if (!pass.study) return player.logs;
  return studyDays(player).filter((d) => studied(studyOn(pass.study, d.date), d.sessions));
}

// One pass's streak for one player (see playStreak). Hardcore Mode is only
// about calories, so it doesn't touch study passes.
export function playPass(pass, player, { periods, today }) {
  return playStreak(passDays(pass, player), {
    goal: pass.goal,
    prizes: pass.prizes,
    periods: pass.study ? [] : periods,
    today,
  });
}

// Tokens left to spend for each prize, in the same order as `prizes`: earned on
// the pass (from playStreak) minus spent. `spends` is [{ prize, date }].
export function tokensLeft(prizes, earned, spends = []) {
  return prizes.map((p, i) => Math.max(0, earned[i] - spends.filter((s) => s.prize === p.name).length));
}

// The Hardcore period covering `date`, if there is one.
export function hardcorePeriodOn(date, periods) {
  return periods.find((p) => p.start <= date && date <= p.end);
}

// Replays the days that count for a pass (oldest first, see passDays) and returns:
//   run    - the days making up the current streak, so tier 1 is run[0]
//   reset  - what ended the previous streak, if anything:
//            { date, calories (net of steps), goal } for going over goal in Hardcore,
//            { date, missed: true } for a day that didn't count
//   earned - how many of each prize have been earned (plus any gift), in the same order as `prizes`
//   freezes - streak freezes left
//   frozen  - the missed days that freezes covered
export function playStreak(logs, { goal, prizes, periods, today }) {
  let run = [];
  let reset = null;
  let last = null;
  const earned = prizes.map((p) => p.gift ?? 0);
  let freezes = 0;
  const frozen = [];

  // Days `from`..`to` had nothing logged: use a freeze for each if there are
  // enough, otherwise the streak resets. Missing a Hardcore day is a Bee Jim
  // failure, which freezes can't cover and which wipes them all out.
  const miss = (from, to) => {
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    if (days.some((d) => hardcorePeriodOn(d, periods))) {
      run = [];
      freezes = 0;
      reset = { date: days.find((d) => hardcorePeriodOn(d, periods)), missed: true };
    } else if (freezes >= days.length) {
      freezes -= days.length;
      frozen.push(...days);
    } else {
      run = [];
      reset = { date: from, missed: true };
    }
  };

  for (const log of logs) {
    if (last && log.date > addDays(last, 1)) miss(addDays(last, 1), addDays(log.date, -1));
    last = log.date;

    const hardcore = Boolean(hardcorePeriodOn(log.date, periods));
    const limit = goalOn(goal, log.date);
    if (hardcore && netCalories(log) > limit) {
      run = [];
      freezes = 0; // Bee Jim failure: no freezes survive it
      reset = { date: log.date, calories: netCalories(log), goal: limit };
      continue;
    }

    run.push({ ...log, hardcore });
    for (const p of prizesAt(prizes, run.length, log.date)) earned[prizes.indexOf(p)]++;
    if (run.length % FREEZE_EVERY === 0) freezes++;
  }

  // Nothing logged yesterday (or since) breaks the streak too. Today isn't over yet.
  if (last && last < addDays(today, -1)) miss(addDays(last, 1), addDays(today, -1));

  return { run, reset, earned, freezes, frozen };
}
