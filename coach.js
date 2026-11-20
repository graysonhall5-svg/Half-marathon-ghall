// Date math, pace math and recovery-based adjustments. No DOM here so it can be tested in Node.
import { PLAN, START_DATE, RACE_DATE } from './plan.js';

const DAY_MS = 86400000;

// Parse 'YYYY-MM-DD' as a local calendar date (noon avoids DST edge cases).
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Where `date` falls in the plan: { week (0-12), day (0-6) } or null outside the plan.
export function planPosition(date) {
  const start = parseDate(START_DATE);
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const idx = Math.round((local - start) / DAY_MS);
  if (idx < 0) return { before: true, daysUntil: -idx };
  if (idx >= PLAN.length * 7) return { after: true };
  return { week: Math.floor(idx / 7), day: idx % 7 };
}
export function dateFor(week, day) {
  return addDays(parseDate(START_DATE), week * 7 + day);
}
export function daysToRace(date) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  return Math.round((parseDate(RACE_DATE) - local) / DAY_MS);
}

// ---------- Paces ----------
// Riegel: t2 = t1 * (d2/d1)^1.06. Times in seconds.
const riegel = (t1, d1, d2) => t1 * Math.pow(d2 / d1, 1.06);
const MILE = 1609.34;

export function parseTime(str) {
  if (!str) return null;
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0) || null;
}
export function fmtPace(secPerMile) {
  const s = Math.round(secPerMile);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/mi`;
}
export function fmtTime(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// From a recent 5K time (and optional half marathon goal), work out training paces per mile.
export function paces(fiveK, goalHalf) {
  if (!fiveK && !goalHalf) return null;
  const base5k = fiveK || riegel(goalHalf, 21097.5, 5000);
  const half = goalHalf || riegel(base5k, 5000, 21097.5);
  const perMile = (t, d) => t / (d / MILE);
  const fiveKPace = perMile(base5k, 5000);
  const milePace = riegel(base5k, 5000, MILE);
  const tenKPace = perMile(riegel(base5k, 5000, 10000), 10000);
  const halfPace = perMile(half, 21097.5);
  return {
    halfTime: half,
    mile: milePace,
    fiveK: fiveKPace,
    tempo: (tenKPace + halfPace) / 2,
    half: halfPace,
    easyLow: halfPace + 60,
    easyHigh: halfPace + 105,
  };
}

// ---------- Recovery ----------
export function recoveryZone(score) {
  if (score == null) return null;
  if (score >= 67) return 'green';
  if (score >= 34) return 'yellow';
  return 'red';
}

// Returns { title, detail, changed } describing what to actually do today.
export function adjust(workout, score, opts = {}) {
  const zone = recoveryZone(score);
  const { sleepPerf } = opts;
  const poorSleep = sleepPerf != null && sleepPerf < 70;
  const plan = { title: workout.title, detail: '', changed: false };

  if (workout.locked || workout.type === 'race') {
    return { ...plan, detail: workout.type === 'race' ? 'Race day. Trust the training.' : 'Keep it easy and short. Legs should feel fresh for tomorrow.' };
  }
  if (!zone) {
    if (workout.type === 'optional') return { ...plan, detail: 'No recovery score yet. Run the 4 miles only if you feel fresh, otherwise rest.' };
    return { ...plan, detail: 'No recovery score yet today, so this is the plan as written.' };
  }

  const sleepNote = poorSleep ? ' Sleep was short last night, so keep the effort honest and get to bed early.' : '';

  if (zone === 'green') {
    if (workout.type === 'optional') return { title: '4 mi easy + 4 x 75m strides', detail: 'You\'re well recovered, so take the run option today.' + sleepNote, changed: true };
    return { ...plan, detail: 'You\'re well recovered. Run it as written.' + sleepNote };
  }

  if (zone === 'yellow') {
    switch (workout.type) {
      case 'interval': {
        const reps = Math.max(2, Math.round(workout.reps * 0.7));
        const title = workout.reps >= 4 && !workout.rep.includes('+') && !workout.rep.includes('/')
          ? `${reps} x ${workout.rep} (${workout.pace} pace) / 200m jog`
          : workout.title + ' (cut the last 1/3)';
        return { title, detail: 'Medium recovery: do the session but drop about a third of the reps. Hit pace, don\'t chase it.' + sleepNote, changed: true };
      }
      case 'tempo': {
        const repeats = workout.text.match(/^(\d+) x (.+)$/);
        if (repeats) {
          const reps = Math.max(2, Number(repeats[1]) - 1);
          return { title: `${reps} x ${repeats[2]}`, detail: 'Medium recovery: drop one rep and stay at the easy end of tempo pace.' + sleepNote, changed: true };
        }
        const mins = Math.max(15, Math.round((workout.minutes * 0.75) / 5) * 5);
        return { title: `${mins} min tempo (shortened)`, detail: `Medium recovery: cut the tempo to about ${mins} minutes total and stay at the easy end of tempo pace.` + sleepNote, changed: true };
      }
      case 'long':
      case 'trial':
        return { title: workout.type === 'trial' ? '10K at steady effort (not all-out)' : `Long run ${workout.miles} mi, all easy`, detail: 'Medium recovery: get the distance in but keep the whole thing conversational. Skip any pace finish.' + sleepNote, changed: true };
      case 'optional':
        return { title: 'Rest (or 3 mi very easy)', detail: 'Medium recovery: take the rest option, especially with a long run tomorrow.' + sleepNote, changed: true };
      case 'cross':
        return { ...plan, detail: 'Medium recovery: do the full time at an easy effort.' + sleepNote };
      default:
        return { ...plan, detail: 'Medium recovery: run it as written at an easy, conversational pace.' + sleepNote };
    }
  }

  // red
  switch (workout.type) {
    case 'interval':
    case 'tempo':
      return { title: '3 mi easy or 30 min easy cross training', detail: 'Low recovery: skip the hard session today. If Thursday is still a rest day, you can swap and do this workout then.', changed: true };
    case 'long': {
      const miles = Math.max(3, Math.round(workout.miles * 0.7));
      return { title: `Long run cut to ${miles} mi, easy`, detail: 'Low recovery: shorten the long run and keep it very easy. Missing a few miles won\'t hurt your race, but overreaching can.', changed: true };
    }
    case 'trial':
      return { title: '4 mi easy (move the time trial)', detail: 'Low recovery: a time trial on a red day won\'t tell you much. Move it to a day this week when you\'re in the green.', changed: true };
    case 'easy': {
      const miles = Math.max(2, Math.round(workout.miles / 2));
      return { title: `${miles} mi easy or 30 min cross training`, detail: 'Low recovery: cut today\'s run in half or swap it for low-impact cardio.', changed: true };
    }
    case 'optional':
      return { title: 'Rest', detail: 'Low recovery: take the day off.', changed: true };
    case 'cross':
      return { title: `Cross training ${Math.round(workout.min / 2)} min, easy`, detail: 'Low recovery: halve the time and keep it light, or take a walk.', changed: true };
    default:
      return { ...plan, detail: 'Low recovery: rest well today.' };
  }
}
