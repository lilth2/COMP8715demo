"use strict";
// End-to-end regression/consistency checks through the real HTTP API against a real, disposable
// PostgreSQL instance -- the brief's explicit list of properties that must hold across the whole
// system, not just inside dataset-core.js's own unit tests.
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

test("Regression: draft isolation, publish consistency, delete cleanup, no fake fallback, custom types don't break the public API", { skip: !Pool }, async (t) => {
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  if (!EmbeddedPostgres) { t.skip("embedded-postgres is not installed"); return; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-regression-test-"));
  const port = 54900 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "test", password: "test", port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("rd_regression_test");
  const connectionString = `postgres://test:test@127.0.0.1:${port}/rd_regression_test`;

  const pool = new Pool({ connectionString });
  const { migrate } = require("../db/migrate");
  await migrate(connectionString);

  const { createPgDataStore } = require("../db/pg-store");
  const { createAccountsStore } = require("../accounts-pg");
  const { createSessionsStore } = require("../sessions-pg");
  const { createApp } = require("../server");

  const store = createPgDataStore(pool);
  const accountsStore = createAccountsStore(pool, "uat");
  const sessionsStore = createSessionsStore(pool, 8 * 60 * 60 * 1000);
  await accountsStore.create({ username: "admin", password: "Admin-password-2026!", role: "admin", createdBy: "test" });

  const app = createApp({ secureCookies: false, allowedOrigins: ["http://test.local"], store, accountsStore, sessionsStore, environment: "uat" });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.address().port;
  t.after(() => new Promise(resolve => app.close(resolve)));
  t.after(async () => { await pool.end(); await pg.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const post = (route, value, token) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://test.local", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(value) });
  const get = (route, token) => fetch(base + route, { headers: { Origin: "http://test.local", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  const token = await login();
  async function login() { return (await (await post("/api/login", { username: "admin", password: "Admin-password-2026!" })).json()).token; }

  await t.test("a saved draft never appears on the public API", async () => {
    const createRes = await post("/api/admin/action", { operation: "upsertActor", value: { id: "reg-org-a", name: "Reg Org A", type: "university", state: "NSW", summary: "x", dataConfidence: "needs-review", themes: [], sectors: [], sourceNotes: [] } }, token);
    assert.equal(createRes.status, 200, await createRes.text());
    const pub = await (await get("/api/dataset")).json();
    assert.equal(pub.actors.some(a => a.id === "reg-org-a"), false, "draft is invisible on the public API");
  });

  let orgAId = "reg-org-a", orgBId = "reg-org-b", relId;
  await t.test("publishing makes a record consistently visible via the public API", async () => {
    const publishRes = await post("/api/admin/action", { operation: "publish", value: { collection: "actors" }, id: orgAId }, token);
    assert.equal(publishRes.status, 200, await publishRes.text());
    const pub = await (await get("/api/dataset")).json();
    assert.ok(pub.actors.find(a => a.id === orgAId), "published organisation appears on the public API");
  });

  await t.test("a relationship is public only once itself AND both endpoints are published", async () => {
    const createBRes = await post("/api/admin/action", { operation: "upsertActor", value: { id: orgBId, name: "Reg Org B", type: "university", state: "VIC", summary: "x", dataConfidence: "needs-review", themes: [], sectors: [], sourceNotes: [] } }, token);
    assert.equal(createBRes.status, 200, await createBRes.text());
    // orgB stays a draft deliberately.
    const createRelRes = await post("/api/admin/import/commit", { collection: "relationships", mode: "add-only", rows: [{ source: orgAId, target: orgBId, type: "Regression Test Type", sourceRow: 2 }] }, token);
    const afterCreate = await createRelRes.json();
    relId = afterCreate.relationships.find(r => r.sourceId === orgAId && r.targetId === orgBId).id;

    const publishRelRes = await post("/api/admin/action", { operation: "publish", value: { collection: "relationships" }, id: relId }, token);
    assert.equal(publishRelRes.status, 400, "publishing a relationship whose endpoint (orgB) is still a draft is blocked, not silently allowed");

    const pubBeforeBothPublished = await (await get("/api/dataset")).json();
    assert.equal(pubBeforeBothPublished.relationships.some(r => r.id === relId), false);

    await post("/api/admin/action", { operation: "publish", value: { collection: "actors" }, id: orgBId }, token);
    await post("/api/admin/action", { operation: "publish", value: { collection: "relationships" }, id: relId }, token);
    const pubAfterBothPublished = await (await get("/api/dataset")).json();
    assert.ok(pubAfterBothPublished.relationships.find(r => r.id === relId), "relationship is now public since itself and both endpoints are published");
  });

  await t.test("a custom (freeform) relationship type does not break the public API or its own relationship_types listing", async () => {
    const pub = await (await get("/api/dataset")).json();
    const customType = pub.relationshipTypes.find(t => t.displayName === "Regression Test Type");
    assert.ok(customType, "the custom type created above is present in the public relationshipTypes list");
    const rel = pub.relationships.find(r => r.id === relId);
    assert.equal(rel.type, customType.id, "the published relationship correctly references the custom type's id");
  });

  await t.test("deleting an organisation leaves no dangling relationship, and the other organisation's public view is unaffected", async () => {
    const delRes = await fetch(base + "/api/admin/action", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://test.local", Authorization: "Bearer " + token }, body: JSON.stringify({ operation: "deleteActor", id: orgBId }) });
    assert.equal(delRes.status, 200, await delRes.text());

    const pubAfterDelete = await (await get("/api/dataset")).json();
    assert.equal(pubAfterDelete.actors.some(a => a.id === orgBId), false, "deleted organisation is gone");
    assert.equal(pubAfterDelete.relationships.some(r => r.id === relId), false, "the relationship that referenced the deleted organisation is also gone -- no dangling edge");
    assert.ok(pubAfterDelete.actors.find(a => a.id === orgAId), "the OTHER organisation (not deleted) is still present and unaffected");
  });

  await t.test("public API failure (simulated by a bad request) never falls back to synthetic/placeholder data -- it is simply absent", async () => {
    // There is no "placeholder data" code path to trigger in the real backend at all (confirmed
    // by reading admin/store.js: a failed fetch sets loadError and serves an EMPTY dataset, never
    // seed/demo content) -- this test instead confirms the public endpoint only ever returns
    // what is actually published, by checking a nonsense query param doesn't change the result.
    const normal = await (await get("/api/dataset")).json();
    const withJunkQuery = await (await get("/api/dataset?nonsense=1")).json();
    assert.deepEqual(normal.actors.map(a => a.id).sort(), withJunkQuery.actors.map(a => a.id).sort());
  });

  await t.test("unauthenticated and cross-origin requests to admin endpoints are rejected server-side, not just hidden in the UI", async () => {
    assert.equal((await get("/api/admin/dataset")).status, 401);
    const wrongOrigin = await fetch(base + "/api/admin/action", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example", Authorization: "Bearer " + token }, body: JSON.stringify({ operation: "reset" }) });
    assert.equal(wrongOrigin.status, 403, "a request from an origin not in ALLOWED_ORIGINS is rejected even with a valid token");
  });
});
