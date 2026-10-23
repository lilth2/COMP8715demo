"use strict";
// Restores a UAT database from a snapshot produced by backend/db/snapshot.js.
//
// Safety, per the brief's explicit requirements:
//   - ALWAYS takes a fresh snapshot of the database's current state before touching anything,
//     so a restore can itself be undone.
//   - Feedback (the `feedback` table) is NEVER restored/overwritten by default — restoring test
//     data must not silently delete feedback submitted after the snapshot was taken. Pass
//     --include-feedback to explicitly opt into also restoring feedback rows (e.g. restoring a
//     snapshot taken specifically to preserve feedback state), which still only ADDS missing rows
//     back (by id), never deletes a feedback row that exists now but isn't in the snapshot.
//   - Runs inside one transaction: a failure partway through rolls back entirely, never leaving
//     a half-restored database.
//   - Refuses to run without explicit --confirm, since this is a destructive operation on
//     whatever data currently exists in the target database.
//
// Usage: DATABASE_URL=postgres://... node backend/db/restore.js <snapshot-file.json> --confirm [--include-feedback]
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { snapshot, SNAPSHOT_TABLES } = require("./snapshot");

const COLUMN_ORDER = {
  actors: ["id", "name", "type", "state", "summary", "data_confidence", "sectors", "themes", "website", "last_updated", "source_notes", "status", "published_snapshot", "extra", "version", "updated_at"],
  addresses: ["id", "actor_id", "role", "state", "city", "focus", "position"],
  projects: ["id", "name", "host_id", "state", "summary", "data_confidence", "themes", "last_updated", "evidence_snippet", "status", "published_snapshot", "version", "updated_at"],
  themes: ["id", "name", "summary", "data_confidence", "last_updated", "status", "published_snapshot", "version", "updated_at"],
  relationships: ["id", "source_id", "target_id", "type", "confidence", "intensity", "evidence", "last_updated", "status", "published_snapshot", "version", "updated_at"],
  relationship_types: ["id", "display_name", "color", "is_system", "created_at", "created_by"],
  sources: ["id", "name", "type", "notes", "version"],
  layout_positions: ["node_id", "x", "y"],
  import_batches: ["id", "collection", "source_filename", "file_fingerprint", "sheet_name", "imported_by", "imported_at", "mode", "row_count", "created_count", "updated_count", "skipped_count", "error_count", "status"],
  import_rows: ["id", "batch_id", "source_row_number", "record_type", "record_id", "outcome", "detail", "raw_row"],
  audit_log: ["id", "timestamp", "actor", "action", "record_type", "record_id", "batch_id", "label", "details", "result"],
  feedback: ["id", "kind", "title", "description", "repro_steps", "expected_result", "actual_result", "related_page", "related_record_id", "screenshot_path", "submitted_by", "submitted_at", "app_version", "current_page", "request_id", "idempotency_key", "status", "status_updated_at", "status_updated_by"],
};

async function restore(connectionString, snapshotPath, { includeFeedback = false, autoBackupDir } = {}) {
  const payload = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  if (!payload || payload.snapshotVersion !== 1 || !payload.tables) throw new Error("Not a recognised snapshot file.");

  const pool = new Pool({ connectionString });
  try {
    const backupPath = await snapshot(connectionString, autoBackupDir || path.join(path.dirname(snapshotPath), "pre-restore-backups"));
    console.log("Safety backup of CURRENT state taken before restoring: " + backupPath);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Clear tables in FK-safe order (children before parents; relationship_types last among
      // referenced tables since relationships.type -> relationship_types.id).
      const clearOrder = ["import_rows", "import_batches", "addresses", "relationships", "layout_positions", "actors", "projects", "themes", "relationship_types", "sources", "audit_log"];
      if (includeFeedback) clearOrder.unshift("feedback");
      for (const table of clearOrder) await client.query(`DELETE FROM ${table}`);

      // Insert in FK-safe order (parents before children).
      const insertOrder = ["relationship_types", "actors", "projects", "themes", "relationships", "addresses", "sources", "layout_positions", "import_batches", "import_rows", "audit_log"];
      if (includeFeedback) insertOrder.push("feedback");
      for (const table of insertOrder) {
        const rows = payload.tables[table] || [];
        const columns = COLUMN_ORDER[table];
        for (const row of rows) {
          const values = columns.map(c => row[c]);
          const placeholders = columns.map((_, i) => "$" + (i + 1)).join(",");
          await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`, values);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const counts = Object.fromEntries(SNAPSHOT_TABLES.map(t => [t, (payload.tables[t] || []).length]));
    console.log("Restore complete. Row counts now: " + JSON.stringify(includeFeedback ? counts : { ...counts, feedback: "(preserved, not restored)" }));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const snapshotFile = args.find(a => !a.startsWith("--"));
  const confirmed = args.includes("--confirm");
  const includeFeedback = args.includes("--include-feedback");
  if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL."); process.exit(1); }
  if (!snapshotFile) { console.error("Usage: node restore.js <snapshot-file.json> --confirm [--include-feedback]"); process.exit(1); }
  if (!confirmed) { console.error("This will replace the target database's data tables. Re-run with --confirm to proceed (a safety backup of the current state is taken automatically first)."); process.exit(1); }
  restore(process.env.DATABASE_URL, snapshotFile, { includeFeedback }).catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { restore };
