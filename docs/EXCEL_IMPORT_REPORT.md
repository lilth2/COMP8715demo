# Real Excel data — quality report & import reconciliation

Source: `Organisation_Relationship_Data_Template (AB).xlsx` (not committed to this repo — see
`.gitignore`). Verified as a real file (not a directory), valid `.xlsx`, no macros, no formulas, no
external links. Read with the existing zero-dependency parser (`backend/import/xlsx-parser.js`),
chosen over adding a third-party XLSX library because it already parses this exact file correctly
end to end (verified below) — per the brief's own instruction, correctness was checked first, and
a new dependency was not needed.

Full field mapping and the project-grouping rationale live in
`backend/import/real-data/README.md`. This document is the data-quality side: what was found in
the source data, what was imported as-is, what was normalised, and what is left open for human
review rather than guessed.

## Structural facts (verified by parsing, not estimated)

- Sheet "Relationship data": header row 5, data rows 6–25 — **20 data rows**, matching the
  expected range exactly.
- Second sheet "Guide and examples": reference material only (15 suggested relationship-type
  strings, 5 example questions) — not imported as data.
- **0 formula cells**, **0 macros**, **2 merged cell ranges** (both in the title/instructions
  rows 1–3, not in the data region) — confirmed by direct ZIP/XML inspection before any import
  code ran.
- Header row has a **pre-existing error in the source template**: column F is labelled
  "Organisation D" (a duplicate of column D's label) and column G is labelled "Organisation F".
  The importer reads organisation columns by position (A–G), never by header text, so this error
  does not propagate into the imported data — flagged here only because it would mislead a human
  reading the raw file.

## Import reconciliation (source file vs. imported database)

| Metric | Source | Imported | Match |
| --- | --- | --- | --- |
| Data rows read | 20 | 20 | ✅ |
| Distinct organisation names (raw strings, columns A–G) | 57 | — | — |
| Organisations imported (after case-insensitive dedup) | — | 56 | ✅ (57 − 1 duplicate = 56) |
| Distinct project names (column J) | 16 | 16 | ✅ |
| Organisation→project relationship edges | 95 raw (org, project, type) triples across 20 rows | 92 | ✅ (3 were the literal same org+project+type stated twice across a split project's two halves — see "Deduplication" below, not dropped data) |

Verified live against an isolated test PostgreSQL database (not production, not the shared
UAT/dev database): `npm`-run import script reported **56 actors / 16 projects / 92 relationships
created, 0 errors**, confirmed independently by direct SQL queries after commit, after a simulated
process restart, and after a repeat run of the identical file (idempotency check — see below).

## Deduplication performed (not fabrication — stated explicitly, not silent)

1. **Organisation name, case-only duplicate**: "Centre for New Energy Technologies (C4Net)" (row 6,
   column C) and "Centre for New Energy Technologies (C4NET)" (row 20, column B) are the same
   organisation with inconsistent capitalisation in the source. Imported as one actor record,
   canonical display name taken from the first occurrence ("C4Net" casing). No other near-duplicate
   organisation names were found among the 57 distinct strings.
2. **Repeated org+project+type triples within a split project**: four projects are represented
   across two consecutive rows because the template caps at 7 organisation columns (see
   `backend/import/real-data/README.md` "Project grouping" for the full list and the one case —
   Otway International Test Centre — where the two halves actually carry *different* relationship
   types and were kept as separate edges). In three of the four splits, the lead CRC/organisation
   is named in column A of **both** halves with the **same** relationship type — the same fact
   stated twice, not new information. One edge per distinct (organisation, project, type) is
   created; the evidence text for that edge lists every contributing source row number, so the
   duplication is traceable, not hidden.

## Fields deliberately NOT imported as structured data (left as text, or left out)

These were not guessed into a structured field because doing so would misrepresent what the
source actually says:

- **Column K (Research theme / area)**: 56 distinct free-text phrases, heavily overlapping, no
  controlled vocabulary. **Not** auto-created as Theme nodes or fuzzy-matched onto the app's
  existing curated theme taxonomy — kept as descriptive text in the project's summary. **Open item
  for your decision**: whether a human curator should map these phrases onto real Theme nodes in a
  follow-up pass.
- **Columns P (Collaboration frequency) and Q (Collaboration strength/intensity)**: both are 100%
  literal "Not publicly disclosed" across all 20 rows. **Not** mapped to the app's `intensity`
  (weak/medium/strong) or `confidence` enum fields, since doing so would fabricate a specific level
  where the source explicitly states none is known. Kept as literal text in the relationship
  evidence.
- **Column O (Number of joint projects)**: 0/20 rows populated — nothing to import.
- **Columns L, M, U (dates)**: mix Excel date serials, free text ("Not disclosed", "2023 (year
  only)"), and one raw ISO datetime. Rather than guess a parsing rule that could silently produce
  a wrong calendar date for one of these mixed formats, all three are kept as literal text in the
  relationship evidence rather than populating a structured date column. **Open item**: a follow-up
  pass can parse the serial-number cases into real dates once someone has reviewed the
  free-text/ambiguous ones.
- **Column S (Supporting evidence)**: contains the data preparer's own internal methodology/review
  notes (e.g. "Date review: ...", "This is not a confirmed actual collaboration end..."), not
  public-facing copy. Imported into the relationship's `evidence` field (visible in Admin), but
  **not** marked for direct public-site display without review — **open item for your sign-off**
  before anything from this column reaches the public pages.

## Missing / incomplete data (reported, not filled in)

- 3 of 20 rows have no relationship description (column I) — left blank, not fabricated.
- No organisation in the source data has a postal address, state, or coordinates — all imported
  organisation records have no office/location data. The app already renders "location
  unavailable" rather than a fabricated map position for a record with no office data, so this
  requires no special handling, just confirmation that it is expected.
- No organisation in the source data is classified by type (university/CRC/government/industry
  etc. — the source only gives names). Every imported organisation is tagged with a **placeholder**
  type (`industry_partner`) and a summary explicitly stating the type is unclassified, pending
  manual review — never guessed from the organisation's name.

## Safety checks performed

- Original source `.xlsx` file was never modified, renamed, or re-saved — read-only `fs.readFileSync`
  only, verified by file mtime being unchanged after every run.
- Not uploaded to any third-party service, and not committed to this Git repository (the source
  path is outside the repo entirely, and `.gitignore` additionally excludes common Excel
  extensions as a backstop — see the deployment docs).
- No macro, formula, or external link execution — confirmed no `<f>` formula elements were even
  present in the parsed cells (0 across all 34 physical rows of the sheet).
- Imported into an **isolated test/UAT PostgreSQL database**, never the shared production
  single-JSON-file store and never a database already holding other records (the import script
  refuses to run a fresh import against a database that was not empty for the collections it is
  about to touch — see `backend/import/real-data/import-real-dataset.js`, and more generally
  `backend/db/migrate-from-json.js` for the equivalent production-migration safety check).
- Every imported record is a **Draft**. Nothing from this import is public until a human reviews
  and explicitly publishes it from the admin console.

## Idempotency verification

Re-running the exact same file against the same database a second time was detected by file
fingerprint (SHA-256 of the file bytes + sheet name + mode) and refused with no new records
created — row counts confirmed unchanged (56/16/92) before and after the repeat attempt. See
`backend/tests/pg-store.test.js` for the equivalent automated duplicate-detection test via the
admin bulk-import API, and the manual verification log in this report's companion commit.

## A bug found and fixed during this import (for transparency)

The first real-data import attempt failed partway through with a PostgreSQL foreign-key violation,
because the Postgres write path (`backend/db/pg-store.js`) was writing new relationship rows
before the new relationship *types* those rows reference (freeform types created by the same bulk
import). This has been fixed (relationship types are now written before relationships, and only
deleted after), and a second, separate bug — that the import script's three phases (organisations,
projects, relationships) were committed as three separate transactions instead of one — was also
found and fixed: a new `applyBatch` method on the Postgres store now applies multiple operations
against one in-memory state and writes the combined result in a single transaction, so a failure
partway through leaves **zero** partially-imported records, not a half-imported dataset. Both
fixes are covered by new automated tests (`backend/tests/pg-store.test.js`).
