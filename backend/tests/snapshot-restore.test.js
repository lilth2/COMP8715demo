"use strict";
// Integration tests for backend/db/snapshot.js and backend/db/restore.js against a real,
// disposable PostgreSQL instance.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let Pool;
try { ({ Pool } = require("pg")); } catch { /* skip below if missing */ }
async function loadEmbeddedPostgres() {
  try { return (await import("embedded-postgres")).default; } catch { return null; }
}

test("snapshot + restore: recovers deleted records, preserves feedback by default, and takes a safety backup first", { skip: !Pool }, async (t) => {
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  if (!EmbeddedPostgres) { t.skip("embedded-postgres is not installed"); return; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-snapshot-test-"));
  const port = 54700 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "test", password: "test", port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("rd_snapshot_test");
  const connectionString = `postgres://test:test@127.0.0.1:${port}/rd_snapshot_test`;

  const pool = new Pool({ connectionString });
  // See regression-consistency.test.js for why this listener is needed (CI-only teardown race
  // between embedded-postgres shutdown and pool.end(), not a mask for a real failure).
  pool.on("error", () => {});
  t.after(async () => { await pool.end(); await pg.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const { migrate } = require("../db/migrate");
  await migrate(connectionString);

  const { createPgDataStore } = require("../db/pg-store");
  const { createAccountsStore } = require("../accounts-pg");
  const { snapshot } = require("../db/snapshot");
  const { restore } = require("../db/restore");

  const store = createPgDataStore(pool);
  const accounts = createAccountsStore(pool, "uat");
  const account = await accounts.create({ username: "tester", password: "Tester-password-2026!", role: "stakeholder", createdBy: "test" });

  await store.apply("bulkUpsert", { collection: "actors", mode: "add-only", rows: [{ id: "snap-org", name: "Snap Org", type: "university", summary: "x", sourceRow: 2 }] }, undefined, "tester");

  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-snapshots-"));
  const snapshotPath = await snapshot(connectionString, snapshotDir);
  assert.ok(fs.existsSync(snapshotPath));
  const snapshotBody = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  assert.equal(snapshotBody.tables.actors.length, 1);

  // Add a feedback row AFTER the snapshot was taken, simulating real test activity between backups.
  await pool.query("INSERT INTO feedback (kind, title, description, submitted_by, status) VALUES ('bug', 'Post-snapshot feedback', 'desc', $1, 'New')", [account.id]);

  // Simulate data loss: delete the actor.
  await pool.query("DELETE FROM actors WHERE id = 'snap-org'");
  const beforeRestore = await pool.query("SELECT count(*) FROM actors");
  assert.equal(Number(beforeRestore.rows[0].count), 0);

  await restore(connectionString, snapshotPath, { autoBackupDir: snapshotDir });

  const afterRestore = await pool.query("SELECT id, name FROM actors");
  assert.equal(afterRestore.rows.length, 1, "the deleted organisation is recovered");
  assert.equal(afterRestore.rows[0].id, "snap-org");

  const feedbackAfter = await pool.query("SELECT title FROM feedback");
  assert.equal(feedbackAfter.rows.length, 1, "feedback submitted after the snapshot was taken is NOT deleted by a restore that doesn't include feedback");
  assert.equal(feedbackAfter.rows[0].title, "Post-snapshot feedback");

  const backupFiles = fs.readdirSync(snapshotDir).filter(f => f.startsWith("uat-snapshot-"));
  assert.ok(backupFiles.length >= 2, "a safety backup of the pre-restore state was taken automatically, in addition to the original snapshot");

  // Feedback screenshots are stored as raw bytes (BYTEA), which snapshot.js base64-encodes for
  // the JSON file and restore.js must decode back to a real Buffer before inserting — a lossy
  // round-trip here would silently corrupt every screenshot restored from a backup.
  const pngBytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  await pool.query(
    "INSERT INTO feedback (id, kind, title, description, submitted_by, status, screenshot_data, screenshot_mime_type) VALUES ('11111111-1111-1111-1111-111111111111', 'bug', 'With screenshot', 'desc', $1, 'New', $2, 'image/png')",
    [account.id, pngBytes]
  );
  const screenshotSnapshotPath = await snapshot(connectionString, snapshotDir);
  await pool.query("DELETE FROM feedback WHERE id = '11111111-1111-1111-1111-111111111111'");
  await restore(connectionString, screenshotSnapshotPath, { autoBackupDir: snapshotDir, includeFeedback: true });
  const restoredScreenshot = await pool.query("SELECT screenshot_data, screenshot_mime_type FROM feedback WHERE id = '11111111-1111-1111-1111-111111111111'");
  assert.equal(restoredScreenshot.rows.length, 1);
  assert.ok(Buffer.from(restoredScreenshot.rows[0].screenshot_data).equals(pngBytes), "the screenshot's exact bytes survive a snapshot + restore round-trip");
  assert.equal(restoredScreenshot.rows[0].screenshot_mime_type, "image/png");
});
