import crypto from 'node:crypto';
import { AUTH_URL, SCOPES } from '../lib/whoop.js';
import { baseUrl, cookie, redirect } from '../lib/session.js';

export default function handler(req, res) {
  if (!process.env.WHOOP_CLIENT_ID) {
    res.statusCode = 500;
    return res.end('WHOOP_CLIENT_ID is not set. Add it in your Vercel project settings.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  const url = new URL(AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.WHOOP_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${baseUrl(req)}/api/callback`);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  redirect(res, url.toString(), [cookie('whoop_state', state, 600)]);
}
