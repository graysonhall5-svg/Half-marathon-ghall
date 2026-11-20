import { clearSessionCookie, redirect } from '../lib/session.js';

export default function handler(req, res) {
  redirect(res, '/', [clearSessionCookie()]);
}
