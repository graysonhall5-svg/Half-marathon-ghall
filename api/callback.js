import { tokenRequest } from '../lib/whoop.js';
import { baseUrl, cookie, readCookies, redirect, sessionCookie } from '../lib/session.js';

export default async function handler(req, res) {
  const url = new URL(req.url, baseUrl(req));
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = readCookies(req).whoop_state;
  const clearState = cookie('whoop_state', '', 0);

  if (url.searchParams.get('error')) return redirect(res, '/?error=' + encodeURIComponent(url.searchParams.get('error')), [clearState]);
  if (!code || !state || state !== expected) return redirect(res, '/?error=state_mismatch', [clearState]);

  try {
    const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: `${baseUrl(req)}/api/callback` });
    redirect(res, '/', [clearState, sessionCookie(tokens)]);
  } catch (e) {
    console.error(e);
    redirect(res, '/?error=token_exchange_failed', [clearState]);
  }
}
