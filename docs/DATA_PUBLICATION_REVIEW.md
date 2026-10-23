# Data publication review — evidence vs. internal notes

This document corrects and replaces the earlier blanket claim in `docs/UAT.md` ("every
relationship's evidence field... embeds the data preparer's own internal notes") — that claim was
**not accurate** and is corrected here after actually reading all 92 relationship evidence strings
and all 16 project evidence snippets, not assuming they all carry the same risk.

Method: queried every row's `evidence` (relationships) / `evidence_snippet` (projects) directly
from the live database and scanned each one programmatically for internal-review language
("Supporting evidence:", "Date review:") plus manual reading of every match. Nothing below is
guessed — see the exact counts.

## Organisations (actors) — 56/56 publishable, no review needed

No organisation record carries an evidence/notes field at all. Every `summary` is the same generic,
already-public-safe boilerplate ("Organisation imported from the real organisation-relationship
dataset. Type is a placeholder pending manual classification..."). `source_notes` is empty on every
row. **There is nothing in any organisation record that needs redaction or review.**

The one real caveat, unrelated to public-safety: every organisation's `type` is a placeholder
(`industry_partner`), not a verified classification (university/CRC/government/industry). This is
a data-completeness gap, not a confidentiality risk — publishing these records would not leak
anything, it would just show an inaccurate type label until someone classifies them properly.

## Relationships — 92/92 publishable, no review needed

Every relationship's `evidence` field is generated entirely from: the organisation name, the
project name, the relationship type, and the source URL(s) copied from the spreadsheet's own
"Source URL(s)" column (see `backend/import/real-data/import-real-dataset.js`'s
`relationshipRows.push(...)` — it builds the string from exactly these four things, nothing else).

Verified by scanning all 92 rows' `evidence` text for the phrases "Supporting evidence", "Date
review", "review", "internal", "methodology", "flagged for", "needs confirmation" — **zero
matches**. Every relationship's evidence is already public-facing, source-cited, factual text.

## Projects — 0/16 publishable as-is; all 16 need a review decision

Every project's `evidence_snippet` concatenates per-source-row fields with ` | ` separators,
and **every one of the 16 includes at least one `Supporting evidence: ...` segment** — this is the
data preparer's own internal methodology/review note (e.g. *"Date review: official project page...
confirms the project is completed but do not disclose its start/end dates. Not disclosed means no
explicit project date was located..."*), never written for public consumption.

Within the same field, most projects *also* have genuinely public-safe segments mixed in alongside
the internal one — a `Description: ...` segment (a plain-English description of the project), and
factual `Start:`/`End:`/`Ongoing:`/`Funding:` fields. The internal note is not the whole field; it's
one segment glued onto otherwise-fine text.

| Project | Public-safe segments | Internal (`Supporting evidence:`) segments |
| --- | --- | --- |
| Advanced air mobility technologies and achieving Net Zero 2050 | 5 | 1 |
| Australian Offshore Wind: Development Scenarios, Modelling Inputs and Project Design Envelopes | 5 | 1 |
| Decarbonising Ironmaking with Australian Renewable Hydrogen and WA Iron Ores | 5 | 1 |
| Decarbonising Tasmanian domestic commercial vessels | 5 | 1 |
| Digital Twin enabled Sustainable Sunshine Precinct Development | 2 | 1 |
| ESP: Preparing for the electrification of transportation | 6 | 1 |
| Green hydrogen for road transport in Western Australia | 5 | 1 |
| Highly sensitive, reliable, selective, and innovative hydrogen gas sensing system for renewable energy plants | 6 | 1 |
| Hydrogen Powering of Vessels | 12 | 2 |
| Hydrogen Storage and Distribution | 6 | 1 |
| Hydrogen Utilisation in Industrial Applications: Evaluation of Impact on Materials and Infrastructure | 1 | 1 |
| Low-carbon transit-oriented development precincts | 5 | 1 |
| NSW Gas Decarbonisation Roadmap – modelling project | 1 | 1 |
| Ocean Wave Energy in Australia | 12 | 2 |
| Operational Modelling for Offshore Aquaculture & Energy | 12 | 2 |
| Otway International Test Centre | 10 | 2 |

**What "needs confirmation" means concretely**: for each of these 16 projects, a human decision is
needed on one of:
1. Publish the project with `evidence_snippet` as-is (the internal note goes public verbatim) — not
   recommended, since the note was never written for a public reader.
2. Publish the project with a **rewritten** `evidence_snippet` containing only the public-safe
   segments (Description/Start/End/Ongoing/Funding), with the `Supporting evidence:` segment
   removed or moved somewhere admin-only.
3. Leave the project in Draft until someone writes genuinely public-facing copy for it.

This document does not choose for you — per the explicit instruction not to bulk-publish before
confirmation, **no project has been published or had its evidence_snippet rewritten**. The two rows
with 1/1 public-safe-to-internal ratio (Hydrogen Utilisation..., NSW Gas Decarbonisation...) are the
ones where removing the internal segment would leave almost nothing — those specifically need a
human to write real public-facing copy, not just a mechanical strip.

## What this means in practice (current state, unchanged by this review)

- **Organisations (56) and relationships (92) could be published without any text-redaction work**
  — the only reason they remain Draft is that doing so would still show them fully correctly
  connected on the public graph to 16 projects that are *not* published, which would look
  incomplete/broken rather than wrong. Publishing orgs/relationships without their projects is
  possible but was not done this round, since it wasn't asked for and would need its own decision
  about whether a partially-connected public graph is acceptable.
- **Projects (16) remain Draft** pending the decision above.
- **Nothing has been bulk-published.** This review only classifies; it does not act.
- **Traceability preserved**: every relationship and project still carries its original source row
  number(s) in `evidence`/`evidence_snippet`, its import batch ID, and the file fingerprint —
  nothing from this review changed any stored data, so the original source-to-record mapping
  remains fully intact and auditable via `import_batches`/`import_rows`.

## Correction notice

`docs/UAT.md` §8 previously stated "every relationship's evidence field... embeds the data
preparer's own internal 'Supporting evidence' notes" — **this was wrong** for relationships (0/92
actually do) and right only for projects (16/16 do). `docs/UAT.md` has been updated to point here
for the accurate, per-collection breakdown instead of repeating the incorrect blanket claim.
