# UAT handover — final package

This is the single document to use when inviting the stakeholder. It intentionally contains **no
password** anywhere in it — the one-time credential must reach her through a separate channel from
this document (see "Secure account pickup" below). For the full technical detail behind every claim
here, see `docs/UAT.md` (environment setup, role matrix, troubleshooting) and
`docs/DATA_PUBLICATION_REVIEW.md` (exact per-record publication status).

---

## 1. Login URL

**https://comp8715demo-uat-backend.onrender.com/admin/login.html**

This is the complete, clickable address. The backend serves both the API and the login page at
this same address — there is no separate frontend URL to also share.

## 2. Secure account pickup (do this before sharing anything else)

Her username is **`stakeholder1`** — a placeholder, used because no real name or email was
available when the account was created. It can be renamed or replaced with her real details at any
time (see `docs/UAT.md` §3.1); nothing below changes if that happens later, only the username does.

A fresh one-time password has already been generated for her and is **not included anywhere in
this document, in any commit, or in any log**. It is in your hands now, delivered to you separately
from this report. To hand it to her:

1. Send her the login URL and username above through your normal contact channel (email, Slack,
   whatever you'd use to reach her).
2. Send her the one-time password through a **different** channel — a password manager share, a
   phone call, a separate text message. Never the same message as the URL/username.
3. The system will force her to set her own password the moment she logs in with it — she cannot
   proceed past that screen until she does (verified in a real browser this round: the dialog has
   no close or cancel button). After that point, only she knows her password.

If this specific one-time password is ever lost, consumed, or needs replacing, any admin account
can re-issue a fresh one from the admin console (**Accounts** → her row → **Set password**, with
"one-time password" checked) — no need to ask for engineering help to do this.

## 3. What's open to her right now

Logged in as `stakeholder1`, she has the same capability as this environment's own administrator
(this is by design — see `docs/UAT.md` §1 for why there's no separate, cut-down role):

- View every record (draft and published) across Organisations, Projects, Research themes,
  Relationships, and Sources.
- Create, edit, bulk-import (typed rows, pasted spreadsheet rows, or an uploaded .xlsx/.csv file),
  publish, withdraw, and delete any record — drafts stay private until explicitly published.
- Use the Network editor to add/edit nodes and relationships visually on the same underlying data
  as the tables.
- Create, rename, and (once unused) delete custom relationship types.
- Submit feedback (bug reports or suggestions), optionally with a screenshot attachment.
- View and triage **all** feedback submitted in this environment, change its status, export it.
- Create, disable, and reset passwords for other accounts in this same environment.

Every one of these was exercised directly against the live environment this round, in a real
browser, as `stakeholder1` herself — not assumed from the code.

## 4. Data publication status

**None of the real imported data (56 organisations, 16 projects, 92 relationships) is visible on
the public directory yet — all of it is Draft.** This is intentional, not a bug, and here's exactly
why (full detail in `docs/DATA_PUBLICATION_REVIEW.md`):

- The 56 organisations and 92 relationships have **no public-safety concern at all** — verified by
  reading every one of them. They could be published with no text changes needed.
- All 16 projects carry a mix of genuinely public-facing text (a description, dates, funding
  details) **and** the data preparer's own internal review notes, glued into the same field. That
  internal text was never written for a public reader, so none of the 16 have been published until
  someone decides how to handle it (publish as-is, rewrite the public-facing parts first, or leave
  as Draft).

Tell her up front: she'll see all the real data in the admin console tables and Network editor, but
nothing will show up on the public-facing directory page unless she publishes her **own** test
records — that's expected, and a useful thing for her to notice and confirm during testing.

## 5. 10–15 minute test task list

1. **Look around** — open the public directory (link in the top bar) and the Network editor; notice
   the real 56/16/92 records are visible to her in the admin tables but not yet on the public page.
2. **Add one organisation** by hand, save it as a draft.
3. **Publish it**, confirm it now appears on the public directory tab (may need a refresh).
4. **Withdraw it** again — confirm it disappears from public but still exists in the admin table.
5. **Bulk import** two or three rows directly into the table (or paste a block copied from a
   spreadsheet), preview, confirm. Check the new records land as drafts.
6. **Create a custom relationship type** — type a new name that isn't in the suggested list on a
   relationship, confirm it saves and displays correctly.
7. **Batch action**: select a few records with the checkboxes, try a batch publish or a batch
   field-edit, and read the confirmation dialog before confirming.
8. **Submit feedback**: click "Report an issue" anywhere in the admin console, describe anything she
   noticed, optionally attach a screenshot, submit. Note the feedback number returned.
9. **Check her feedback**: open the Feedback page, confirm her submission is there with the right
   details.
10. *(Optional, time permitting)* Try the same flow once on her phone's browser.

No expectation of finding zero problems — the point of this round is to surface anything that
doesn't work, through the feedback form itself.

## 6. Feedback entry point

The **"Report an issue"** button appears at the top of every admin page, always available while
logged in. She can view all feedback submitted (hers and anyone else's in this environment) under
the **Feedback** menu item in the sidebar, including its current status.

## 7. Known limitations

- **The real imported dataset is intentionally all Draft** — see §4 above; not a bug.
- Every organisation's `type` field is a placeholder pending manual classification — not something
  she needs to fix, just something that may look incomplete.
- The backend is on a free hosting tier that spins down after about 15 minutes of no traffic — the
  very first request after a quiet period can take roughly a minute to respond while it wakes back
  up. This is expected, not a fault.
- No promise this is bug-free — that's exactly what this round of testing is for.

## 8. Recovery / what to do if something looks wrong

- **"I think I broke something"**: nothing is unrecoverable. An operator can take a snapshot of the
  current (possibly broken) state and restore an earlier one — see `docs/UAT.md` §10 for the exact
  commands, and note that a restore is always rehearsed on an isolated copy first, never run
  directly against the live environment she's using.
- **"The page won't load" / "I got logged out"**: check `GET /api/health` first (reachable without
  logging in) — if it reports the database unreachable, that's a hosting issue, not her account.
  Sessions last 8 hours; logging in again after that is expected. If her account was disabled by an
  operator, she'll see a plain login failure — check the Accounts page to confirm.
- **"I submitted feedback but it looks duplicated"**: resubmitting the exact same report (e.g. a
  double-click) is handled automatically server-side — it won't create a second entry.
- **Full troubleshooting reference**: `docs/UAT.md` §6.

---

*This document deliberately omits anything that would let it function as a credential — no
password, no database connection string, no server access details. It is safe to forward to the
stakeholder as-is, or to use as the basis for your own message to her.*
