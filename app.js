import { PLAN, DAYS, plannedMiles } from './plan.js';
import {
  planPosition, dateFor, daysToRace, toKey, addDays, parseTime, paces, fmtPace, fmtTime,
  recoveryZone, adjust,
} from './coach.js';

const $ = (id) => document.getElementById(id);
const ZONE = {
  green: { color: 'var(--good)', label: 'Green' },
  yellow: { color: 'var(--warning)', label: 'Yellow' },
  red: { color: 'var(--critical)', label: 'Red' },
};
const isRun = (w) => /run|treadmill|track/i.test(w.sport);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// Allow ?date=2026-12-03 to preview another day.
const params = new URLSearchParams(location.search);
const today = params.get('date') ? new Date(params.get('date') + 'T12:00') : new Date();
const todayKey = toKey(today);

let data = null;

// ---------- Data ----------
async function load() {
  const err = params.get('error');
  if (err) showBanner(`WHOOP sign-in didn't finish (${err}). <a class="btn" href="/api/login">Try again</a>`);
  try {
    const r = await fetch('/api/data', { credentials: 'same-origin' });
    if (r.status === 401) {
      if (!err) showBanner('Connect WHOOP so the plan can adjust to your recovery. <br><a class="btn" href="/api/login">Connect WHOOP</a>');
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
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const localKey = (iso) => toKey(new Date(iso));
function recoveryFor(key) { return data?.recovery.find((r) => localKey(r.date) === key) || null; }
function sleepFor(key) { return data?.sleep.find((s) => localKey(s.end) === key) || null; }
function workoutsOn(key) { return data?.workouts.filter((w) => localKey(w.start) === key) || []; }
function lastCompletedCycle() { return data?.cycles.find((c) => c.end) || null; }

function userPaces() {
  const s = store.get('paces') || {};
  return paces(parseTime(s.fiveK), parseTime(s.goal));
}

function paceLine(workout, p) {
  if (!p) return '';
  const easy = `${fmtPace(p.easyLow)}–${fmtPace(p.easyHigh)}`;
  switch (workout.type) {
    case 'interval': {
      const parts = [];
      if (workout.pace.includes('5K')) parts.push(`5K pace ${fmtPace(p.fiveK)}`);
      if (workout.pace.includes('mile')) parts.push(`mile pace ${fmtPace(p.mile)}`);
      if (workout.pace.includes('half')) parts.push(`goal pace ${fmtPace(p.half)}`);
      return parts.join(' · ');
    }
    case 'tempo': return `Tempo pace ${fmtPace(p.tempo)}`;
    case 'long': return workout.note ? `Easy ${easy}, last 2 at ${fmtPace(p.half)}` : `Easy ${easy}`;
    case 'race': return `Goal pace ${fmtPace(p.half)} (${fmtTime(p.halfTime)})`;
    case 'trial': return `Aim around ${fmtPace(p.fiveK + 15)}`;
    case 'easy': case 'optional': case 'shakeout': return `Easy ${easy}`;
    default: return '';
  }
}

// ---------- Render ----------
function render() {
  const pos = planPosition(today);
  const left = daysToRace(today);
  $('daysLeft').textContent = Math.max(0, left);
  if (data?.name) $('greeting').textContent = `Hey ${data.name}`;

  renderRecovery();

  if (pos.before) {
    $('weekLabel').textContent = `Plan starts in ${pos.daysUntil} days`;
    $('todayTitle').textContent = 'Plan hasn\'t started yet';
  } else if (pos.after) {
    $('weekLabel').textContent = 'Plan complete';
    $('todayTitle').textContent = left === 0 ? 'Race day!' : 'You did it. Recover well.';
  } else {
    $('weekLabel').textContent = `Week ${pos.week + 1} of ${PLAN.length} · ${DAYS[pos.day]}`;
    renderToday(PLAN[pos.week][pos.day]);
  }

  const week = pos.week ?? (pos.before ? 0 : PLAN.length - 1);
  renderWeek(week, pos);
  renderMilesChart(week);
  renderRecoveryChart();
  renderFullPlan(pos.week);
  renderPaces();
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
    $('hrv').textContent = `${Math.round(rec.hrv)} ms`;
    $('rhr').textContent = `${Math.round(rec.rhr)} bpm`;
  } else {
    $('ringValue').textContent = '–';
    $('ringValue').nextElementSibling.textContent = data ? 'not scored yet' : 'recovery';
  }
  if (sl) $('sleep').textContent = `${Math.round(sl.performance)}%${sl.hours ? ` · ${sl.hours.toFixed(1)}h` : ''}`;
  if (cyc) $('strain').textContent = cyc.strain.toFixed(1);
}

function renderToday(workout) {
  const rec = recoveryFor(todayKey);
  const sl = sleepFor(todayKey);
  const a = adjust(workout, rec?.score, { sleepPerf: sl?.performance });
  const z = recoveryZone(rec?.score);
  $('todayTitle').innerHTML = (z ? `<span class="zone-tag"><i style="background:${ZONE[z].color}"></i>${ZONE[z].label} recovery</span><br>` : '') + escapeHtml(a.title);
  $('todayPlanned').hidden = !a.changed || workout.type === 'optional';
  $('todayPlanned').textContent = `Planned: ${workout.title}`;
  $('todayDetail').textContent = a.detail;
  let shown = workout;
  if (a.changed) {
    if (/^rest/i.test(a.title) || /^cross/i.test(a.title)) shown = { type: 'rest' };
    else if (/\d+ mi/.test(a.title) && /easy/i.test(a.title) && !/tempo|\d+ x /.test(a.title)) shown = { type: 'easy' };
  }
  const line = paceLine(shown, userPaces());
  $('todayPaces').hidden = !line;
  $('todayPaces').textContent = line;
}

function renderWeek(week, pos) {
  const ol = $('week');
  ol.innerHTML = '';
  let logged = 0;
  PLAN[week].forEach((w, day) => {
    const date = dateFor(week, day);
    const key = toKey(date);
    const done = workoutsOn(key);
    const runs = done.filter(isRun);
    logged += runs.reduce((s, r) => s + (r.miles || 0), 0);
    const isPast = key < todayKey;
    const isToday = key === todayKey;
    const rec = recoveryFor(key);

    let status = '';
    const matched = w.type === 'cross' ? done.length : w.type === 'rest' ? 0 : runs.length;
    if (matched) {
      const miles = runs.reduce((s, r) => s + (r.miles || 0), 0);
      status = `<span class="status done">${miles ? miles.toFixed(1) + ' mi' : 'Done'}<span class="check" aria-label="logged">✓</span></span>`;
    } else if (w.type === 'rest') {
      status = '<span class="status">Rest</span>';
    } else if (isPast && data) {
      status = '<span class="status">Not logged</span>';
    } else if (isToday && rec) {
      const z = recoveryZone(rec.score);
      status = `<span class="status">${ZONE[z].label}</span>`;
    } else {
      status = '<span class="status"></span>';
    }

    const li = document.createElement('li');
    if (isToday) li.className = 'today';
    li.innerHTML = `<div class="d"><b>${DAYS[day]}</b>${date.getMonth() + 1}/${date.getDate()}</div><div class="w">${escapeHtml(w.title)}</div>${status}`;
    li.addEventListener('click', () => openDay(week, day));
    ol.appendChild(li);
  });
  $('weekMiles').textContent = `${data ? logged.toFixed(1) + ' / ' : ''}~${plannedMiles(week)} mi`;
}

function openDay(week, day) {
  const w = PLAN[week][day];
  const date = dateFor(week, day);
  const key = toKey(date);
  const rec = recoveryFor(key);
  $('dlgDate').textContent = `Week ${week + 1} · ${date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`;
  $('dlgTitle').textContent = w.title;
  const p = paceLine(w, userPaces());
  let body = p ? p + '. ' : '';
  if (rec) {
    const a = adjust(w, rec.score);
    body += `Recovery ${Math.round(rec.score)}%: ${a.changed ? a.title + '. ' : ''}${a.detail}`;
  }
  $('dlgBody').textContent = body || (key > todayKey ? 'Coming up.' : '');
  const ul = $('dlgLogged');
  ul.innerHTML = workoutsOn(key).map((x) =>
    `<li>${escapeHtml(x.sport)} · ${Math.round(x.minutes)} min${x.miles ? ` · ${x.miles.toFixed(2)} mi` : ''}${x.strain != null ? ` · strain ${x.strain.toFixed(1)}` : ''}</li>`).join('');
  $('dayDialog').showModal();
}

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
        // Rounded top, square base anchored to the baseline.
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
  const actual = PLAN.map((_, wk) => {
    let m = 0;
    for (let d = 0; d < 7; d++) m += workoutsOn(toKey(dateFor(wk, d))).filter(isRun).reduce((s, r) => s + (r.miles || 0), 0);
    return m;
  });
  const items = PLAN.map((_, wk) => ({
    label: String(wk + 1),
    current: wk === currentWeek,
    planned: plannedMiles(wk),
    actual: actual[wk],
    tip: `Week ${wk + 1}: ~${plannedMiles(wk)} mi planned${data ? `, ${actual[wk].toFixed(1)} mi logged` : ''}`,
  }));
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
    const key = toKey(d);
    const rec = recoveryFor(key);
    items.push({
      label: i % 2 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '',
      current: i === 0,
      score: rec?.score ?? 0,
      tip: rec
        ? `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${Math.round(rec.score)}% (${ZONE[recoveryZone(rec.score)].label}) · HRV ${Math.round(rec.hrv)} ms · RHR ${Math.round(rec.rhr)}`
        : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: no recovery data`,
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
      <h4>Week ${wk + 1} · ${dateFor(wk, 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${dateFor(wk, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</h4>
      <ol>${days.map((w, d) => `<li><span>${DAYS[d]} ${dateFor(wk, d).getMonth() + 1}/${dateFor(wk, d).getDate()}</span>${escapeHtml(w.title)}</li>`).join('')}</ol>
    </div>`).join('');
}

function renderPaces() {
  const s = store.get('paces') || {};
  const form = $('paceForm');
  form.fiveK.value = s.fiveK || '';
  form.goal.value = s.goal || '';
  const p = userPaces();
  $('paceTable').innerHTML = p ? `<table>
    <tr><td>Easy / long runs</td><td>${fmtPace(p.easyLow)}–${fmtPace(p.easyHigh)}</td></tr>
    <tr><td>Tempo</td><td>${fmtPace(p.tempo)}</td></tr>
    <tr><td>Goal half pace</td><td>${fmtPace(p.half)} (${fmtTime(p.halfTime)})</td></tr>
    <tr><td>5K pace</td><td>${fmtPace(p.fiveK)}</td></tr>
    <tr><td>Mile pace</td><td>${fmtPace(p.mile)}</td></tr>
  </table>` : '';
}

$('paceForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  store.set('paces', { fiveK: f.fiveK.value.trim(), goal: f.goal.value.trim() });
  render();
});

load();
