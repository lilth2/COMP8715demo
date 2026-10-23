"use strict";
// Integration tests for the PostgreSQL-backed store (backend/db/pg-store.js), run against a real,
// disposable PostgreSQL instance started by the `embedded-postgres` dev dependency (no Docker or
// system Postgres install required — it downloads a self-contained binary into node_modules and
// runs it as the current OS user). This is the one place in the test suite that actually proves
// the relational schema, the JSON-import reconciliation, and the per-record optimistic-
// concurrency check all work against a real database engine, not just in-memory JS.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

let EmbeddedPostgres, Pool;
try {
  // embedded-postgres ships as an ESM-only package, so it needs a dynamic import even from this
  // CommonJS test file; top-level await works inside a node:test test() callback.
  EmbeddedPostgres = null; // resolved lazily below, once we're inside an async context
  ({ Pool } = require("pg"));
} catch {
  // pg is a runtime dependency of the app; if it's missing, skip rather than fail the whole suite.
}
async function loadEmbeddedPostgres() {
  try { return (await import("embedded-postgres")).default; }
  catch { return null; }
}

const { createCore } = require("../../admin/dataset-core");

function loadD() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "data.js"), "utf8"), context);
  return context.window.RD_DATA;
}

test("PostgreSQL store: migration, import reconciliation, restart persistence, and optimistic concurrency", { skip: !Pool }, async (t) => {
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  if (!EmbeddedPostgres) { t.skip("embedded-postgres is not installed"); return; }
  const dataDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "rd-pg-test-"));
  const port = 54329 + Math.floor(Math.random() * 500); // avoid clashing with a parallel run
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "test", password: "test", port, persistent: false });
  const dbName = "rd_directory_test";
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(dbName);
  const connectionString = `postgres://test:test@127.0.0.1:${port}/${dbName}`;

  const { migrate } = require("../db/migrate");
  await migrate(connectionString);

  const { createPgDataStore, importFromJson } = require("../db/pg-store");
  const core = createCore(loadD());
  const seedState = core.defaults();
  const pool = new Pool({ connectionString });
  // node:test runs `after` hooks in registration order, so the pool must be closed (and thus
  // stop issuing queries) strictly before the database server itself is stopped underneath it.
  t.after(async () => {
    await pool.end();
    await pg.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await importFromJson(pool, seedState);

  await t.test("row counts reconcile exactly after import", async () => {
    const store = createPgDataStore(pool);
    const snap = await store.snapshot();
    assert.equal(snap.actors.length, seedState.actors.length);
    assert.equal(snap.projects.length, seedState.projects.length);
    assert.equal(snap.themes.length, seedState.themes.length);
    assert.equal(snap.relationships.length, seedState.relationships.length);
    assert.equal(snap.relationshipTypes.length, seedState.relationshipTypes.length);
    assert.equal(snap.sources.length, seedState.sources.length);
  });

  await t.test("publicData() returns only published records through the real database", async () => {
    const store = createPgDataStore(pool);
    const pub = await store.publicData();
    assert.ok(pub.actors.length > 0);
    assert.ok(pub.actors.every(a => !("status" in a)), "public records carry no draft/status bookkeeping");
  });

  await t.test("a freeform relationship type and a relationship using it round-trip through Postgres, including after a simulated restart", async () => {
    const store = createPgDataStore(pool);
    await store.apply("upsertRelationshipType", { id: "", displayName: "Pg Test Mentors" }, undefined, "tester");
    const afterType = await store.snapshot();
    const createdType = afterType.relationshipTypes.find(ty => ty.displayName === "Pg Test Mentors");
    assert.ok(createdType);

    const [actorA, actorB] = seedState.actors;
    await store.apply("upsertRelationship", { id: "pg-test-rel", sourceId: actorA.id, targetId: actorB.id, type: createdType.id, confidence: "needs-review", intensity: "weak", evidence: "pg integration test" }, undefined, "tester");

    // A brand-new store instance reading the same Postgres simulates a process restart.
    const restarted = createPgDataStore(pool);
    const snap = await restarted.snapshot();
    assert.ok(snap.relationships.find(r => r.id === "pg-test-rel"), "relationship survives a fresh store instance reading the same database");

    await store.apply("publish", { collection: "relationships" }, "pg-test-rel", "tester");
    const pub = await store.publicData();
    assert.ok(pub.relationships.find(r => r.id === "pg-test-rel"), "publish flow works end-to-end through the Postgres store");
  });

  await t.test("deleting an in-use relationship type is blocked until merged", async () => {
    const store = createPgDataStore(pool);
    const snap = await store.snapshot();
    const type = snap.relationshipTypes.find(ty => ty.displayName === "Pg Test Mentors");
    await assert.rejects(() => store.apply("deleteRelationshipType", undefined, type.id, "tester"), /used by one or more relationships/);
  });

  await t.test("optimistic concurrency: a write against a stale cached version is rejected with a conflict, never silently overwritten", async () => {
    const storeA = createPgDataStore(pool);
    const storeB = createPgDataStore(pool);
    const actorId = seedState.actors[0].id;
    // Both stores load their cache at the same starting version.
    const recordA = (await storeA.snapshot()).actors.find(a => a.id === actorId);
    await storeB.snapshot();

    await storeA.apply("upsertActor", { ...recordA, summary: "Edited by A" }, undefined, "tester-a");

    await assert.rejects(
      () => storeB.apply("upsertActor", { ...recordA, summary: "Edited by B" }, undefined, "tester-b"),
      (error) => error.status === 409
    );

    const finalRecord = (await storeA.snapshot()).actors.find(a => a.id === actorId);
    assert.equal(finalRecord.summary, "Edited by A", "the committed write is A's; B's conflicting write never applied");
  });

  await t.test("applyBatch rolls back ALL operations in the batch if a later one fails, never leaving a partially-imported state", async () => {
    const store = createPgDataStore(pool);
    await assert.rejects(() => store.applyBatch([
      { operation: "bulkUpsert", value: { collection: "actors", mode: "add-only", rows: [{ id: "rollback-batch-org", name: "Rollback Batch Org", type: "university", summary: "x", sourceRow: 2 }] }, username: "tester" },
      { operation: "bulkUpsert", value: { collection: "relationships", mode: "add-only", rows: [{ source: "does-not-exist", target: "also-does-not-exist", type: "collaborates_with", sourceRow: 2 }] }, username: "tester" },
    ]));
    const snap = await store.snapshot();
    assert.equal(snap.actors.some(a => a.id === "rollback-batch-org"), false, "the organisation from the first (otherwise-valid) operation must not persist when a later operation in the same batch fails");
  });
});
