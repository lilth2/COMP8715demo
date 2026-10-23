"use strict";
// One-shot script: reads the real organisation-relationship Excel file (path given on the
// command line or via EXCEL_PATH), applies the field mapping documented in README.md, and
// imports it into whatever Postgres database DATABASE_URL points at (intended: an isolated UAT
// database, never production) via the exact same bulkUpsert pipeline the admin UI uses — so
// everything imported here is a normal, auditable, draft-by-default bulk import batch, not a
// special-cased backdoor write.
//
// Usage:
//   DATABASE_URL=postgres://... node backend/import/real-data/import-real-dataset.js "/path/to/file.xlsx"
//
// Safety:
//   - Read-only against the source file (never writes/renames/deletes it).
//   - Refuses to run without DATABASE_URL (no accidental write to the single-JSON-file store).
//   - Two-phase: first prints the full preview (counts + every row's planned action and any
//     errors) and a reconciliation against the source file's row count, then requires --commit
//     to actually write. Running without --commit is a dry run.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { openWorkbook } = require("../xlsx-parser");
const { createPgDataStore } = require("../../db/pg-store");
const { createCore } = require("../../../admin/dataset-core");

const SHEET_NAME = "Relationship data";
const HEADER_ROW = 5;
const FIRST_DATA_ROW = 6;
const LAST_DATA_ROW = 25;
const ORG_COLUMNS = ["A", "B", "C", "D", "E", "F", "G"];

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function cell(row, col) {
  const v = row.cells[col];
  return v === null || v === undefined ? "" : String(v).trim();
}

// Canonicalises an organisation name for deduplication (case-insensitive, collapsed whitespace),
// while keeping the first-seen exact spelling as the display name — documented in README.md.
function buildOrgCanon(dataRows) {
  const canonToDisplay = new Map(); // normalized -> first-seen exact string
  dataRows.forEach(row => {
    ORG_COLUMNS.forEach(col => {
      const name = cell(row, col);
      if (!name) return;
      const norm = name.toLowerCase().replace(/\s+/g, " ");
      if (!canonToDisplay.has(norm)) canonToDisplay.set(norm, name);
    });
  });
  return canonToDisplay;
}

function readSourceRows(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = openWorkbook(buf);
  if (wb.sheets.indexOf(SHEET_NAME) === -1) throw new Error("Sheet \"" + SHEET_NAME + "\" not found. Sheets present: " + wb.sheets.join(", "));
  const sheet = wb.readSheet(SHEET_NAME);
  const dataRows = sheet.rows.filter(r => r.rowNumber >= FIRST_DATA_ROW && r.rowNumber <= LAST_DATA_ROW);
  return { buf, dataRows };
}

// Builds the actors[] and projects[] bulk-import row arrays (for planBulkUpsert/bulkUpsert)
// from the raw sheet rows, per the mapping in README.md.
function buildImportPlan(dataRows, canonToDisplay) {
  const orgNameToId = new Map(); // display name -> stable slug id
  const actorRows = [];
  canonToDisplay.forEach((displayName) => {
    const id = slug(displayName);
    orgNameToId.set(displayName.toLowerCase().replace(/\s+/g, " "), id);
    actorRows.push({ id, name: displayName, type: "industry_partner", summary: "Organisation imported from the real organisation-relationship dataset. Type is a placeholder pending manual classification (university/CRC/government/industry) — not inferred from the source data, which does not classify organisations.", sourceRow: null });
  });

  // Group rows by project name (column J) to build one project per name, carrying forward the
  // evidence fields from EVERY row that contributes to it (handles the 4 split projects).
  const projectsByName = new Map(); // name -> { id, rows: [...], orgsWithType: [{name, type}] }
  dataRows.forEach(row => {
    const projectName = cell(row, "J");
    if (!projectName) return; // J is 20/20 populated in the real file; defensive only
    if (!projectsByName.has(projectName)) projectsByName.set(projectName, { id: slug(projectName), rows: [], orgsWithType: [] });
    const entry = projectsByName.get(projectName);
    entry.rows.push(row);
    const relType = cell(row, "H") || "Unspecified";
    ORG_COLUMNS.forEach(col => {
      const orgName = cell(row, col);
      if (!orgName) return;
      entry.orgsWithType.push({ orgName, relType, sourceRow: row.rowNumber });
    });
  });

  const projectRows = [];
  const relationshipRows = [];
  projectsByName.forEach((entry, projectName) => {
    const firstRow = entry.rows[0];
    const evidenceParts = entry.rows.map(row => {
      const parts = [];
      if (cell(row, "I")) parts.push("Description: " + cell(row, "I"));
      if (cell(row, "L")) parts.push("Start: " + cell(row, "L"));
      if (cell(row, "M")) parts.push("End: " + cell(row, "M"));
      if (cell(row, "N")) parts.push("Ongoing: " + cell(row, "N"));
      if (cell(row, "P")) parts.push("Frequency: " + cell(row, "P"));
      if (cell(row, "Q")) parts.push("Strength: " + cell(row, "Q"));
      if (cell(row, "R")) parts.push("Funding/grant: " + cell(row, "R"));
      if (cell(row, "S")) parts.push("Supporting evidence: " + cell(row, "S"));
      return "[Row " + row.rowNumber + "] " + parts.join(" | ");
    });
    const themeText = Array.from(new Set(entry.rows.map(row => cell(row, "K")).filter(Boolean))).join(" ");
    const sourceUrls = Array.from(new Set(entry.rows.flatMap(row => cell(row, "T").split(/\r?\n/).map(s => s.trim()).filter(Boolean))));

    projectRows.push({
      id: entry.id, name: projectName,
      summary: ("Research theme / area (source text, not mapped to a theme taxonomy): " + (themeText || "(none given)") + ".").slice(0, 4000),
      sourceRow: firstRow.rowNumber,
      evidenceSnippet: evidenceParts.join("\n").slice(0, 8000),
    });

    // Some split projects (see README.md "Project grouping") name the same lead organisation in
    // both halves of the split with the same relationship type — the literal same fact stated
    // twice because the CRC/lead body spans both participant groups. One edge per distinct
    // (organisation, type) pair per project is created, not one per source row, so this does not
    // produce a duplicate-ID error or a redundant edge; all contributing row numbers are kept in
    // the evidence text so the provenance is still fully traceable.
    const seenOrgType = new Map(); // "canonId|relType" -> accumulated evidence entry
    entry.orgsWithType.forEach(({ orgName, relType, sourceRow }) => {
      const canonId = orgNameToId.get(orgName.toLowerCase().replace(/\s+/g, " "));
      if (!canonId) return; // should not happen; every org name was registered above
      const key = canonId + "|" + relType;
      if (!seenOrgType.has(key)) seenOrgType.set(key, { orgName, relType, sourceRows: [] });
      seenOrgType.get(key).sourceRows.push(sourceRow);
    });
    seenOrgType.forEach(({ orgName, relType, sourceRows }, key) => {
      const canonId = key.slice(0, key.lastIndexOf("|"));
      relationshipRows.push({
        source: canonId, target: entry.id, type: relType,
        evidence: ("Organisation \"" + orgName + "\" linked to project \"" + projectName + "\" (source row(s) " + sourceRows.join(", ") + ") via relationship type \"" + relType + "\" from the source spreadsheet. Source URL(s): " + (sourceUrls.join("; ") || "(none)")).slice(0, 4000),
        sourceRow: sourceRows[0],
      });
    });
  });

  return { actorRows, projectRows, relationshipRows };
}

async function main() {
  const filePath = process.argv[2] || process.env.EXCEL_PATH;
  const commit = process.argv.includes("--commit");
  if (!filePath) throw new Error("Usage: node import-real-dataset.js <path-to-xlsx> [--commit]");
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the isolated UAT database before running this script.");
  if (!fs.existsSync(filePath)) throw new Error("File not found: " + filePath);

  console.log("Reading (read-only): " + filePath);
  const { buf, dataRows } = readSourceRows(filePath);
  console.log("Source rows found: " + dataRows.length + " (expected " + (LAST_DATA_ROW - FIRST_DATA_ROW + 1) + ")");
  if (dataRows.length !== LAST_DATA_ROW - FIRST_DATA_ROW + 1) {
    console.warn("WARNING: source row count does not match the expected range " + FIRST_DATA_ROW + "-" + LAST_DATA_ROW + ". Verify the file has not changed before proceeding.");
  }
  const anyFormulas = dataRows.some(r => r.hasFormula);
  if (anyFormulas) console.warn("WARNING: formulas detected in the data rows. Formula bodies are never read — only cached values. Review manually if this matters.");

  const canonToDisplay = buildOrgCanon(dataRows);
  console.log("Unique organisations after case-insensitive dedup: " + canonToDisplay.size);
  const { actorRows, projectRows, relationshipRows } = buildImportPlan(dataRows, canonToDisplay);
  console.log("Planned: " + actorRows.length + " organisations, " + projectRows.length + " projects, " + relationshipRows.length + " relationships.");

  const fingerprint = crypto.createHash("sha256").update(buf).update("|" + SHEET_NAME).update("|add-only-real-data-import").digest("hex");
  console.log("File fingerprint: " + fingerprint);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // See backend/server.js for why a long-lived Pool needs this: an idle client losing its
  // connection (common on a serverless/pooled Postgres endpoint like Neon, which can recycle idle
  // connections) emits an unhandled, fatal 'error' event if nothing is listening for it.
  pool.on("error", error => console.error("Postgres pool error (connection dropped, pool will recover automatically): " + error.message));
  const store = createPgDataStore(pool);
  const vm = require("node:vm");
  const dataContext = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "..", "data.js"), "utf8"), dataContext);
  const core = createCore(dataContext.window.RD_DATA);

  try {
    const existing = await store.snapshot();
    const subFingerprints = [fingerprint + ":actors", fingerprint + ":projects", fingerprint];
    const already = (existing.importBatches || []).find(b => subFingerprints.indexOf(b.fingerprint) !== -1);
    if (already) {
      console.log("This exact file was already imported into this database on " + already.importedAt + " (fingerprint match). Nothing to do.");
      return;
    }

    // Plan against a local simulation that applies each phase in turn (actors, then projects,
    // then relationships), so the relationships phase sees the organisations/projects the earlier
    // phases will have created — without writing anything to Postgres yet. This mirrors exactly
    // what the sequential store.apply() calls below will do for real once --commit is passed.
    let simulated = existing;
    for (const [label, collection, rows] of [["organisations", "actors", actorRows], ["projects", "projects", projectRows], ["relationships", "relationships", relationshipRows]]) {
      const plan = core.planBulkUpsert(simulated, collection, "add-only", rows);
      console.log("\n=== " + label + " plan ===");
      console.log("  created: " + plan.counts.created + ", updated: " + plan.counts.updated + ", skipped: " + plan.counts.skipped + ", errors: " + plan.counts.errors);
      plan.rows.filter(r => r.action === "error").forEach(r => console.log("  ROW ERROR (source row " + r.sourceRow + "): " + r.errors.join("; ")));
      if (!plan.canCommit) throw new Error(label + " import has row errors; aborting before any write. See output above.");
      simulated = core.apply(simulated, "bulkUpsert", { collection: collection, mode: "add-only", rows: rows }, undefined, "real-data-import-script");
    }

    if (!commit) {
      console.log("\nDry run complete (no --commit flag given). Nothing was written. Re-run with --commit to import for real.");
      return;
    }

    console.log("\nCommitting...");
    // All three phases (organisations, projects, relationships) are applied as ONE batch so they
    // land in a single Postgres transaction: a failure partway through (e.g. the relationships
    // phase hitting a validation error) rolls back the organisations/projects already applied in
    // this same call too, instead of leaving a half-imported dataset. (applyBatch is distinct from
    // calling store.apply() three times, which would commit each phase separately.)
    const commonFile = { sourceFilename: path.basename(filePath), sheetName: SHEET_NAME };
    const final = await store.applyBatch([
      { operation: "bulkUpsert", value: Object.assign({ collection: "actors", mode: "add-only", rows: actorRows, fingerprint: fingerprint + ":actors" }, commonFile), username: "real-data-import-script" },
      { operation: "bulkUpsert", value: Object.assign({ collection: "projects", mode: "add-only", rows: projectRows, fingerprint: fingerprint + ":projects" }, commonFile), username: "real-data-import-script" },
      { operation: "bulkUpsert", value: Object.assign({ collection: "relationships", mode: "add-only", rows: relationshipRows, fingerprint: fingerprint }, commonFile), username: "real-data-import-script" },
    ]);
    console.log("Committed. Totals now in database: " + final.actors.length + " actors, " + final.projects.length + " projects, " + final.relationships.length + " relationships.");
    console.log("All imported records are Drafts (never auto-published). Review and publish from the admin console when ready.");
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  // Logging only error.message previously hid the actual cause entirely whenever a rejection
  // carried no message (e.g. a dropped-connection error from a serverless Postgres pooler during
  // the finally block's pool.end() call) — the real exception needs to be visible for anyone
  // operating this script against a real, network-attached database, not just a local one.
  console.error("FAILED: " + (error && (error.stack || error.message) || String(error)));
  process.exitCode = 1;
});
