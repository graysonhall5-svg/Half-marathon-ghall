// Returns the WHOOP data the dashboard needs, trimmed to the fields it uses.
import { freshSession, get, getAll } from '../lib/whoop.js';
import { clearSessionCookie, getSession, sessionCookie } from '../lib/session.js';

const PLAN_START = '2026-11-16T00:00:00.000Z';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, body, cookies) => {
    res.statusCode = status;
    if (cookies) res.setHeader('Set-Cookie', cookies);
    res.end(JSON.stringify(body));
  };

  const existing = getSession(req);
  if (!existing) return send(401, { connected: false });

  let session;
  let changed;
  try {
    ({ session, changed } = await freshSession(existing));
  } catch (e) {
    return send(401, { connected: false, error: e.message }, [clearSessionCookie()]);
  }

  try {
    // 21 days of recovery/sleep/cycles for trends; workouts since the plan started.
    const since = new Date(Date.now() - 21 * 86400000).toISOString();
    const [profile, recovery, sleep, cycles, workouts] = await Promise.all([
      get(session, '/v2/user/profile/basic').catch(() => null),
      getAll(session, '/v2/recovery', { start: since }, 2),
      getAll(session, '/v2/activity/sleep', { start: since }, 2),
      getAll(session, '/v2/cycle', { start: since }, 2),
      getAll(session, '/v2/activity/workout', { start: PLAN_START }, 8),
    ]);

    // A recovery belongs to the morning you woke up, so date it by its sleep's end time.
    const sleepEnd = Object.fromEntries(sleep.map((s) => [s.id, s.end]));

    send(200, {
      connected: true,
      name: profile?.first_name || null,
      recovery: recovery
        .filter((r) => r.score_state === 'SCORED' && r.score)
        .map((r) => ({
          date: sleepEnd[r.sleep_id] || r.created_at,
          score: r.score.recovery_score,
          hrv: r.score.hrv_rmssd_milli,
          rhr: r.score.resting_heart_rate,
        })),
      sleep: sleep
        .filter((s) => !s.nap && s.score_state === 'SCORED' && s.score)
        .map((s) => ({
          end: s.end,
          performance: s.score.sleep_performance_percentage,
          hours: s.score.stage_summary
            ? (s.score.stage_summary.total_in_bed_time_milli - s.score.stage_summary.total_awake_time_milli) / 3600000
            : null,
        })),
      cycles: cycles
        .filter((c) => c.score)
        .map((c) => ({ start: c.start, end: c.end, strain: c.score.strain })),
      workouts: workouts.map((w) => ({
        start: w.start,
        sport: w.sport_name || String(w.sport_id),
        strain: w.score?.strain ?? null,
        miles: w.score?.distance_meter ? w.score.distance_meter / 1609.34 : null,
        minutes: (new Date(w.end) - new Date(w.start)) / 60000,
      })),
    }, changed ? [sessionCookie(session)] : undefined);
  } catch (e) {
    console.error(e);
    if (e.status === 401) return send(401, { connected: false }, [clearSessionCookie()]);
    send(502, { connected: true, error: e.message });
  }
}
