// Small WHOOP API v2 client with token refresh.
export const AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
export const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
export const API = 'https://api.prod.whoop.com/developer';
export const SCOPES = 'offline read:recovery read:cycles read:sleep read:workout read:profile';

export async function tokenRequest(params) {
  const body = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
    ...params,
  });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`WHOOP token request failed (${r.status}): ${await r.text()}`);
  const t = await r.json();
  return {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in || 3600) * 1000 - 60000,
  };
}

// Returns a session with a valid access token (refreshing if needed) and whether it changed.
export async function freshSession(session) {
  if (session.access_token && session.expires_at > Date.now()) return { session, changed: false };
  if (!session.refresh_token) throw Object.assign(new Error('Not connected'), { status: 401 });
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refresh_token, scope: 'offline' });
  return { session: { ...session, ...t, refresh_token: t.refresh_token || session.refresh_token }, changed: true };
}

export async function get(session, path, query = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
  if (r.status === 401) throw Object.assign(new Error('WHOOP session expired'), { status: 401 });
  if (!r.ok) throw new Error(`WHOOP ${path} failed (${r.status})`);
  return r.json();
}

// Follows next_token pagination up to `maxPages`.
export async function getAll(session, path, query = {}, maxPages = 8) {
  let records = [];
  let nextToken;
  for (let i = 0; i < maxPages; i++) {
    const page = await get(session, path, { limit: 25, ...query, nextToken });
    records = records.concat(page.records || []);
    nextToken = page.next_token;
    if (!nextToken) break;
  }
  return records;
}
