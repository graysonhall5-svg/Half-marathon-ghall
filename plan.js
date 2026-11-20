// 13-week half marathon plan. Week 1 starts Monday, Nov 16, 2026.
// Race is Sunday, Feb 14, 2027 (the original chart had it on Saturday of week 13).
//
// Workout types:
//   cross    - cross training for `min` minutes
//   interval - track repeats (`reps` count, `rep` description), "/200m jog" recoveries
//   easy     - distance run of `miles`
//   tempo    - tempo work, `text` describes it, `minutes` = total tempo time
//   optional - "Rest or 4 miles + 4 x 75m strides" (recovery decides)
//   long     - long run of `miles`
//   rest     - rest day
//   shakeout - easy short run
//   trial    - 10K time trial
//   race     - race day

export const START_DATE = '2026-11-16';
export const RACE_DATE = '2027-02-14';
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const cross = (min) => ({ type: 'cross', min, title: `Cross training ${min} min` });
// sets: [{ n: reps, m: meters, pace: 'fiveK' | 'mile' | 'half' }]
const PACE_KEY = { '5K': 'fiveK', mile: 'mile', 'goal half marathon': 'half' };
const interval = (reps, rep, pace, title, sets) => ({
  type: 'interval', reps, rep, pace,
  title: title || `${reps} x ${rep} (${pace} pace) / 200m jog`,
  sets: sets || [{ n: reps, m: parseInt(rep, 10), pace: PACE_KEY[pace] }],
});
const easy = (miles) => ({ type: 'easy', miles, title: `Distance run ${miles} mi` });
const rest = () => ({ type: 'rest', title: 'Rest day' });
const tempo = (text, minutes) => ({ type: 'tempo', text, minutes, title: text });
const optional = () => ({ type: 'optional', miles: 4, title: 'Rest or 4 mi + 4 x 75m strides' });
const long = (miles, note) => ({ type: 'long', miles, note, title: note ? `${miles} mi (${note})` : `Long run ${miles} mi` });

export const PLAN = [
  // Week 1
  [cross(30), interval(10, '400m', '5K'), easy(3), rest(), tempo('5 x 4 min (tempo pace) / 90s recovery', 20), optional(), long(4)],
  // Week 2
  [cross(35), interval(6, '800m', '5K'), easy(4), rest(), tempo('4 x 5 min (tempo pace) / 90s recovery', 20), optional(), long(5)],
  // Week 3
  [cross(40), interval(6, '1000m', '5K'), easy(4), rest(), tempo('3 x 7 min (tempo pace) / 90s recovery', 21), optional(), long(6)],
  // Week 4
  [cross(45), interval(5, '1600m + 4 x 800m', '5K', '1600m + 4 x 800m (5K pace) / 200m jog', [{ n: 1, m: 1600, pace: 'fiveK' }, { n: 4, m: 800, pace: 'fiveK' }]), easy(4), rest(), tempo('20 min tempo', 20), optional(), long(7)],
  // Week 5
  [cross(45), interval(8, '800m / 400m', '5K & mile', '4 x 800m (5K pace) + 4 x 400m (mile pace) / 200m jog', [{ n: 4, m: 800, pace: 'fiveK' }, { n: 4, m: 400, pace: 'mile' }]), easy(4), rest(), tempo('25 min tempo', 25), optional(), long(6, 'final 2 at target pace')],
  // Week 6
  [cross(45), interval(6, '1000m', '5K'), easy(5), rest(), tempo('30 min tempo', 30), optional(), long(8)],
  // Week 7
  [cross(45), interval(3, '1600m', '5K'), easy(5), rest(), tempo('35 min tempo', 35), optional(), long(9)],
  // Week 8
  [cross(50), interval(5, '1200m', '5K'), easy(6), rest(), tempo('30 min tempo', 30), optional(), long(10)],
  // Week 9
  [cross(50), interval(6, '600m', 'mile'), easy(7), rest(), tempo('40 min tempo', 40), optional(), { type: 'trial', miles: 6.2, title: '10K time trial' }],
  // Week 10
  [cross(55), interval(10, '400m', 'mile'), easy(7), rest(), tempo('40 min tempo', 40), optional(), long(10)],
  // Week 11
  [cross(60), interval(6, '1000m', '5K'), easy(8), rest(), tempo('2 x 10 min (tempo pace) / 90s recovery', 20), optional(), long(12)],
  // Week 12
  [cross(55), interval(8, '800m', '5K'), easy(7), rest(), { type: 'shakeout', minutes: 20, title: 'Shakeout 20 min + 4 x 75m strides' }, optional(), long(7)],
  // Week 13 - race week
  [cross(35), interval(4, '800m', 'goal half marathon'), easy(4), rest(),
    { type: 'shakeout', minutes: 20, title: 'Shakeout 20 min + 4 x 75m strides' },
    { type: 'shakeout', miles: 3, title: 'Easy 3 mi in Seaside', locked: true },
    { type: 'race', miles: 13.1, title: 'Half marathon!', locked: true }],
];

// Approximate running miles planned per week (easy, long, optional Saturday, trial, race).
// Track sessions add roughly 3-4 mi with warmup/cooldown; counted as 3.
export function plannedMiles(week, includeOptional = true) {
  return PLAN[week].reduce((sum, w) => {
    if (w.type === 'optional') return sum + (includeOptional ? w.miles : 0);
    if (w.type === 'interval' || w.type === 'tempo') return sum + 3;
    if (w.type === 'shakeout') return sum + (w.miles || 2);
    return sum + (w.miles || 0);
  }, 0);
}
