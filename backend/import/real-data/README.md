# Real Excel data import — field mapping & process notes

Source file (not committed to this repo): `Organisation_Relationship_Data_Template (AB).xlsx`,
sheet "Relationship data", header row 5, data rows 6–25 (20 rows). Verified read-only with the
existing zero-dependency parser at `backend/import/xlsx-parser.js` — all 20 rows parse correctly,
zero formulas, zero merged-cell data loss. See `docs/EXCEL_IMPORT_REPORT.md` for the full
data-quality report.

## Header bug in the source file

Columns F and G are labelled "Organisation D" and "Organisation F" in the sheet (duplicate /
wrong labels — a copy-paste error in the template upstream). The importer reads organisation
columns by **position** (A–G = organisation slots 1–7), never by header text, so this does not
affect the import.

## Field mapping

| Excel column | Content | Target |
| --- | --- | --- |
| A–G | Up to 7 organisation names per row | `actors[]` (deduplicated by case-insensitive name across the whole sheet) |
| H | Relationship type (free text: "Partnership", "Same research project", "Funding relationship") | `relationshipTypes` — created as freeform types if not already present, never mapped to a fixed enum value |
| I | Relationship/row description | `relationships[].evidence` (prefixed to the Source Evidence text — see below) |
| J | Project or program name | `projects[].name` — the join key for grouping rows into one project (see below) |
| K | Research theme / area (free-text, semicolon-separated, 56 distinct phrases, no controlled vocabulary) | **NOT mapped to Theme nodes** — kept as free text in the project's `summary`. See "Open item 1" below. |
| L | Collaboration start date | `projects[].lastUpdated` is NOT this; stored as free text in evidence (mixes serial dates, "Not disclosed", "2023 (year only)" — seeunresolved parsing section) |
| M | Collaboration end date | same treatment as L |
| N | Ongoing? (Yes/No/Unknown) | stored as free text in evidence |
| O | Number of joint projects | 0/20 populated — not imported (nothing to import) |
| P | Collaboration frequency | 100% literal "Not publicly disclosed" — **not mapped to `intensity`** (would misrepresent "undisclosed" as "weak"); kept as free text in evidence |
| Q | Collaboration strength/intensity | same as P — **not mapped to `confidence`/`intensity`**, kept as free text |
| R | Funding or grant | stored as free text in evidence |
| S | Supporting evidence (the data preparer's own methodology/review notes) | `relationships[].evidence` (primary content) and `sources` notes — **not surfaced verbatim on the public site**, see "Open item 2" |
| T | Source URL(s), sometimes multiple separated by newlines | `sources[]` entries, one per relationship, each URL preserved exactly |
| U | Last updated date (Excel serial or ISO datetime) | not mapped to a structured date field (mixed formats); recorded in evidence text |

## Project grouping (Project-node + org-edges model, per your 2026-10-23 decision)

20 data rows collapse to **16 unique projects** by column J. Four projects are split across two
consecutive rows because the template caps at 7 organisation columns:

- "Ocean Wave Energy in Australia" (rows 10–11)
- "Operational Modelling for Offshore Aquaculture & Energy" (rows 13–14)
- "Hydrogen Powering of Vessels" (rows 15–16)
- "Otway International Test Centre" (rows 17–18) — **note:** this split is not just an overflow
  split; row 17 is typed "Same research project" and row 18 is typed "Funding relationship" in
  column H. The import creates one Project node from the combined rows, and gives each
  organisation an edge of *that row's own* relationship type to the project, so the funding
  relationships and the research relationships are not collapsed into a single type.

Each row becomes: one Project node (deduplicated by name) + one edge per populated organisation
column (A–G) from that organisation to the project, typed per column H's value for that row.

## Organisation name deduplication

One exact duplicate (case-only) found and resolved:
- Row 6, column C: "Centre for New Energy Technologies (C4Net)"
- Row 20, column B: "Centre for New Energy Technologies (C4NET)"

Both normalize to the same organisation; the importer treats these as one actor record (canonical
display name: the first-seen form, "Centre for New Energy Technologies (C4Net)"). This is reported
in the quality report, not silently absorbed with no trace.

No other near-duplicates were found among the 57 distinct organisation name strings across columns
A–G.

## Open items — left for user confirmation, NOT resolved automatically

1. **Research theme text (column K)**: 56 distinct free-text theme phrases with heavy semantic
   overlap (e.g. "Decarbonisation" vs "industrial decarbonisation" vs "maritime decarbonisation").
   The app's existing taxonomy has a small curated set of Theme nodes used for graph linking and
   filtering. Auto-creating 56 new Theme nodes, or fuzzy-matching these phrases onto the existing
   curated themes, both risk a confusing or semantically wrong graph. **Decision needed:** keep
   this as descriptive text only (current import behaviour), or have someone curate a mapping from
   these phrases to a maintained theme list in a follow-up pass.
2. **Supporting Evidence (column S) visibility**: this column contains the data preparer's own
   internal methodology/review notes ("Date review: ...", "This is not a confirmed actual
   collaboration end..."), not public-facing copy. The import stores it as the relationship's
   `evidence` field (shown in Admin), but **does not** mark it for direct public display without
   review — flagged for your sign-off in the quality report.
3. **Date fields (L, M, U)**: mix Excel serial numbers, free text ("Not disclosed", "2023 (year
   only)"), and one raw ISO datetime. Rather than guess a parsing rule that could silently produce
   a wrong calendar date, the importer keeps these as literal text appended to the evidence field
   instead of populating a structured date column. A follow-up pass can parse serials into real
   dates once the ambiguous free-text cases are reviewed.

## What is NOT fabricated

No relationship, URL, coordinate, confidence level or office location is invented. Office/state
location fields on the imported organisations are left unset (the source data has no address
information) — the app already renders "unavailable" for a missing map location rather than
fabricating one.
