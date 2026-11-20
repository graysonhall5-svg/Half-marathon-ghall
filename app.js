import { PLAN, DAYS, plannedMiles } from './plan.js';
import {
  planPosition, dateFor, daysToRace, toKey, addDays, parseTime, paces, fmtPace, fmtTime,
  recoveryZone, adjust, targetFor, comparePace,
} from './coach.js';

const $ = (id) => document.getElementById(id);
const ZONE = {
  green: { color: 'var(--good)', label: 'Green' },
  yellow: { color: 'var(--warning)', label: 'Yellow' },
  red: { color: 'var(--critical)', label: 'Red' },
};
const MILE_M = 1609.34;
const isRun = (w) => /run|treadmill|track/i.test(w.sport);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDate = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Allow ?date=2026-12-03 to preview another day.
const params = new URLSearchParams(location.search);
const today = params.get('date') ? new Date(params.get('date') + 'T12:00') : new Date();
const todayKey = toKey(today);

let data = null;

// ---------- Goals & paces ----------
// Goal: sub-1:45 half. 1:44:30 (7:58/mi) leaves a small buffer for GPS drift.
const DEFAULT_GOAL = '1:44:30';
function savedPaces() {
  const s = store.get('paces');
  return s && (s.fiveK || s.goal) ? s : { fiveK: '', goal: DEFAULT_GOAL };
}
const userPaces = () => { const s = savedPaces(); return paces(parseTime(s.fiveK), parseTime(s.goal)); };

// ---------- Daily log ----------
// logs[YYYY-MM-DD] = { done?: bool, miles?: number, time?: sec, rep?: sec, note?: string }
const getLogs = () => store.get('logs') || {};
function setLog(key, entry) {
  const logs = getLogs();
  const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  if (Object.keys(clean).length) logs[key] = clean; else delete logs[key];
  store.set('logs', logs);
}

const localKey = (iso) => toKey(new Date(iso));
const recoveryFor = (key) => data?.recovery.find((r) => localKey(r.date) === key) || null;
const sleepFor = (key) => data?.sleep.find((s) => localKey(s.end) === key) || null;
const workoutsOn = (key) => data?.workouts.filter((w) => localKey(w.start) === key) || [];
const lastCompletedCycle = () => data?.cycles.find((c) => c.end) || null;

// What actually happened on a day: manual log wins, WHOOP fills in the rest.
function dayStatus(week, day) {
  const w = PLAN[week][day];
  const key = toKey(dateFor(week, day));
  const log = getLogs()[key] || {};
  const whoop = workoutsOn(key);
  const runs = whoop.filter(isRun);
  const whoopMatch = w.type === 'cross' ? whoop.length > 0 : w.type === 'rest' ? false : runs.length > 0;
  const whoopMiles = runs.reduce((s, r) => s + (r.miles || 0), 0);
  const whoopTime = runs.reduce((s, r) => s + r.minutes * 60, 0);

  const miles = log.miles ?? (whoopMiles || null);
  const time = log.time ?? (runs.length ? whoopTime : null);
  const done = log.done ?? (whoopMatch || Boolean(log.miles || log.time));
  const source = log.miles || log.time ? 'manual' : whoopMatch ? 'whoop' : log.done ? 'manual' : null;
  const pace = miles && time ? time / miles : null;
  return { w, key, log, whoop, runs, done, miles, time, pace, source };
}

function compareFor(status, target) {
  if (!target?.pace) return null;
  if (status.w.type === 'interval' && status.log.rep) {
    const set = status.w.sets[0];
    return comparePace(status.log.rep / (set.m / MILE_M), target.pace);
  }
  if (status.w.type === 'interval' || status.w.type === 'tempo') return null; // whole-run pace includes warmup/jogs
  return comparePace(status.pace, target.pace);
}

// ---------- Data ----------
async function load() {
  render();
  const err = params.get('error');
  if (err) showBanner(`WHOOP sign-in didn't finish (${escapeHtml(err)}). <a class="btn" href="/api/login">Try again</a>`);
  try {
    const r = await fetch('/api/data', { credentials: 'same-origin' });
    if (r.status === 401) {
      if (!err) showBanner('Connect WHOOP so the plan adjusts to your recovery and logs your runs. <br><a class="btn" href="/api/login">Connect WHOOP</a>');
    } else {
      const body = await r.json();
      if (body.error) showBanner(`Couldn't load WHOOP data: ${escapeHtml(body.error)}`);
      if (body.connected) { data = body; $('logout').hidden = false; }
    }
  } catch {
    showBanner('WHOOP data is only available on the deployed site.');
  }
  render();
}
function showBanner(html) { const b = $('banner'); b.innerHTML = html; b.hidden = false; }

// ---------- Render ----------
let current = null; // { week, day } for today

function render() {
  const pos = planPosition(today);
  const left = daysToRace(today);
  const p = userPaces();
  $('daysLeft').textContent = Math.max(0, left);
  if (data?.name) $('greeting').textContent = `Hey ${data.name}`;
  $('goalLabel').textContent = p ? `Goal ${fmtTime(p.halfTime)}` : '';

  renderRecovery();

  if (pos.before) {
    $('weekLabel').textContent = `Plan starts in ${pos.daysUntil} days`;
    $('todayTitle').textContent = 'Plan hasn\'t started yet';
    current = null;
  } else if (pos.after) {
    $('weekLabel').textContent = 'Plan complete';
    $('todayTitle').textContent = 'You did it. Recover well.';
    current = null;
  } else {
    current = pos;
    $('weekLabel').textContent = `Week ${pos.week + 1} of ${PLAN.length} · ${DAYS[pos.day]}`;
    renderToday(pos.week, pos.day);
  }
  $('todayLog').hidden = !current || PLAN[current.week][current.day].type === 'rest';

  const week = pos.week ?? (pos.before ? 0 : PLAN.length - 1);
  renderWeek(week);
  renderGoals();
  renderMilesChart(week);
  renderRecoveryChart();
  renderFullPlan(pos.week);
}

function renderRecovery() {
  const rec = recoveryFor(todayKey);
  const sl = sleepFor(todayKey);
  const cyc = lastCompletedCycle();
  const ring = $('ring');
  if (rec) {
    const z = recoveryZone(rec.score);
    ring.style.setProperty('--pct', rec.score);
    ring.style.setProperty('--c', ZONE[z].color);
    $('ringValue').textContent = `${Math.round(rec.score)}%`;
    $('ringLabel').textContent = 'recovery';
    $('hrv').textContent = `${Math.round(rec.hrv)} ms`;
    $('rhr').textContent = `${Math.round(rec.rhr)} bpm`;
  } else {
    $('ringValue').textContent = '–';
    $('ringLabel').textContent = data ? 'not scored yet' : 'recovery';
  }
  if (sl) $('sleep').textContent = `${Math.round(sl.performance)}%${sl.hours ? ` · ${sl.hours.toFixed(1)}h` : ''}`;
  if (cyc) $('strain').textContent = cyc.strain.toFixed(1);
}

function targetLinesHtml(lines) {
  return lines.map((l) => `<div><dt>${escapeHtml(l.label)}</dt><dd>${escapeHtml(l.value)}</dd></div>`).join('');
}

function renderToday(week, day) {
  const workout = PLAN[week][day];
  const rec = recoveryFor(todayKey);
  const sl = sleepFor(todayKey);
  const a = adjust(workout, rec?.score, { sleepPerf: sl?.performance });
  const z = recoveryZone(rec?.score);
  $('zoneTag').hidden = !z;
  if (z) $('zoneTag').innerHTML = `<i style="background:${ZONE[z].color}"></i>${ZONE[z].label} recovery`;
  $('todayTitle').textContent = a.title;
  $('todayPlanned').hidden = !a.changed || workout.type === 'optional';
  $('todayPlanned').textContent = `Planned: ${workout.title}`;
  $('todayDetail').textContent = a.detail;

  // Targets follow the workout you'll actually do: if recovery swapped it for an easy run, show easy pace.
  let shown = workout;
  if (a.changed) {
    if (/^rest/i.test(a.title) || /^cross/i.test(a.title)) shown = { type: 'rest' };
    else if (/\d+ mi/.test(a.title) && /easy/i.test(a.title) && !/tempo|\d+ x /.test(a.title)) shown = { type: 'easy', miles: parseFloat(a.title.match(/(\d+) mi/)[1]) };
  }
  const t = targetFor(shown, userPaces());
  $('todayTargets').hidden = !t.lines.length;
  $('todayTargetList').innerHTML = targetLinesHtml(t.lines);

  const st = dayStatus(week, day);
  $('todayDone').checked = st.done;
  $('todayDoneLabel').textContent = st.done ? (st.source === 'whoop' ? 'Done · from WHOOP' : 'Done') : 'Mark as done';
  $('todaySummary').innerHTML = summaryHtml(st, targetFor(workout, userPaces()));
}

function summaryHtml(st, target) {
  const parts = [];
  if (st.miles) parts.push(`${st.miles.toFixed(2)} mi`);
  if (st.time) parts.push(fmtTime(st.time));
  if (st.pace) parts.push(fmtPace(st.pace));
  if (st.log.rep) parts.push(`${fmtTime(st.log.rep)} avg rep`);
  if (!parts.length) return '';
  const cmp = compareFor(st, target);
  const chip = cmp ? ` <span class="chip ${cmp.status}">${cmp.status === 'on' ? '✓ ' : ''}${escapeHtml(cmp.text)}</span>` : '';
  return `<span>${parts.join(' · ')}</span>${chip}`;
}

function renderWeek(week) {
  const ol = $('week');
  ol.innerHTML = '';
  let logged = 0;
  PLAN[week].forEach((w, day) => {
    const date = dateFor(week, day);
    const st = dayStatus(week, day);
    logged += st.w.type === 'cross' ? 0 : (st.miles || 0);
    const isToday = st.key === todayKey;
    const isPast = st.key < todayKey;

    const li = document.createElement('li');
    li.className = [isToday && 'today', st.done && 'done', isPast && !st.done && w.type !== 'rest' && 'missed'].filter(Boolean).join(' ');
    let right = '';
    if (w.type === 'rest') right = '<span class="status">Rest</span>';
    else if (st.done) {
      const bits = [st.miles && `${st.miles.toFixed(1)} mi`, st.pace && fmtPace(st.pace)].filter(Boolean).join(' · ');
      right = `<span class="status">${bits || 'Done'}${st.source === 'whoop' ? '<em>WHOOP</em>' : ''}</span>`;
    } else if (isPast) right = '<span class="status">Missed?</span>';

    li.innerHTML = `
      ${w.type === 'rest' ? '<span class="cb-spacer"></span>' : `<label class="cb" aria-label="Mark ${DAYS[day]} done"><input type="checkbox" ${st.done ? 'checked' : ''}><span></span></label>`}
      <div class="d"><b>${DAYS[day]}</b>${date.getMonth() + 1}/${date.getDate()}</div>
      <div class="w">${escapeHtml(w.title)}</div>
      ${right}`;
    const cb = li.querySelector('input');
    if (cb) {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => { setLog(st.key, { ...st.log, done: cb.checked }); render(); });
      li.querySelector('.cb').addEventListener('click', (e) => e.stopPropagation());
    }
    li.addEventListener('click', () => openLog(week, day));
    ol.appendChild(li);
  });
  $('weekMiles').textContent = `${logged.toFixed(1)} / ~${plannedMiles(week)} mi`;
}

// ---------- Log sheet ----------
let editing = null;

function openLog(week, day) {
  const st = dayStatus(week, day);
  const w = st.w;
  editing = { week, day };
  const date = dateFor(week, day);
  $('logDate').textContent = `Week ${week + 1} · ${date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`;
  $('logTitle').textContent = w.title;

  const t = targetFor(w, userPaces());
  const rec = recoveryFor(st.key);
  let note = '';
  if (rec) {
    const a = adjust(w, rec.score);
    note = `Recovery ${Math.round(rec.score)}% · ${a.changed ? a.title : 'run as planned'}`;
  }
  $('logRecovery').textContent = note;
  $('logRecovery').hidden = !note;
  $('logTargets').hidden = !t.lines.length;
  $('logTargetList').innerHTML = targetLinesHtml(t.lines);

  // WHOOP activity that day
  $('logWhoop').hidden = !st.whoop.length;
  $('logWhoopList').innerHTML = st.whoop.map((x) => {
    const pace = x.miles ? fmtPace((x.minutes * 60) / x.miles) : '';
    return `<li>${escapeHtml(x.sport)} · ${fmtTime(x.minutes * 60)}${x.miles ? ` · ${x.miles.toFixed(2)} mi · ${pace}` : ''}${x.strain != null ? ` · strain ${x.strain.toFixed(1)}` : ''}</li>`;
  }).join('');
  $('useWhoop').hidden = !st.runs.length;

  const f = $('logForm');
  f.done.checked = st.done;
  f.miles.value = st.log.miles ?? '';
  f.time.value = st.log.time ? fmtTime(st.log.time) : '';
  f.rep.value = st.log.rep ? fmtTime(st.log.rep) : '';
  f.note.value = st.log.note ?? '';
  f.miles.placeholder = w.miles ? String(w.miles) : '0.0';
  $('repField').hidden = w.type !== 'interval';
  if (w.type === 'interval') $('repLabel').textContent = `Avg ${w.sets[0].m}m rep`;
  $('distField').hidden = w.type === 'cross';
  $('timeLabel').textContent = w.type === 'cross' ? 'Time (minutes)' : 'Total time';
  updateLivePace();
  $('logDialog').showModal();
}

function updateLivePace() {
  if (!editing) return;
  const f = $('logForm');
  const w = PLAN[editing.week][editing.day];
  const miles = parseFloat(f.miles.value);
  const time = parseTime(f.time.value);
  const rep = parseTime(f.rep.value);
  const t = targetFor(w, userPaces());
  const fake = { w, log: { rep }, pace: miles && time ? time / miles : null };
  const cmp = compareFor(fake, t);
  const bits = [];
  if (fake.pace) bits.push(`Pace ${fmtPace(fake.pace)}`);
  $('livePace').innerHTML = bits.join('') + (cmp ? ` <span class="chip ${cmp.status}">${cmp.status === 'on' ? '✓ ' : ''}${cmp.text}</span>` : '');
}

$('logForm').addEventListener('input', updateLivePace);
$('useWhoop').addEventListener('click', () => {
  const st = dayStatus(editing.week, editing.day);
  const f = $('logForm');
  const miles = st.runs.reduce((s, r) => s + (r.miles || 0), 0);
  const time = st.runs.reduce((s, r) => s + r.minutes * 60, 0);
  if (miles) f.miles.value = miles.toFixed(2);
  f.time.value = fmtTime(time);
  f.done.checked = true;
  updateLivePace();
});
$('logForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = $('logForm');
  const key = toKey(dateFor(editing.week, editing.day));
  const miles = parseFloat(f.miles.value);
  const w = PLAN[editing.week][editing.day];
  // Cross training time is entered in minutes.
  const raw = f.time.value.trim();
  const time = w.type === 'cross' && /^\d+$/.test(raw) ? Number(raw) * 60 : parseTime(raw);
  setLog(key, {
    done: f.done.checked || Boolean(miles || time),
    miles: Number.isFinite(miles) ? miles : undefined,
    time: time || undefined,
    rep: parseTime(f.rep.value) || undefined,
    note: f.note.value.trim() || undefined,
  });
  $('logDialog').close();
  render();
});
$('logClear').addEventListener('click', (e) => {
  e.preventDefault();
  setLog(toKey(dateFor(editing.week, editing.day)), {});
  $('logDialog').close();
  render();
});
$('logClose').addEventListener('click', (e) => { e.preventDefault(); $('logDialog').close(); });

$('todayDone').addEventListener('change', (e) => {
  if (!current) return;
  const st = dayStatus(current.week, current.day);
  setLog(st.key, { ...st.log, done: e.target.checked });
  render();
});
$('todayLogBtn').addEventListener('click', () => current && openLog(current.week, current.day));

// ---------- Goals ----------
function renderGoals() {
  const s = savedPaces();
  const p = userPaces();
  const form = $('paceForm');
  if (document.activeElement?.form !== form) {
    form.goal.value = s.goal || '';
    form.fiveK.value = s.fiveK || '';
  }
  if (!p) { $('goalHero').innerHTML = ''; $('paceTable').innerHTML = ''; return; }

  // Actual results to compare against race goals
  const trialWeek = PLAN.findIndex((w) => w.some((d) => d.type === 'trial'));
  const trialDay = PLAN[trialWeek].findIndex((d) => d.type === 'trial');
  const trial = dayStatus(trialWeek, trialDay);
  const race = dayStatus(12, 6);
  const result = (st, goal) => (st.time ? `<b>${fmtTime(st.time)}</b> <span class="chip ${st.time <= goal ? 'on' : 'slow'}">${st.time <= goal ? '✓ beat goal' : `+${fmtTime(st.time - goal)}`}</span>` : '<span class="muted">—</span>');

  $('goalHero').innerHTML = `
    <div class="hero-num">${fmtTime(p.halfTime)}</div>
    <div class="muted">Half marathon goal · ${fmtPace(p.half)} · Feb 14</div>`;

  $('raceGoals').innerHTML = `
    <tr><th></th><th>Goal</th><th>Actual</th></tr>
    <tr><td>5K</td><td>${fmtTime(p.fiveK * 3.10686)}</td><td><span class="muted">—</span></td></tr>
    <tr><td>10K <small>wk ${trialWeek + 1} trial</small></td><td>${fmtTime(p.tenK * 6.21371)}</td><td>${result(trial, p.tenK * 6.21371)}</td></tr>
    <tr><td>Half</td><td>${fmtTime(p.halfTime)}</td><td>${result(race, p.halfTime)}</td></tr>`;

  $('paceTable').innerHTML = `
    <tr><td>Easy &amp; long runs</td><td>${fmtPace(p.easyLow).replace('/mi', '')}–${fmtPace(p.easyHigh)}</td></tr>
    <tr><td>Goal half pace</td><td>${fmtPace(p.half)}</td></tr>
    <tr><td>Tempo</td><td>${fmtPace(p.tempo)}</td></tr>
    <tr><td>10K pace</td><td>${fmtPace(p.tenK)}</td></tr>
    <tr><td>5K pace</td><td>${fmtPace(p.fiveK)}</td></tr>
    <tr><td>Mile pace</td><td>${fmtPace(p.mile)}</td></tr>`;
}

$('editGoal').addEventListener('click', () => { $('paceForm').hidden = !$('paceForm').hidden; });
$('paceForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  store.set('paces', { fiveK: f.fiveK.value.trim(), goal: f.goal.value.trim() });
  f.hidden = true;
  render();
});

// ---------- Charts (SVG, one axis, recessive grid) ----------
function barChart(el, tipEl, items, { max, series, yTicks, height = 150 }) {
  const W = 340, H = height, L = 26, B = 18, T = 6;
  const plotW = W - L, plotH = H - B - T;
  const slot = plotW / items.length;
  const y = (v) => T + plotH - (v / max) * plotH;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of yTicks) svg += `<line class="grid" x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 4}" y="${y(t) + 3}" text-anchor="end">${t}</text>`;
  items.forEach((it, i) => {
    const x0 = L + i * slot;
    const bw = Math.min(14, (slot - 4 - (series.length - 1) * 2) / series.length);
    const groupW = bw * series.length + (series.length - 1) * 2;
    let x = x0 + (slot - groupW) / 2;
    for (const s of series) {
      const v = s.value(it);
      if (v > 0) {
        const top = y(Math.min(v, max));
        const h = T + plotH - top;
        const r = Math.min(4, h, bw / 2);
        svg += `<path d="M${x},${T + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${T + plotH} Z" fill="${s.color(it)}" class="bar" data-i="${i}"/>`;
      }
      x += bw + 2;
    }
    if (it.label) svg += `<text x="${x0 + slot / 2}" y="${H - 4}" text-anchor="middle" ${it.current ? 'style="fill:var(--text-primary);font-weight:600"' : ''}>${it.label}</text>`;
    svg += `<rect class="hit" x="${x0}" y="${T}" width="${slot}" height="${plotH}" data-i="${i}"><title>${escapeHtml(it.tip)}</title></rect>`;
  });
  svg += '</svg>';
  el.innerHTML = svg;
  el.querySelectorAll('.hit').forEach((r) => {
    const show = () => {
      el.querySelectorAll('.bar').forEach((b) => b.classList.toggle('sel', b.dataset.i === r.dataset.i));
      tipEl.textContent = items[r.dataset.i].tip;
    };
    r.addEventListener('click', show);
    r.addEventListener('mouseenter', show);
  });
}

function renderMilesChart(currentWeek) {
  const items = PLAN.map((days, wk) => {
    let actual = 0;
    days.forEach((d, day) => { if (d.type !== 'cross') actual += dayStatus(wk, day).miles || 0; });
    return {
      label: String(wk + 1),
      current: wk === currentWeek,
      planned: plannedMiles(wk),
      actual,
      tip: `Week ${wk + 1}: ~${plannedMiles(wk)} mi planned, ${actual.toFixed(1)} mi logged`,
    };
  });
  const max = Math.max(30, ...items.map((i) => Math.max(i.planned, i.actual)));
  const top = Math.ceil(max / 10) * 10;
  barChart($('milesChart'), $('milesTip'), items, {
    max: top,
    yTicks: [0, top / 2, top],
    series: [
      { value: (i) => i.planned, color: () => 'var(--planned)' },
      { value: (i) => i.actual, color: () => 'var(--series-1)' },
    ],
  });
}

function renderRecoveryChart() {
  const items = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    const rec = recoveryFor(toKey(d));
    items.push({
      label: i % 2 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '',
      current: i === 0,
      score: rec?.score ?? 0,
      tip: rec
        ? `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${Math.round(rec.score)}% (${ZONE[recoveryZone(rec.score)].label}) · HRV ${Math.round(rec.hrv)} ms · RHR ${Math.round(rec.rhr)}`
        : `${shortDate(d)}: no recovery data`,
    });
  }
  barChart($('recoveryChart'), $('recoveryTip'), items, {
    max: 100,
    yTicks: [0, 33, 67, 100],
    series: [{ value: (i) => i.score, color: (i) => ZONE[recoveryZone(i.score)]?.color || 'var(--planned)' }],
  });
  if (!data) $('recoveryTip').textContent = 'Connect WHOOP to see your recovery here.';
}

function renderFullPlan(currentWeek) {
  $('fullPlan').innerHTML = PLAN.map((days, wk) => `
    <div class="plan-week ${wk === currentWeek ? 'current' : ''}">
      <h4>Week ${wk + 1} · ${shortDate(dateFor(wk, 0))} – ${shortDate(dateFor(wk, 6))}</h4>
      <ol>${days.map((w, d) => {
        const st = dayStatus(wk, d);
        return `<li class="${st.done ? 'done' : ''}" data-w="${wk}" data-d="${d}"><span>${DAYS[d]} ${dateFor(wk, d).getMonth() + 1}/${dateFor(wk, d).getDate()}</span>${escapeHtml(w.title)}${st.done ? ' <b class="tick">✓</b>' : ''}</li>`;
      }).join('')}</ol>
    </div>`).join('');
  $('fullPlan').querySelectorAll('li').forEach((li) => li.addEventListener('click', () => openLog(Number(li.dataset.w), Number(li.dataset.d))));
}

load();
