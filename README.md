# Half Marathon Coach

A phone-first web app for my 13-week half marathon plan (Nov 16, 2026 → race Sun, Feb 14, 2027).
Each morning it pulls my WHOOP recovery, sleep and strain and adjusts the day's workout:

- **Green (67%+)**: run it as written; Saturday's optional run is on.
- **Yellow (34–66%)**: trim intervals/tempo by about a third, keep long runs all easy, rest Saturday.
- **Red (0–33%)**: swap hard sessions for an easy 3 mi, cut long runs ~30%, halve easy days.

It also shows the week with workouts logged on WHOOP, planned vs. logged miles, a 14-day recovery chart,
and training paces from a recent 5K or goal time.

## Setup

1. **WHOOP developer app** at [developer.whoop.com](https://developer.whoop.com): create an app with scopes
   `read:recovery read:cycles read:sleep read:workout read:profile offline` and redirect URL
   `https://<your-vercel-domain>/api/callback`.
2. **Deploy on Vercel**: import this repo (Framework preset: Other, no build command) and add environment variables:
   - `WHOOP_CLIENT_ID`
   - `WHOOP_CLIENT_SECRET`
   - `SESSION_SECRET`: any 32+ character random string
   - `APP_URL` (optional): e.g. `https://half-marathon-coach.vercel.app`
3. Open the site on your phone, tap **Connect WHOOP**, then use Share → **Add to Home Screen**.

Tokens are kept in an encrypted, HTTP-only cookie; there's no database.
Preview any date with `?date=2026-12-20`. Run tests with `npm test`.
