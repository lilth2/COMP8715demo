# Delivery report

Repository: `https://github.com/lilth2/COMP8715demo` (remote unchanged throughout this work).
Branch: `master`. All work is committed; **not yet pushed to origin** — 20 commits ahead of
`origin/master` as of this report (confirm before pushing, since that makes this history visible
to anyone with repo access).

Source Excel: `D:\study\COMP8715\Organisation_Relationship_Data_Template (AB).xlsx` — verified to
be a real file (not a directory), valid `.xlsx`, read-only throughout, never committed to the repo.

---

## 1. What is done vs. not done (read this section first)

| Claim | Status |
| --- | --- |
| **Code complete** | Yes, for every item in this report's §2–§9, including real-browser UI verification, not just unit tests. |
| **Locally verified** | Yes — against a real, disposable PostgreSQL instance (`embedded-postgres`, no Docker/root needed) and a real headless-Chromium browser, repeatedly. |
| **Real Excel data imported** | Yes, but only into an **isolated local test database** created for this work, not any shared/long-lived UAT database (none has been provisioned yet — see below). |
| **UAT database provisioned and running** | **No.** No persistent UAT database exists yet. Standing one up requires a hosting decision (§9) that has not been made. |
| **Stakeholder account created** | **No.** The tooling to create it (`npm run setup:accounts`) is built, tested, and documented (`docs/UAT.md` §3), but has not been run against a real, persistent UAT database because none exists yet. |
| **Deployment-ready** | Partially — migrations, env templates, CI, and docs are ready (§9). The backend itself has never been deployed to any live, reachable host. |
| **Live access opened** | **No**, and nothing in this round opens it, sends an invite, or sets an access date, per your explicit instruction. |

---

## 2. Continuity from the prior checkpoint (verified fresh, not assumed)

At the start of this round I re-verified rather than trusted the prior summary:

- Git state: clean working tree, branch `master`, 5 commits ahead of `origin/master` at that point.
- Excel path: re-confirmed as a real `.xlsx` file.
- Ran `npm test` fresh: 82/82 passing at that point (matches the prior report; not just cited).
- Confirmed the existing `backend/import/xlsx-parser.js` correctly parses the real file end-to-end
  (all 20 data rows, 0 formulas) — per your explicit instruction to verify this before using it,
  and only switch to a third-party library if it couldn't. It could, so no new XLSX dependency
  was added.

No already-working module was reimplemented from scratch; everything below extends what existed.

---

## 3. Real Excel import — field mapping, quality report, isolated-DB import

- Full field-by-field mapping: `backend/import/real-data/README.md`.
- Data-quality report (structural facts, deduplication performed, what was deliberately left as
  text or not imported, safety checks, idempotency verification, the two bugs found and fixed
  while doing this for real): `docs/EXCEL_IMPORT_REPORT.md`.
- Import script: `backend/import/real-data/import-real-dataset.js` — dry-run by default,
  `--commit` to write, refuses to run without `DATABASE_URL`, detects and refuses re-importing the
  identical file (fingerprinted), and the whole multi-phase import (organisations → projects →
  relationships) commits as one atomic transaction (verified: a deliberately-broken batch leaves
  zero partial rows).
- **Result, run against an isolated local test database** (not a shared/persistent UAT database,
  since none exists yet): 20 source rows → 56 organisations (one real case-only duplicate name
  resolved, documented), 16 projects (4 of them correctly assembled from a 2-row split in the
  source template), 92 relationships (3 literal-duplicate edges across split-project halves
  correctly collapsed to one, with full row-number provenance kept in the evidence text). Row
  counts reconciled exactly; idempotent re-run verified (no duplicates on a second attempt);
  restart persistence verified (fresh process, same data). **All imported records are Drafts** —
  none were published.
- Explicitly **not** fabricated: relationship confidence/intensity (source said "Not publicly
  disclosed" for every row — kept as literal text, not mapped to a level), dates (mixed
  serial/free-text formats kept as literal text rather than guess-parsed), organisation type
  (source gives no classification — every imported organisation is tagged with an explicit
  placeholder pending manual review), map coordinates (none exist in the source; the app already
  renders "location unavailable" rather than inventing one), and the 56 free-text research-theme
  phrases (left as descriptive text, **not** auto-mapped onto the existing curated theme
  taxonomy — flagged as an open item needing your decision in the quality report).

---

## 4. Admin bulk input (brief's top code priority)

- Multi-row type-or-paste table with a genuine Excel paste-matrix (pasting a rectangular block
  into any cell fills across and down, growing the table), plus `.xlsx`/UTF-8 `.csv` upload with
  sheet selection, header-row detection, and column-to-field mapping.
- Shared pipeline for both paths: pre-validate → diff preview (new/update/skip/error counts, every
  row's original row number) → confirm → transactional commit (all-or-nothing) → result report.
- Add-only vs. update-by-ID modes; no silent name-based merging.
- Imports default every record to Draft; nothing is auto-published.
- Duplicate-upload detection by file fingerprint (hash of file bytes + sheet + mode); resubmitting
  the identical file is refused with a clear message, not silently re-imported.
- Verified end-to-end in a real headless-Chromium browser: typed rows, a real paste-matrix
  operation, and a real generated `.xlsx` file upload each produced correct drafts, zero console
  errors.

## 5. Custom (freeform) relationship types

- A real managed collection (stable ID + independently editable display name + colour), not a
  hardcoded enum. Free-text combobox with suggestions in the single-record form, the Network
  editor's filter, and bulk import — all three paths validated against the same shared module
  (`admin/dataset-core.js`), so there is no separate frontend-only vs. backend-only validation to
  drift apart.
- Create, rename, and merge-then-delete (deleting a type still referenced by a relationship is
  blocked until you choose another type to merge its relationships into).
- The two types the app depends on structurally (`hosted_by`, `shares_research_theme`) cannot be
  renamed or deleted.
- Every display site escapes the type name (verified: a type literally named with an HTML/script
  payload is stored as inert text and never executes).

## 6. Bulk admin actions (multi-select, batch publish/withdraw/delete/field-edit)

- Checkbox selection in every table (Organisations/Projects/Themes/Relationships), a batch toolbar
  that appears once something is selected, an aggregated impact-preview confirmation (how many
  selected records are published, which relationships/hosted-projects/theme-tags would be
  affected) before any destructive action.
- All-or-nothing: a relationship blocked from publishing, a record already a draft on withdraw, or
  a missing ID rejects the **entire** batch before anything changes.
- Batch field-edit restricted to an explicit per-collection allowlist — never `id`, `status`, or
  `publishedSnapshot`.
- No unprotected "wipe everything" action exists anywhere.
- Verified end-to-end in a real browser: created 3 records via bulk import, selected them via the
  table's search filter, batch-published, batch-edited a field, then batch-deleted with the
  correct published-record warning shown — table was empty afterward, zero console errors.

## 7. Database and real data integration

- PostgreSQL schema (`backend/db/schema.sql`): real foreign keys, uniqueness/check constraints,
  per-record `version` column for optimistic concurrency (a concurrent edit against a stale
  version is rejected with an HTTP 409 and a clear message — verified with two concurrent writers
  against a real database, confirming no silent overwrite). Covers organisations, addresses,
  projects, themes, relationship types, relationships, sources, accounts, sessions, import
  batches/rows, audit log, feedback, and layout positions.
- Migration (`backend/db/migrate.js`) is idempotent (`CREATE TABLE IF NOT EXISTS` throughout; safe
  to re-run). `backend/db/migrate-from-json.js` migrates an existing single-JSON-file deployment
  into Postgres, backing up the original file first and refusing to run against a non-empty target
  database.
- The existing, already-tested business-rules engine (`admin/dataset-core.js`) — draft/publish/
  withdraw/delete, dependency-aware publish, delete-reference-scrubbing — is **unchanged**; the
  Postgres layer (`backend/db/pg-store.js`) only replaces where that engine's state is read from
  and written to. Two real bugs were found and fixed while wiring this up for the real import (a
  foreign-key write-ordering bug and a non-atomic multi-phase-write bug) — both now covered by
  permanent tests.
- Snapshot/restore (`backend/db/snapshot.js` / `restore.js`): restore always takes a fresh safety
  backup of the current state first, and — unless explicitly told otherwise — never touches
  submitted feedback. Verified: a deleted record was recovered and a feedback row submitted after
  the snapshot survived the restore untouched.

## 8. Stakeholder UAT super-admin role, isolated environment, feedback tracker

- Real multi-account auth (Postgres-backed), two roles (`admin`, `stakeholder`), both with
  equivalent full capability per the brief — every endpoint checks a valid session server-side,
  not a hidden button. Environment isolation (`production` vs `uat`) is structural: a server
  process only ever queries its own environment's accounts, so a UAT account has no row to
  authenticate against on a production-environment process (verified directly with a real
  cross-environment test, not just asserted).
- Disabling an account or resetting its password immediately revokes that account's existing
  sessions (verified: an already-issued token stops working right away).
- Account bootstrap (`npm run setup:accounts`) never hardcodes a password — generates one and
  prints it once, or reads one from an env var set just for that invocation.
- A persistent "USER ACCEPTANCE TESTING" banner renders on every page (public and admin) whenever
  `APP_ENVIRONMENT=uat` — verified visually in a real browser.
- Feedback tracker: submission (bug/suggestion, repro steps, expected/actual, related
  page/record, optional screenshot), idempotent against double-submission, preserves form content
  on failure, returns a feedback number. Screenshots are stored outside any public/static
  directory and served only to an authorised, authenticated viewer (verified: not reachable
  anonymously, not reachable as a guessed static path). Full status-change history (not just the
  current status), CSV export, and role-scoped visibility (full-visibility roles see everything in
  the environment; the mechanism for a narrower "own feedback only" role is implemented and tested,
  though no such role exists yet since the brief's two roles are both full-visibility).
- Account/role work verified end-to-end in a real browser logged in **as the stakeholder account
  itself** — not just via API calls — including the Accounts page, bulk import, and a full
  feedback submission/triage cycle.

## 9. Deployment readiness

Verified the actual remote and that no hosting platform is configured anywhere in the repo — none
assumed, none guessed.

**Done**: idempotent DB migrations; `backend/.env.example` (updated for both storage modes) and a
separate `backend/.env.uat.example`; a GitHub Actions CI workflow running the full test suite on
every push/PR (`.github/workflows/test.yml`) — and a real, previously-undetected CI-reliability bug
was found and fixed while adding it (the test suite flaked intermittently under parallel execution
due to multiple disposable-Postgres instances contending for resources; fixed with
`--test-concurrency=1`, verified stable across repeated full runs); an unauthenticated `/api/health`
endpoint reporting process/storage/database status, including a correct HTTP 503 when the database
is unreachable; `docs/DEPLOYMENT.md` §7 documents the whole Postgres/multi-account deployment path,
backup/rollback procedure, and why UAT/production isolation is a property of using two different
databases, not a flag; production config already disables `demoAccount`/sample-data fallback via
the existing `site-config.js` mechanism (documented, not changed, since the live GitHub Pages site
currently has no real backend to switch to — flipping it now would break the only thing currently
live).

**Explicitly NOT done this round, and why**: no hosting platform was chosen or provisioned (none
specified by you); the backend has never been deployed to any reachable URL; no production or UAT
`DATABASE_URL` exists outside this session's disposable local test instances; `site-config.js`'s
`demoAccount.enabled`/`apiBaseUrl` were deliberately left untouched (flipping them without a real
backend running would break the current live demo). **Minimum you need to provide or decide**
before UAT can actually open: (1) where the backend will run (a specific host/platform), (2) a
real PostgreSQL instance for UAT with its connection string, (3) confirmation of which
origin(s)/domain the UAT frontend will be served from (for `ALLOWED_ORIGINS`/`PUBLIC_ORIGIN`), and
(4) the actual date you want to open testing (none assumed or set).

---

## 10. Test results (re-run fresh for this report, not cited from memory)

```
$ npm test
...
ℹ tests 121
ℹ pass 121
ℹ fail 0
```

121/121 passing, confirmed stable across 3+ consecutive full runs after fixing the concurrency
flake (§9). Breakdown: 46 tests existed before this round (relationship-type UI tests, etc., were
actually added across this round too — see the commit log for the precise incremental count per
commit). New this round: real-xlsx-parser tests (synthetic fixture, not the real file, since the
real file isn't committed), CSV parser tests, bulk-import core + API tests, Postgres persistence +
optimistic-concurrency tests, multi-account auth tests (including real cross-environment
isolation), snapshot/restore tests, feedback-tracker tests (including screenshot access control),
bulk-action tests, an end-to-end regression/consistency suite through the real HTTP API, and
health-check/audit tests.

Beyond automated tests, verified in a **real headless-Chromium browser** (not simulated): bulk
import (typed rows, paste-matrix, real `.xlsx` upload) as an admin; the full stakeholder login →
Accounts page → bulk import → feedback submission/triage cycle as the stakeholder account itself;
batch select/publish/field-edit/delete; and desktop + mobile (390px) viewport rendering of both the
public site and the admin console — which caught and led to fixing a real mobile horizontal-overflow
bug in the public page's header.

Six real, previously-undetected bugs were found and fixed while building and testing this (not
hypothetical): (1) a Postgres foreign-key write-ordering bug, (2) a non-atomic multi-phase-import
bug, (3) a server error-response bug that silently dropped structured error data like publish
blockers, (4) two separate HTML `pattern`-attribute regex bugs that crashed on page load in
Chromium, (5) a feedback-history display bug (raw account UUID shown instead of username), and
(6) the CI test-concurrency flake. All six are covered by permanent regression tests.

---

## 11. Changed/added files (by area; see `git log` for full commit-level detail)

- Core engine: `admin/dataset-core.js` (relationship types, bulk import planning, bulk actions)
- Admin UI: `admin/bulk-import.js`, `admin/bulk-actions.js`, `admin/accounts.js`,
  `admin/feedback.js`, plus edits to `admin/console.js`, `admin/store.js`, `admin/index.html`
- Backend: `backend/server.js` (multi-account routes, bulk-import routes, feedback routes, health
  check), `backend/accounts-pg.js`, `backend/sessions-pg.js`, `backend/feedback-pg.js`,
  `backend/accounts-bootstrap.js`
- Database: `backend/db/schema.sql`, `pg-store.js`, `migrate.js`, `migrate-from-json.js`,
  `snapshot.js`, `restore.js`
- Import: `backend/import/xlsx-parser.js`, `csv-parser.js`, `plan-from-file.js`,
  `backend/import/real-data/` (the real-data importer and its mapping doc)
- Tests: 15 new test files under `backend/tests/` (see §10)
- Docs: `docs/UAT.md` (new), `docs/EXCEL_IMPORT_REPORT.md` (new), `docs/DELIVERY_REPORT.md` (this
  file), `docs/DEPLOYMENT.md` (extended), `README.md` (extended)
- CI/config: `.github/workflows/test.yml`, `backend/.env.example` (updated),
  `backend/.env.uat.example` (new), `.gitignore` (updated), `package.json`

Full commit list (19 commits this round, oldest first):

```
18b7876 Turn relationship type into a freeform, managed collection
2a791b8 Add PostgreSQL persistence as an opt-in alternative to the JSON file store
155a476 Add bulk import backend: planning core, .xlsx/.csv parsing, HTTP endpoints
6b5c8a0 Add Bulk import admin page (multi-row form, paste-matrix, file upload)
05ed489 Import the real organisation-relationship Excel dataset; fix two Postgres bugs found doing it
6378c38 Add multi-account auth (admin/stakeholder roles) for Postgres deployments
c20c337 Audit account-management actions (create/disable/enable/password change)
5290192 Add admin Accounts page UI; fix two real pattern-attribute regex bugs
5b30c64 Add UAT database snapshot/restore scripts
8bbff5f Add feedback tracker backend: submission, status workflow, attachments, export
bcc4858 Add admin Feedback UI; fix a real username-vs-UUID display bug
5b23fa4 Add batch admin actions to the shared core: publish/withdraw/delete/setField
d6954c4 Add batch admin actions UI: multi-select, batch toolbar, field edit
d246ac3 Add end-to-end regression/consistency test suite
f90210c Add /api/health endpoint and permission-denial audit logging
b3b52f6 Deployment prep: CI workflow, updated .env examples, UAT/prod separation
dd99df1 Fix flaky test suite: force sequential test files (embedded-postgres contention)
c29aaa8 Fix horizontal overflow on the public page at mobile widths
2803695 Add docs/UAT.md; update README for the Postgres/multi-account feature set
```

**Not pushed to `origin/master` yet** — 20 commits ahead as of this report (includes one from
before this round). No PR exists; none was requested. Push (or open a PR) on your confirmation.

---

## 12. What I need from you to go further

1. **Confirm whether to push** these 20 commits to `origin/master` (or open a PR instead).
2. **A hosting decision** for the backend (platform/host) — nothing was assumed.
3. **A real UAT PostgreSQL instance** (connection string) so the stakeholder account and the real
   imported data can actually live somewhere persistent, rather than this session's disposable
   local test databases.
4. **Confirmation of the UAT frontend's origin/domain** for `ALLOWED_ORIGINS`/`PUBLIC_ORIGIN`.
5. **Your decision on the two open Excel data items** flagged in `docs/EXCEL_IMPORT_REPORT.md`:
   whether to curate the 56 free-text research-theme phrases onto the existing theme taxonomy, and
   whether the "Supporting Evidence" column's internal methodology notes should ever be shown
   verbatim on the public site.
6. **An actual open-testing date**, if/when you have one — none has been set or assumed anywhere
   in this delivery.
