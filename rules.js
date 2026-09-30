// The rules of the game. Your tier on the battle pass is your current streak.
//
// - Log something every day to keep your streak going.
// - Miss a day, in either mode, and your streak goes back to 0.
// - During Bee Jim Hardcore Mode, logging more than your goal also sends it back to 0.
// - Prizes are earned each time your streak reaches their tier. A reset
//   doesn't take them away, and climbing back up earns them again.
//
// Dates are "YYYY-MM-DD" strings, which compare correctly as plain strings.

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The Hardcore period covering `date`, if there is one.
export function hardcorePeriodOn(date, periods) {
  return periods.find((p) => p.start <= date && date <= p.end);
}

// Replays someone's logs (oldest first) and returns:
//   run    - the logs making up the current streak, so tier 1 is run[0]
//   reset  - what ended the previous streak, if anything:
//            { date, calories } for going over goal in Hardcore,
//            { date, missed: true } for a day with nothing logged
//   earned - how many of each prize have been earned, in the same order as `prizes`
export function playStreak(logs, { goal, prizes, periods, today }) {
  let run = [];
  let reset = null;
  let last = null;
  const earned = prizes.map(() => 0);

  for (const log of logs) {
    if (last && log.date > addDays(last, 1)) {
      run = [];
      reset = { date: addDays(last, 1), missed: true };
    }
    last = log.date;

    const hardcore = Boolean(hardcorePeriodOn(log.date, periods));
    if (hardcore && log.calories > goal) {
      run = [];
      reset = { date: log.date, calories: log.calories };
      continue;
    }

    run.push({ ...log, hardcore });
    prizes.forEach((p, i) => {
      if (run.length % p.every === 0) earned[i]++;
    });
  }

  // Nothing logged yesterday (or since) breaks the streak too. Today isn't over yet.
  if (last && last < addDays(today, -1)) {
    run = [];
    reset = { date: addDays(last, 1), missed: true };
  }

  return { run, reset, earned };
}
