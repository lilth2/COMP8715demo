"use strict";
// One-time migration: existing backend/.private/dataset.json (JSON-file store) -> Postgres.
//
// Safety:
//   - Refuses to run against a database that already has any actors/projects/themes/relationships
//     (use a fresh/empty database, or the isolated UAT/test database — never point this at a
//     database holding real data you have not already backed up).
//   - Copies the source JSON file to <path>.bak-before-pg-migration-<timestamp> before touching
//     anything, so the pre-migration JSON state is always recoverable.
//   - Reports exact row counts per collection before and after, so a short count mismatch is
//     visible immediately rather than discovered later.
//
// Usage: DATABASE_URL=... DATA_PATH=backend/.private/dataset.json node backend/db/migrate-from-json.js
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createDataStore } = require("../server-data");
const { importFromJson } = require("./pg-store");

async function run() {
  const dataPath = process.env.DATA_PATH || path.join(__dirname, "..", ".private", "dataset.json");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error("Set DATABASE_URL."); process.exit(1); }
  if (!fs.existsSync(dataPath)) { console.error("No JSON dataset found at " + dataPath + " — nothing to migrate."); process.exit(1); }

  const backupPath = dataPath + ".bak-before-pg-migration-" + new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(dataPath, backupPath);
  console.log("Backed up original JSON to " + backupPath);

  const jsonStore = createDataStore(dataPath);
  const jsonState = jsonStore.snapshot();
  const counts = {
    actors: jsonState.actors.length, projects: jsonState.projects.length, themes: jsonState.themes.length,
    relationships: jsonState.relationships.length, relationshipTypes: (jsonState.relationshipTypes || []).length, sources: jsonState.sources.length,
  };
  console.log("Source JSON row counts:", counts);

  const pool = new Pool({ connectionString });
  try {
    const existing = await pool.query("SELECT (SELECT count(*) FROM actors) + (SELECT count(*) FROM projects) + (SELECT count(*) FROM themes) + (SELECT count(*) FROM relationships) AS total");
    if (Number(existing.rows[0].total) > 0) {
      console.error("Refusing to migrate: the target database already has records. Point DATABASE_URL at an empty/fresh database.");
      process.exit(1);
    }
    await importFromJson(pool, jsonState);
    const after = await pool.query("SELECT (SELECT count(*) FROM actors) AS actors, (SELECT count(*) FROM projects) AS projects, (SELECT count(*) FROM themes) AS themes, (SELECT count(*) FROM relationships) AS relationships, (SELECT count(*) FROM relationship_types) AS relationship_types, (SELECT count(*) FROM sources) AS sources");
    const row = after.rows[0];
    console.log("Postgres row counts after import:", { actors: Number(row.actors), projects: Number(row.projects), themes: Number(row.themes), relationships: Number(row.relationships), relationshipTypes: Number(row.relationship_types), sources: Number(row.sources) });
    const mismatches = Object.keys(counts).filter(k => counts[k] !== Number(row[k === "relationshipTypes" ? "relationship_types" : k]));
    if (mismatches.length) {
      console.error("Row count mismatch after import in: " + mismatches.join(", ") + ". Do not treat this migration as complete — investigate before using this database.");
      process.exit(1);
    }
    console.log("Row counts reconcile exactly. Migration complete.");
    console.log("The original JSON file at " + dataPath + " was left untouched; the backup is at " + backupPath + ".");
  } finally {
    await pool.end();
  }
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exit(1); });
module.exports = { run };
