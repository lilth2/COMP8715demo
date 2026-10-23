"use strict";
// Integration tests for the multi-account / Postgres-backed auth mode: backend/accounts-pg.js,
// backend/sessions-pg.js, and backend/server.js's multiAccount branch, all exercised through the
// real HTTP server (createApp) against a real, disposable PostgreSQL instance — not mocks.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let Pool;
try { ({ Pool } = require("pg")); } catch { /* pg is a runtime dependency; if missing, skip below */ }
async function loadEmbeddedPostgres() {
  try { return (await import("embedded-postgres")).default; } catch { return null; }
}

test("Multi-account auth: admin/stakeholder roles, account management, disable/session-revocation, and environment isolation", { skip: !Pool }, async (t) => {
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  if (!EmbeddedPostgres) { t.skip("embedded-postgres is not installed"); return; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-accounts-test-"));
  const port = 54600 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "test", password: "test", port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("rd_accounts_test");
  const connectionString = `postgres://test:test@127.0.0.1:${port}/rd_accounts_test`;

  const pool = new Pool({ connectionString });

  const { migrate } = require("../db/migrate");
  await migrate(connectionString);

  const { createPgDataStore } = require("../db/pg-store");
  const { createAccountsStore } = require("../accounts-pg");
  const { createSessionsStore } = require("../sessions-pg");
  const { createApp } = require("../server");

  const store = createPgDataStore(pool);
  const uatAccounts = createAccountsStore(pool, "uat");
  const uatSessions = createSessionsStore(pool, 8 * 60 * 60 * 1000);
  const prodAccounts = createAccountsStore(pool, "production");
  const prodSessions = createSessionsStore(pool, 8 * 60 * 60 * 1000);

  await uatAccounts.create({ username: "owner", password: "Owner-password-2026!", role: "admin", createdBy: "test" });
  await uatAccounts.create({ username: "stakeholder1", password: "Stakeholder-password-2026!", role: "stakeholder", createdBy: "test" });

  const uatApp = createApp({ secureCookies: false, allowedOrigins: ["http://test.local"], store, accountsStore: uatAccounts, sessionsStore: uatSessions, environment: "uat" });
  await new Promise(resolve => uatApp.listen(0, "127.0.0.1", resolve));
  const uatBase = "http://127.0.0.1:" + uatApp.address().port;
  // node:test runs `after` hooks in registration order, so HTTP servers (which hold the pool via
  // store/accountsStore) must be closed strictly before the pool itself, which must be ended
  // before the Postgres process underneath it is stopped.
  t.after(() => new Promise(resolve => uatApp.close(resolve)));
  t.after(async () => { await pool.end(); await pg.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const post = (base, route, value, token) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://test.local", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(value) });
  const get = (base, route, token) => fetch(base + route, { headers: { Origin: "http://test.local", ...(token ? { Authorization: "Bearer " + token } : {}) } });

  await t.test("a stakeholder account logs in and gets role=stakeholder, environment=uat in the session", async () => {
    const res = await post(uatBase, "/api/login", { username: "stakeholder1", password: "Stakeholder-password-2026!" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.role, "stakeholder");
    assert.equal(body.environment, "uat");
    assert.ok(body.token);
  });

  await t.test("a stakeholder has full admin-equivalent capability: can bulk-import, publish, and manage other accounts server-side", async () => {
    const loginRes = await post(uatBase, "/api/login", { username: "stakeholder1", password: "Stakeholder-password-2026!" });
    const token = (await loginRes.json()).token;

    const importRes = await post(uatBase, "/api/admin/import/commit", { collection: "actors", mode: "add-only", rows: [{ id: "stakeholder-created-org", name: "Stakeholder Created Org", type: "university", summary: "x", sourceRow: 2 }] }, token);
    assert.equal(importRes.status, 200, await importRes.text());

    const publishRes = await post(uatBase, "/api/admin/action", { operation: "publish", value: { collection: "actors" }, id: "stakeholder-created-org" }, token);
    assert.equal(publishRes.status, 200, await publishRes.text());

    const accountsRes = await get(uatBase, "/api/admin/accounts", token);
    assert.equal(accountsRes.status, 200);
    const accounts = await accountsRes.json();
    assert.ok(accounts.some(a => a.username === "owner"), "a stakeholder can see other accounts in the same UAT environment");

    const createRes = await post(uatBase, "/api/admin/accounts", { username: "secondtester", password: "Second-tester-pw-2026!", role: "stakeholder" }, token);
    assert.equal(createRes.status, 200, await createRes.text());
  });

  await t.test("disabling an account immediately revokes its existing sessions, not just future logins", async () => {
    const loginRes = await post(uatBase, "/api/login", { username: "secondtester", password: "Second-tester-pw-2026!" });
    const token = (await loginRes.json()).token;
    assert.equal((await get(uatBase, "/api/admin/accounts", token)).status, 200, "the session works before disabling");

    const ownerLoginRes = await post(uatBase, "/api/login", { username: "owner", password: "Owner-password-2026!" });
    const ownerToken = (await ownerLoginRes.json()).token;
    const accounts = await (await get(uatBase, "/api/admin/accounts", ownerToken)).json();
    const secondTesterId = accounts.find(a => a.username === "secondtester").id;
    const disableRes = await post(uatBase, "/api/admin/accounts/" + secondTesterId + "/disable", {}, ownerToken);
    assert.equal(disableRes.status, 200);

    const afterDisable = await get(uatBase, "/api/admin/accounts", token);
    assert.equal(afterDisable.status, 401, "the already-issued session token must stop working immediately after disable, not just block future logins");

    const reloginRes = await post(uatBase, "/api/login", { username: "secondtester", password: "Second-tester-pw-2026!" });
    assert.equal(reloginRes.status, 401, "a disabled account cannot log in again either");
  });

  await t.test("changing a password revokes existing sessions for that account", async () => {
    const loginRes = await post(uatBase, "/api/login", { username: "owner", password: "Owner-password-2026!" });
    const token = (await loginRes.json()).token;
    assert.equal((await get(uatBase, "/api/admin/accounts", token)).status, 200);

    const accounts = await (await get(uatBase, "/api/admin/accounts", token)).json();
    const ownerId = accounts.find(a => a.username === "owner").id;
    const setPwRes = await post(uatBase, "/api/admin/accounts/" + ownerId + "/set-password", { password: "New-owner-password-2026!" }, token);
    assert.equal(setPwRes.status, 200);

    assert.equal((await get(uatBase, "/api/admin/accounts", token)).status, 401, "the old session token stops working after a password change");
    const reloginOld = await post(uatBase, "/api/login", { username: "owner", password: "Owner-password-2026!" });
    assert.equal(reloginOld.status, 401, "the old password no longer works");
    const reloginNew = await post(uatBase, "/api/login", { username: "owner", password: "New-owner-password-2026!" });
    assert.equal(reloginNew.status, 200, "the new password works");
  });

  await t.test("every /api/admin/* and /api/admin/accounts/* endpoint rejects an unauthenticated request", async () => {
    assert.equal((await get(uatBase, "/api/admin/accounts")).status, 401);
    assert.equal((await get(uatBase, "/api/admin/dataset")).status, 401);
    assert.equal((await post(uatBase, "/api/admin/action", { operation: "reset" })).status, 401);
    assert.equal((await post(uatBase, "/api/admin/import/commit", { collection: "actors", mode: "add-only", rows: [] })).status, 401);
  });

  await t.test("a UAT account cannot authenticate against a production-environment server process (environment isolation)", async () => {
    await prodAccounts.create({ username: "prod-admin", password: "Prod-admin-password-2026!", role: "admin", createdBy: "test" });
    const prodApp = createApp({ secureCookies: false, allowedOrigins: ["http://test.local"], store, accountsStore: prodAccounts, sessionsStore: prodSessions, environment: "production" });
    await new Promise(resolve => prodApp.listen(0, "127.0.0.1", resolve));
    const prodBase = "http://127.0.0.1:" + prodApp.address().port;
    try {
      // The UAT stakeholder's credentials simply do not exist as a row in the production
      // environment's query (createAccountsStore(pool, "production") only ever selects
      // WHERE environment = 'production') — this is what "cannot access production" means
      // concretely: there is no row to authenticate against, regardless of role.
      const crossRes = await post(prodBase, "/api/login", { username: "stakeholder1", password: "Stakeholder-password-2026!" });
      assert.equal(crossRes.status, 401, "UAT credentials must not authenticate against a production-environment server");

      const prodLoginRes = await post(prodBase, "/api/login", { username: "prod-admin", password: "Prod-admin-password-2026!" });
      assert.equal(prodLoginRes.status, 200);
      const prodBody = await prodLoginRes.json();
      assert.equal(prodBody.environment, "production");
    } finally {
      await new Promise(resolve => prodApp.close(resolve));
    }
  });
});
