# Setup — database, admin and links

## 1. Connect Neon

Vercel dashboard → the project serving `roi.brandologist.in` → **Storage** →
**Create Database** → **Neon** (Marketplace) → connect it to this project for
Production, Preview and Development.

That injects `DATABASE_URL` automatically. Nothing else to configure — the two
tables are created on the first write (`lib/db.js` runs `create table if not
exists` on every cold start).

If the project was connected with the older Vercel Postgres integration it will
set `POSTGRES_URL` instead; the code accepts either.

## 2. Set the admin environment variables

Vercel → **Settings** → **Environment Variables**, all three for **Production**
(and Preview if you want the admin page there too):

| Variable | Value |
| --- | --- |
| `ADMIN_EMAIL` | `team@brandologist.in` |
| `ADMIN_PASSWORD_HASH` | the `scrypt$…` string generated below |
| `SESSION_SECRET` | a long random string, e.g. from the same command |

Generate both values:

```bash
node scripts/hash-password.mjs 'your-password-here'
```

The plaintext password is never stored in this repo, never sent to the browser,
and never committed. Only the scrypt hash lives in Vercel.

To change the password later, re-run that command and update
`ADMIN_PASSWORD_HASH`. No code change, no redeploy of the front end needed —
just redeploy so the new env var is picked up.

## 3. Redeploy

Env vars are read at build/run time, so redeploy after setting them.

---

## Where the leads live

Two separate Postgres tables, on purpose — different shapes, different
lifecycles, exported separately.

**`roi_leads`** — Exhibition ROI Score assessment.
One row per person. Created when they pass the score gate, then *updated in
place* when they complete the qualification step or request a review. (The old
Google Sheet appended a new row for each of those, so one person produced three
rows that had to be reconciled by phone number.)

**`playbook_leads`** — Playbook early access.
One row per request. These people may never have taken the assessment — the
`#playbook` deep link drops them straight onto the form — so they have their own
table with `contact_mode` (`phone` or `email`) and a `source` column.

`source` values: `playbook-direct-link` (arrived on the deep link),
`after-assessment` (already had a score), `page-scroll` (scrolled to it).

### Fallback

If `DATABASE_URL` is missing or the API is unreachable, the client falls back to
the existing Apps Script → Google Sheet webhook, so leads are never dropped
mid-migration. Once Neon is live and you have seen rows arriving, that fallback
can be removed (`SHEET_WEBHOOK_URL` in `js/main.js`).

---

## Admin page

`https://roi.brandologist.in/admin`

Sign in with the email and password above. Then:

- Switch between **Exhibition ROI Score** and **Playbook Early Access** with the
  tabs.
- **Export CSV** downloads whichever table is currently active — the export
  always matches the tab you're looking at.
- The filter box narrows what's shown on screen; the export always contains the
  full table, not the filtered view.

Sessions last 12 hours, in an HttpOnly + Secure + SameSite=Strict cookie.

---

## The Playbook deep link

Share this to send someone straight to the book lead magnet:

```
https://roi.brandologist.in/#playbook
```

`#book` and `#early-access` work identically. Arriving on any of them scrolls
to the early-access form, highlights it briefly, and tags the resulting lead
`playbook-direct-link` so those conversions are attributable.

Add campaign parameters as usual — they are stored on the lead:

```
https://roi.brandologist.in/?utm_source=whatsapp&utm_campaign=playbook#playbook
```

---

## Local development

```bash
npm install
npx vercel dev
```

`vercel dev` runs the API routes locally. Without a `DATABASE_URL` in
`.env.local` the API returns `503 database_not_configured` and the client falls
back to the sheet, which is the intended behaviour.
