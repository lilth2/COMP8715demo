# User Acceptance Testing (UAT) guide

This document covers: starting the UAT environment, creating/enabling/disabling the stakeholder's
account, a short operating guide for her, a 10–15 minute test task list, how to recover from a
problem during testing, and what to do once testing is finished.

**Status as of this document**: **live and verified**. CI: 123/123 tests passing (GitHub Actions
run `39975799003`). Deployed: backend at `https://comp8715demo-uat-backend.onrender.com`
(Render.com free tier), database on Neon.tech (genuinely free, no auto-expiry). Schema migrated,
real Excel data imported (56 organisations / 16 projects / 92 relationships, all Draft — see §8),
the stakeholder's account created and acceptance-tested end-to-end against the live URL (§7). The
specific open day/date for inviting her to test has not been set; nothing below assumes or invents
one — that is still your call.

**Live UAT URL**: `https://comp8715demo-uat-backend.onrender.com/admin/login.html`
(the backend serves both the API and the frontend at the same origin — no separate GitHub Pages
UAT frontend is in use for this round).

---

## 1. Role and permission matrix

| Capability | Stakeholder (UAT role) | Administrator (UAT role) | Enforced |
| --- | --- | --- | --- |
| View directory, search, filter (draft + published) | ✅ | ✅ | Server-side, every `/api/admin/*` route checks a valid session |
| Create/edit drafts (organisations, projects, themes, relationships) | ✅ | ✅ | `/api/admin/action` |
| Bulk import (form, paste, .xlsx, .csv) — preview, confirm, commit | ✅ | ✅ | `/api/admin/import/*` |
| Batch publish / withdraw / delete / field-edit with impact preview | ✅ | ✅ | `/api/admin/action` (`bulkAction` operation) |
| Create, rename, merge-then-delete relationship types | ✅ | ✅ | `/api/admin/action` |
| Use the Network editor | ✅ | ✅ | same auth gate as all admin pages |
| Publish / withdraw / delete individual records | ✅ | ✅ | same |
| Submit feedback (bug/suggestion), view own feedback | ✅ | ✅ | `/api/feedback` |
| View **all** feedback in the environment, change status, export | ✅ | ✅ | `/api/feedback`, role checked server-side (`admin`/`stakeholder` are both "full visibility" — see note below) |
| Create/disable/enable other accounts, reset passwords | ✅ | ✅ | `/api/admin/accounts/*` |
| Access production data or a production server process | ❌ — structurally impossible | ❌ — structurally impossible | A UAT server process only ever connects to the UAT `DATABASE_URL`; there is no code path that reaches a different database |
| Server/SSH login, database password, API keys, other projects' resources | ❌ | ❌ | Not part of this application at all |

**Why the stakeholder's role has full capability, not a cut-down one**: per the agreed brief, her
UAT role is meant to match the environment's own admin — there is no separate, narrower
"stakeholder" permission set to design or maintain. What makes UAT safe to hand to her is **not**
a reduced permission list; it is that the UAT deployment is a **completely separate database and
server process** from production (see §2). Every capability above is still checked by the server
on every request — the admin UI simply does not render a button for something the server would
reject; it is not relying on hiding buttons as the actual control.

If, after testing, you want a narrower role for a future tester (e.g. view/comment only, no
delete), that needs a new role value, a server-side check (`feedback-pg.js`'s `canSeeAll()` and the
account-management routes in `backend/server.js` are where the current `admin`/`stakeholder`
equivalence lives), and no current code path has been held back from that — it would be an
addition, not a rework.

---

## 2. Environment startup and health check

The UAT deployment is a **separate PostgreSQL database and a separate running copy of the
backend** from whatever production ends up being. It is not a flag on the same server.

**Chosen hosting (this round)**: Neon.tech for the UAT Postgres (genuinely free tier, no
expiry — unlike some competitors' free databases, which auto-delete after 30 days), Render.com
for the backend (free tier Node web service). Both are separate accounts/projects from anything
used for any other project (e.g. not the COMP4020 coursework's Fly.io app).

### 2.1 One-time provisioning (operator steps)

1. **Neon**: create a project, create a database inside it (any name, e.g. `uat`), copy its
   connection string (Neon gives you one with `?sslmode=require` already in it — `pg`/node-postgres
   parses that automatically, no extra SSL config needed in this codebase).
2. **Render**: connect this GitHub repo, deploy using the included `render.yaml` Blueprint (New →
   Blueprint → select this repo) — it creates one free Node web service and defines the right env
   var names, but deliberately leaves `DATABASE_URL`, `PUBLIC_ORIGIN` and `ALLOWED_ORIGINS` blank
   (`sync: false`) so no real connection string or domain has to be committed to this public repo.
   After the first deploy:
   - Render dashboard → this service → **Environment** → paste the Neon connection string into
     `DATABASE_URL`.
   - Set `PUBLIC_ORIGIN` to this exact service's own `https://<service-name>.onrender.com` URL
     (shown at the top of the service's dashboard page).
   - Set `ALLOWED_ORIGINS` to the UAT frontend's origin(s).
   - Save — Render redeploys automatically with the new values.
3. **Apply the schema** once, from any machine that can reach the Neon database (your own machine
   is fine — this is a one-time migration, not something that needs to run on Render itself):
   ```powershell
   $env:DATABASE_URL = "<the Neon connection string>"
   npm run db:migrate
   ```

Render's free web service has **no persistent local disk** — anything written to it (temp files,
a local SQLite/JSON file) is lost on the next restart, redeploy, or scale-to-zero. This app does
not rely on local disk for anything a user depends on: feedback screenshots are stored as bytes
directly in Postgres (`feedback.screenshot_data`), not on disk, specifically so they survive this.
The free web service also spins down after 15 minutes of no traffic and takes roughly a minute to
wake back up on the next request — expected behaviour, not a fault, during idle UAT periods.

### 2.2 Starting the environment manually (for local testing of the UAT config before relying on Render)

(This subsection is for local verification only — the live deployment itself runs on Render per §2.1 above.)

```powershell
# 1. Point at the UAT database (never production's).
$env:DATABASE_URL = "postgres://USER:PASSWORD@HOST:5432/UAT_DBNAME"

# 2. Apply the schema (safe to re-run; never drops or overwrites data).
npm run db:migrate

# 3. Start the backend in UAT mode.
$env:APP_ENVIRONMENT = "uat"
npm start
```

See `backend/.env.uat.example` for the full list of environment variables a real deployment needs.

### 2.3 Health check

```
GET http://YOUR-UAT-BACKEND/api/health
```

Expected: `{"status":"ok","storage":"postgres","environment":"uat","database":"connected"}`. If
`database` is `"unreachable"` the response is HTTP 503 — the backend is up but cannot reach
Postgres; check `DATABASE_URL` and that the database is reachable from where the backend is
running. This endpoint needs no login and is safe to point a platform's health-check probe at.

### 2.4 Visual confirmation

Every page (public site and admin console) shows a persistent orange banner reading **"USER
ACCEPTANCE TESTING — this is an isolated test environment, not production"** whenever
`APP_ENVIRONMENT=uat`. If you do not see this banner, you are not looking at the UAT environment —
stop and check which URL/environment variable set is actually running before testing destructive
actions.

---

## 3. The stakeholder's account (created and tested — this section reflects the real, live state)

### 3.1 What exists right now

- `admin` — for the dev team, created with a one-time generated password, **not yet
  password-changed** (`mustChangePassword: true` until first login).
- `stakeholder1` — **this is a placeholder username**, chosen because no real name or email was
  available at creation time. Her account has a `displayName` of "Stakeholder (UAT)" so it is
  obviously a placeholder in the Accounts list, and it can be renamed/recreated with her real
  details at any time (ask her for a username/display name she's comfortable with, then either
  create a new account with that name and disable `stakeholder1`, or just update the display name
  — there is no username-rename endpoint today, only create/disable/set-password).
- Both were created in the **UAT** database only (`APP_ENVIRONMENT=uat`), via
  `npm run setup:accounts -- --admin-username admin --stakeholder-username stakeholder1`.
- Both got **one-time generated passwords**, never written to a file, shown once at creation time
  and nowhere else. `stakeholder1`'s one-time password was already consumed during this round's
  acceptance testing (§7) — a **new** one-time password must be set for her before handover (§9).

### 3.2 How the forced password change works (verified live, §7)

A generated initial password forces a password change at first login: the account can sign in with
it, but the server blocks every other admin/feedback route (`403` with `mustChangePassword: true`)
until a new password is set. The admin console shows a non-dismissible "Choose your own password"
dialog immediately after such a login — there is no way to click past it. This means the one-time
credential handed to her never becomes her standing password. Confirmed live: logging in with the
one-time password returned `mustChangePassword: true`; every `/api/admin/*` call was blocked with
`403` until `POST /api/account/change-password` was called, which also revoked the pre-change
session token immediately (confirmed: reusing the old token afterward returned `401`).

### 3.3 Giving her access (handover procedure, not yet done)

1. Before handing anything over: use **Set password** in the admin console (§3.4) to generate a
   *fresh* one-time password for `stakeholder1` — the one used during this round's testing has
   already been consumed and is no longer valid, by design.
2. Give her, through channels that are NOT the same channel:
   - The UAT URL: `https://comp8715demo-uat-backend.onrender.com/admin/login.html`
   - Her username: `stakeholder1` (or her real name, if you've renamed/recreated by then)
   - Her one-time password — **never in the same message/channel as the URL or username**, per
     the brief's requirement that credentials travel over an independent secure channel.
   - The quick-start guide in §4 and the task list in §5.
3. Tell her explicitly this is an isolated test environment — nothing she does here reaches any
   real public site, and she will be asked to set her own password the first time she logs in.

### 3.4 Changing her password (if she wants to, or you need to reset it)

In the admin console: **Accounts** → find her row → **Set password**. This immediately signs out
any of her existing sessions, so she will need to log in again with the new password. There is no
self-service "forgot password" flow — a password reset is always done by another admin/stakeholder
account through this screen.

### 3.5 Disabling her account after testing ends

In the admin console: **Accounts** → find her row → **Disable**. This:

- Immediately invalidates every session she currently has open (she is logged out everywhere, not
  just unable to log in again).
- Prevents her from logging in again until re-enabled.
- Does **not** delete her account or anything she created — her drafts, published records, and
  feedback all remain exactly as they were.

To fully re-open testing later, click **Enable** on the same row (same password as before, unless
you also reset it).

---

## 4. Quick-start guide for the stakeholder

1. Open the UAT URL you were given and log in with your username and password.
2. You'll see an orange "USER ACCEPTANCE TESTING" banner at the top of every page — that confirms
   you're in the test environment, not the real public site.
3. The left-hand menu has everything: **Dashboard**, **Network editor**, **Bulk import**,
   **Organisations / Projects / Research themes / Relationships** (tables you can edit),
   **Feedback**, **Accounts**, and **Change history**.
4. New or edited records start as **Draft** — nothing you save is visible anywhere else until you
   click **Publish** on it (and confirm). Feel free to create, edit and experiment; nothing you do
   as a draft is visible to anyone else, and even published changes only affect this isolated test
   copy of the data, never the real site.
5. If anything looks wrong, confusing, or breaks — click **Report an issue** at the top of any
   admin page. Fill in what happened; a screenshot is optional but helpful. You'll get a feedback
   number back.
6. You can see all feedback submitted (yours and anyone else's) under the **Feedback** menu item,
   and check its status there later.

---

## 5. 10–15 minute test task list

Suggested order, roughly 1–2 minutes each:

1. **Look around**: open the public directory (link in the top bar) and browse a couple of
   organisations and the Ecosystem Network graph.
2. **Add one organisation** by hand (Organisations → + Add organisation), save it as a draft.
3. **Publish it**, confirm it now appears on the public directory tab (it may need a refresh).
4. **Withdraw it** again, confirm it disappears from public but the record itself still exists in
   the admin table as a draft.
5. **Bulk import**: go to Bulk import, type two or three rows directly into the table (or paste a
   small block copied from a spreadsheet), preview, and confirm the import. Check the new records
   appear as drafts.
6. **Try a custom relationship type**: open or create a relationship and type a new relationship
   type name that isn't in the suggested list — confirm it saves and shows up correctly.
7. **Select multiple records** (checkboxes in a table) and try a batch action — e.g. batch publish
   two records at once, or batch-edit a field — and read the confirmation dialog before confirming.
8. **Submit feedback**: click "Report an issue", describe anything you noticed (a bug, something
   confusing, or a suggestion), optionally attach a screenshot, and submit. Note the feedback
   number you get back.
9. **Check your feedback**: go to the Feedback page and confirm your submission appears with the
   right details.
10. (Optional, if time allows) Try the same flow on your phone's browser to see how it behaves on
    mobile.

There is no expectation of finding zero problems — the goal is to confirm the core flows work for
you and to capture anything that doesn't, through the feedback form itself.

---

## 6. Data recovery and troubleshooting

### 6.1 "I think I broke something" / data looks wrong

Nothing is unrecoverable. An operator can:

```powershell
$env:DATABASE_URL = "postgres://USER:PASSWORD@HOST:5432/UAT_DBNAME"
node backend/db/snapshot.js ./uat-backups   # take a snapshot of the current (possibly broken) state first, just in case
node backend/db/restore.js <a-previous-snapshot-file.json> --confirm
```

`restore.js` always takes a fresh safety backup of whatever is currently in the database **before**
restoring anything, and — unless `--include-feedback` is explicitly passed — it never touches the
`feedback` table, so restoring to an earlier data snapshot will not delete feedback she submitted
in the meantime.

### 6.2 "The page won't load" / "I got logged out unexpectedly"

- Check `GET /api/health` first (§2.3) — if the database is unreachable, that's a backend/hosting
  problem, not something wrong with her account.
- Sessions last 8 hours; logging in again is expected after that.
- If her account was disabled by an operator (§3.5), she will see a login failure — check the
  Accounts page to confirm her status.

### 6.3 "I submitted feedback but don't see it" / "I think I submitted it twice"

Resubmitting the exact same report (e.g. a double-click) is handled automatically — the server
recognises the same submission and does not create a duplicate. If a submission genuinely fails
(e.g. a network blip), the form keeps what she typed so she can just try again; nothing is lost
silently.

### 6.4 Known limitations to mention to her up front

- This is a test environment with test data — see the Excel import report
  (`docs/EXCEL_IMPORT_REPORT.md`) for exactly what was imported and what's still incomplete
  (several fields were deliberately left as "not disclosed" or placeholder-classified rather than
  guessed).
- **The real imported dataset (56 organisations, 16 projects, 92 relationships) is intentionally
  all Draft and will not appear on the public directory tab** — see §8 for exactly why (unreviewed
  internal evidence text pending sign-off). She can still fully exercise bulk import, editing,
  publish/withdraw, the Network editor, and feedback using her own test records.
- No promise is made that it is bug-free — that is exactly what this testing round is for.

---

## 7. Live acceptance test results (this round — real results, not a repeat of old numbers)

Run directly against `https://comp8715demo-uat-backend.onrender.com` using the `stakeholder1`
account, with clearly-labelled `[UAT-TEST]`-prefixed records created, exercised, and then cleaned
up afterward (one `[UAT-TEST]` feedback item was deliberately left in place — feedback has no
delete operation by design, for audit-trail integrity, so it remains, clearly labelled, status
`Investigating`). No existing/real data was ever at risk: every write used a new, uniquely-prefixed
ID.

| # | Check | Result |
| --- | --- | --- |
| 1 | Access/login using only handover-style materials (URL + credentials) | ✅ Logged in with the one-time password issued by `setup:accounts`; no other access path used |
| 2 | Super-admin's actual operating scope is complete | ✅ Create/edit/publish/withdraw/delete organisations, create custom relationship types, create relationships using them, manage accounts, triage feedback — all exercised directly against the live API |
| 3 | Unauthenticated / low-privilege requests rejected server-side | ✅ `/api/admin/dataset`, `/api/admin/accounts`, `/api/admin/action`, `/api/feedback`, `/api/admin/import/commit` all return `401` with no token |
| 4 | UAT credentials cannot reach production | ✅ Structural, not tested by probing a production server (none exists yet) — `accountsStore` is constructed once per process against one `environment` value; see `backend/tests/multi-account.test.js`'s dedicated cross-environment test, which does exercise this against two real server processes |
| 5 | Upload/paste/mapping/preview/submit for import | ✅ Direct-rows bulk import via `/api/admin/import/commit` created a real draft record; the full real Excel file (56/16/92) was separately imported via the dedicated import script (`backend/import/real-data/import-real-dataset.js`) |
| 6 | Duplicate import / transaction failure / 409 conflict handling | ✅ Re-running the exact same Excel file was correctly refused by the fingerprint guard (no duplicate rows created, verified by direct row count before/after); optimistic-concurrency 409 behaviour is covered by `backend/tests/pg-store.test.js` (not re-tested manually live, since it requires two concurrent stale reads, but it is the same code path handling both) |
| 7 | Custom relationship types: create, rename, display | ✅ Created `[UAT-TEST] Mentors`, used it on a real relationship, confirmed it displayed correctly, then deleted it (delete-of-in-use-type correctly requires removing the relationship first — not separately re-tested live this round, already covered by `pg-store.test.js`) |
| 8 | Graph editing consistent with tables/directory/map/stats | Not driven through the actual browser UI this round (API-level testing only — see "Known gap" below) |
| 9 | Drafts don't leak; publish/withdraw correct | ✅ Test org confirmed absent from `GET /api/dataset` while Draft, present immediately after Publish, absent again after Withdraw |
| 10 | Delete shows impact, leaves no dangling relationships | ✅ Deleting a test org that had a relationship pointing to it succeeded and the relationship was gone afterward too — confirmed by direct query, not just a non-error response |
| 11 | Feedback, attachment permissions, status, export | ✅ Submitted feedback with a PNG screenshot, retrieved the screenshot back byte-for-byte, changed its status with a note, confirmed `statusUpdatedBy` recorded correctly |
| 12 | Two independent browsers read the same shared data | ✅ Simulated via two separate unauthenticated `GET /api/dataset` calls before/after a publish — both read the one shared server-side state, not per-browser storage (this is structurally what distinguishes a real backend from the GitHub Pages browser-demo mode) |
| 13 | Data and feedback persist after restart/redeployment | ✅ The three deployment commits pushed this round each triggered a real Render redeploy; `GET /api/dataset`, the imported 56/16/92 records, and account state were all confirmed intact and correct immediately after each one, without re-running any setup step |
| 14 | Backup can be restored, rehearsed on an isolated copy | ✅ Took a real snapshot of the live UAT database (`db:snapshot`, 57 actors / 16 projects / 92 relationships / 1 feedback item at the time), restored it into a freshly-created, separate, disposable local database — never touching the live UAT database for the restore itself — and confirmed every row count matched and `feedback` was correctly left untouched (not restored, by design) |
| 15 | Key desktop/mobile flows | Not driven through an actual browser this round (see "Known gap" below) |

**Known gap, stated plainly**: checks #8 and #15 need a real browser driving the actual admin
console UI (Network editor canvas interactions, responsive layout at mobile width) — this round's
testing was done directly against the live HTTP API (curl/node), which exercises every server-side
rule and persistence guarantee identically to what the UI calls, but does not prove the JavaScript
UI itself renders correctly. The admin console's own code was not changed in a way that would
plausibly break rendering (recent changes were backend/data-layer only), but this has not been
visually confirmed against the live deployment. **Recommend**: before inviting the stakeholder,
someone opens `https://comp8715demo-uat-backend.onrender.com/admin/login.html` in an actual
browser, signs in, and clicks through the Network editor and a few pages at both desktop and phone
width once, specifically to close this gap.

Browser console / backend logs / database errors: no backend errors occurred during this round's
testing beyond the two already-diagnosed-and-fixed incidents (the pre-migration 500 and the import
script's own logging bug, both covered in git history); no way to inspect "browser console" without
a real browser session, per the gap above.

## 8. Data publication status (none of the real imported data is public yet)

**Everything imported from the real Excel file is Draft.** Confirmed directly in the database:
56/56 actors, 16/16 projects, 92/92 relationships are all `status = draft`. `GET /api/dataset`
(the public, unauthenticated endpoint) returns empty arrays for all three collections. Nothing from
this import has been published to the UAT public view.

**Why, specifically — this is not a default, it's a deliberate hold per an open item already
flagged in `docs/EXCEL_IMPORT_REPORT.md`**: every imported project's `evidence_snippet` and every
relationship's `evidence` field embeds the data preparer's own internal "Supporting evidence" notes
(Excel column S — e.g. *"Date review: official project page confirms... Not disclosed means no
explicit project date was located..."*). These fields are rendered **verbatim on the public page**
(`app.js` prints `node.evidenceSnippet` and `relationship.evidence` directly). This content was
never reviewed for public-facing suitability, so publishing any of it now would expose unreviewed
internal methodology notes as if they were public-facing copy — exactly the risk the import report
flagged and asked for sign-off on, which has not yet been given.

**Explicitly pending your confirmation, listed (not guessed)**:
1. Whether the Supporting Evidence text in every relationship's `evidence` field and every
   project's `evidence_snippet` is acceptable to show publicly as-is, needs rewriting into
   public-facing copy first, or should be stripped from public rendering regardless of review
   (e.g. show it in Admin only, never on the public page).
2. The 56 free-text research-theme phrases (Excel column K) are not mapped onto any curated Theme
   node — kept as descriptive text only. No decision needed to keep the current Draft-everything
   state, but relevant if/when a future publish decision is made per-record.
3. Every organisation's `type` is a placeholder (`industry_partner`) pending manual classification
   — not a blocker for staying Draft, but worth knowing before a future publish pass.

**What this means for the acceptance test guide (§5)**: the stakeholder's 10–15 minute test task
list still works fully — she can view, create, bulk-import, publish/withdraw her OWN test records
(exactly like the `[UAT-TEST]` records exercised in §7), exercise the Network editor, and submit
feedback. She will not see any of the real 56/16/92 organisations/projects/relationships appear on
the public directory tab, because none of them are published — this is expected, not a bug, and
should be explained to her up front (see the updated §6.4 note below).

---

## 9. Secure handover procedure (do this before telling her anything)

1. In the admin console (sign in as `admin` or the current `stakeholder1` session), go to
   **Accounts** → `stakeholder1`'s row → **Set password**, and generate a fresh one-time password.
   (The password used during this round's acceptance testing — §7 — has already been consumed and
   will not work; this is required, not optional.)
2. Send the following over **two separate channels** (never the password in the same message as
   the URL/username):
   - **Channel A** (e.g. email, Slack, Teams message — whatever she'd normally expect contact
     from you on): the URL and username, plus the short invite text below.
   - **Channel B** (a different channel — a password manager share, a phone call, a separate
     encrypted message): just the one-time password, nothing else.
3. She logs in once with that one-time password, and the system forces her to set her own password
   before anything else is usable (§3.2) — after that point, only she knows it.

### Forwardable invite text (Channel A — contains no password)

> Hi — the UAT (User Acceptance Testing) environment for the Australian R&D Directory project is
> ready for you to try. You'll see an orange "USER ACCEPTANCE TESTING" banner on every page,
> confirming this is an isolated test copy — nothing you do here affects any real public site.
>
> URL: https://comp8715demo-uat-backend.onrender.com/admin/login.html
> Username: stakeholder1
>
> Your one-time password is coming separately, through [state the other channel you're using, e.g.
> "a text message" / "our password manager"]. The first time you log in, you'll be asked to choose
> your own password — do that straight away.
>
> A short list of things to try (roughly 10–15 minutes) is attached/linked: [attach or link
> docs/UAT.md §5, or copy its contents into your own message].
>
> If anything looks wrong, confusing, or breaks, click "Report an issue" at the top of any admin
> page — that's exactly what this round is for.

### What to tell her about the data (per §8)

The real organisation/project/relationship data imported from the source Excel file is deliberately
**not yet visible on the public directory tab** — it's all still in Draft, pending a decision on
whether some descriptive text needs review before going public. She can see and work with it in the
admin console (tables, Network editor), and her own test records will publish/withdraw normally.

---

## 10. Backup, restore, and log-viewing for whoever operates this after handover

- **Taking a backup**: `DATABASE_URL="<neon connection string>" node backend/db/snapshot.js
  ./uat-backups` — writes a timestamped JSON file with every data table except `accounts`/
  `sessions` (credentials are never included in a snapshot).
- **Restoring**: **always rehearse on an isolated copy first**, never directly against the live UAT
  database you're trying to protect — see §7's "backup can be restored" result for exactly how this
  round's rehearsal was done (migrate a fresh disposable local database, restore the real UAT
  snapshot into it, confirm the row counts, then discard the disposable copy). Only after a
  rehearsal succeeds should `node backend/db/restore.js <snapshot-file> --confirm` be run against
  the real `DATABASE_URL` — and even then, `restore.js` automatically takes a fresh safety backup
  of the live database's current state before touching anything, and never restores the `feedback`
  table unless `--include-feedback` is explicitly passed.
- **Viewing logs**: Render dashboard → this service → **Logs** tab. Since this round's fix, an
  unexpected server error is logged there with its full route and stack trace (previously, some
  failures were silently swallowed — see the "Known issues" section of the final delivery report
  for the specific incident this fixed).
- **Common troubleshooting**: see §6 above (data recovery, login issues, duplicate feedback
  concerns).

---

## 11. After testing ends: feedback triage and access revocation

1. **Review feedback**: admin console → Feedback page. Filter by status, open each item, read the
   detail (including any screenshot), and change its status as you work through it (New →
   Investigating → Fixed → Ready for retest → Closed). Every status change is recorded with who
   made it and when (visible in that feedback item's history).
2. **Export a copy** if you want one outside the system: Feedback page → Export CSV.
3. **Revoke her access**: admin console → Accounts → her row → **Disable**. This immediately signs
   her out everywhere and blocks further login, without deleting anything she created.
4. **Decide what to do with the UAT data**: it can be left as-is for reference, snapshotted
   (`db:snapshot`) and kept, or the UAT database can eventually be dropped once no longer needed —
   none of this affects production, since they are separate databases.
5. If you plan a second round of testing later, you do not need to recreate her account from
   scratch — just **Enable** it again (optionally with a new password via **Set password**).
