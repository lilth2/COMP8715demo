"use strict";
// Regression test for a real production incident: a UAT deployment (Render + Neon) came up with
// /api/health reporting "database: connected" (it only runs SELECT 1, which proves the TCP/auth
// connection works) while /api/dataset returned an unlogged 500, because the schema migration had
// never actually been run against that database. createApp()-level tests exercise backend/server.js
// as a function, which never reproduces this — the bug is specifically in what happens when
// `node backend/server.js` boots as its own process (exactly how Render starts it) against a
// database whose tables don't exist yet. This test spawns the real entrypoint as a child process,
// the same way `npm start`/Render does, to cover that exact path.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

let Pool;
try { ({ Pool } = require("pg")); } catch { /* skip below if missing */ }
async function loadEmbeddedPostgres() {
  try { return (await import("embedded-postgres")).default; } catch { return null; }
}

test("server.js auto-migrates a reachable-but-unmigrated database on boot, so /api/dataset works, not just /api/health", { skip: !Pool }, async (t) => {
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  if (!EmbeddedPostgres) { t.skip("embedded-postgres is not installed"); return; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-boot-migration-test-"));
  const port = 55400 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "test", password: "test", port, persistent: false });
  await pg.initialise();
  await pg.start();
  const dbName = "rd_boot_migration_test";
  await pg.createDatabase(dbName); // a brand-new, empty database -- deliberately NOT migrated before boot
  const connectionString = `postgres://test:test@127.0.0.1:${port}/${dbName}`;

  const serverPort = 56400 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      APP_ENVIRONMENT: "uat",
      PORT: String(serverPort),
      HOST: "127.0.0.1",
      ALLOWED_ORIGINS: "http://test.local",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    child.kill();
    await pg.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // Poll /api/health until the process is actually listening (it migrates before it starts
  // listening, so a successful health check already implies the migration ran).
  const base = "http://127.0.0.1:" + serverPort;
  const deadline = Date.now() + 15000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + "/api/health");
      if (res.ok) break;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const healthRes = await fetch(base + "/api/health").catch(error => { throw new Error("Server never became reachable: " + (lastError || error)); });
  assert.equal(healthRes.status, 200);
  const health = await healthRes.json();
  assert.equal(health.database, "connected");

  // This is the actual regression: before the fix, this returned 500 with no server-side log line
  // at all, despite /api/health reporting success immediately above.
  const datasetRes = await fetch(base + "/api/dataset");
  assert.equal(datasetRes.status, 200, "GET /api/dataset must succeed once the server has booted against this database, not 500 with the schema missing");
  const dataset = await datasetRes.json();
  assert.deepEqual(dataset.actors, [], "a freshly migrated database with nothing imported yet returns real empty data, not an error");
  assert.equal(dataset.environment, "uat");
  assert.match(stdout, /Migration complete/, "the auto-migration on boot actually ran and said so, not just happened to work");
});
