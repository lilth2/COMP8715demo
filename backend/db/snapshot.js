"use strict";
// Dumps a Postgres database's data-bearing tables (not accounts/sessions, which are credentials,
// not test data) to a single timestamped JSON file, for the UAT environment's own backup/restore
// cycle (separate from backend/db/migrate-from-json.js, which is the one-time JSON -> Postgres
// migration). Safe to run against a live database (just SELECTs); does not lock or block writers.
//
// Usage: DATABASE_URL=postgres://... node backend/db/snapshot.js [output-directory]
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const SNAPSHOT_TABLES = [
  "actors", "addresses", "projects", "themes", "relationships", "relationship_types",
  "sources", "layout_positions", "import_batches", "import_rows", "audit_log", "feedback",
];

async function snapshot(connectionString, outDir) {
  const pool = new Pool({ connectionString });
  try {
    const data = {};
    for (const table of SNAPSHOT_TABLES) {
      const result = await pool.query(`SELECT * FROM ${table}`);
      // pg returns a BYTEA column (feedback.screenshot_data) as a Node Buffer. JSON.stringify on a
      // Buffer produces {type:"Buffer",data:[...]} — technically round-trippable but needlessly
      // bloats the snapshot file (one array entry per byte); base64 is far more compact and still
      // restores exactly, see restore.js.
      if (table === "feedback") {
        result.rows.forEach(row => { if (row.screenshot_data) row.screenshot_data = row.screenshot_data.toString("base64"); });
      }
      data[table] = result.rows;
    }
    const schemaVersion = await pool.query("SELECT version FROM schema_meta WHERE id = 1");
    const payload = {
      snapshotVersion: 1,
      schemaVersion: schemaVersion.rows[0] ? schemaVersion.rows[0].version : null,
      takenAt: new Date().toISOString(),
      tables: data,
    };
    fs.mkdirSync(outDir, { recursive: true });
    const filename = `uat-snapshot-${payload.takenAt.replace(/[:.]/g, "-")}.json`;
    const outPath = path.join(outDir, filename);
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    const counts = Object.fromEntries(SNAPSHOT_TABLES.map(t => [t, data[t].length]));
    console.log("Snapshot written to " + outPath);
    console.log("Row counts: " + JSON.stringify(counts));
    return outPath;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL."); process.exit(1); }
  const outDir = process.argv[2] || path.join(__dirname, "..", ".private", "snapshots");
  snapshot(process.env.DATABASE_URL, outDir).catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { snapshot, SNAPSHOT_TABLES };
