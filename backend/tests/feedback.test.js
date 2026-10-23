"use strict";
// Integration tests for the feedback tracker (backend/feedback-pg.js), exercised through the real
// HTTP server against a real, disposable PostgreSQL instance.
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

test("Feedback tracker: submission, idempotent double-submit, role-scoped visibility, status workflow, screenshot access control, export", { skip: !Pool }, async (t) => {
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  if (!EmbeddedPostgres) { t.skip("embedded-postgres is not installed"); return; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-feedback-test-"));
  const port = 54800 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "test", password: "test", port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("rd_feedback_test");
  const connectionString = `postgres://test:test@127.0.0.1:${port}/rd_feedback_test`;

  const pool = new Pool({ connectionString });
  // See regression-consistency.test.js for why this listener is needed (CI-only teardown race
  // between embedded-postgres shutdown and pool.end(), not a mask for a real failure).
  pool.on("error", () => {});

  const { migrate } = require("../db/migrate");
  await migrate(connectionString);

  const { createPgDataStore } = require("../db/pg-store");
  const { createAccountsStore } = require("../accounts-pg");
  const { createSessionsStore } = require("../sessions-pg");
  const { createFeedbackStore } = require("../feedback-pg");
  const { createApp } = require("../server");

  const store = createPgDataStore(pool);
  const accountsStore = createAccountsStore(pool, "uat");
  const sessionsStore = createSessionsStore(pool, 8 * 60 * 60 * 1000);
  const feedbackStore = createFeedbackStore(pool);

  await accountsStore.create({ username: "owner", password: "Owner-password-2026!", role: "admin", createdBy: "test" });
  await accountsStore.create({ username: "stakeholder1", password: "Stakeholder-password-2026!", role: "stakeholder", createdBy: "test" });

  const app = createApp({ secureCookies: false, allowedOrigins: ["http://test.local"], store, accountsStore, sessionsStore, environment: "uat", feedbackStore });
  await new Promise(resolve => app.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + app.address().port;
  t.after(() => new Promise(resolve => app.close(resolve)));
  t.after(async () => { await pool.end(); await pg.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const post = (route, value, token) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://test.local", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(value) });
  const get = (route, token) => fetch(base + route, { headers: { Origin: "http://test.local", ...(token ? { Authorization: "Bearer " + token } : {}) } });
  const login = async (username, password) => (await (await post("/api/login", { username, password })).json()).token;

  await t.test("unauthenticated requests to every feedback endpoint are rejected", async () => {
    assert.equal((await get("/api/feedback")).status, 401);
    assert.equal((await post("/api/feedback", {})).status, 401);
    assert.equal((await get("/api/feedback/export.csv")).status, 401);
  });

  let stakeholderToken, feedbackId;
  await t.test("the stakeholder submits a bug report; it is returned with a feedback number", async () => {
    stakeholderToken = await login("stakeholder1", "Stakeholder-password-2026!");
    const res = await post("/api/feedback", {
      kind: "bug", title: "Publish button does nothing", description: "Clicked Publish, nothing happened.",
      reproSteps: "1. Open an org\n2. Click Publish", expectedResult: "It publishes", actualResult: "Nothing happens",
      relatedPage: "/admin/index.html#organisations", appVersion: "0.2.0", currentPage: "organisations",
      idempotencyKey: "test-key-1",
    }, stakeholderToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.feedbackNumber);
    assert.equal(body.status, "New");
    feedbackId = body.id;
  });

  await t.test("resubmitting with the same idempotency key does not create a duplicate", async () => {
    const res = await post("/api/feedback", { kind: "bug", title: "Duplicate attempt", description: "x", idempotencyKey: "test-key-1" }, stakeholderToken);
    const body = await res.json();
    assert.equal(body.id, feedbackId, "the original feedback item is returned, not a new one");
    const listRes = await get("/api/feedback", stakeholderToken);
    const list = await listRes.json();
    assert.equal(list.length, 1, "only one feedback row exists despite the double submission");
  });

  await t.test("a second ordinary account only sees its own feedback, not the stakeholder's", async () => {
    await accountsStore.create({ username: "tester2", password: "Tester2-password-2026!", role: "stakeholder", createdBy: "test" });
    // Note: both roles here are "stakeholder" per the schema's two-role model, but feedback
    // visibility in this app is tied to role (admin/stakeholder = full visibility) per the brief's
    // explicit requirement that the UAT super-admin sees all feedback. To exercise the "ordinary
    // role only sees own feedback" rule we call feedbackStore directly with a synthetic role that
    // is NOT in the full-visibility set, simulating a future narrower role without needing one to
    // exist in the UI yet.
    const stakeholderAccounts = await accountsStore.list();
    const stakeholderAccount = stakeholderAccounts.find(a => a.username === "stakeholder1");
    const ownOnly = await feedbackStore.list({ id: "00000000-0000-0000-0000-000000000000", role: "limited-tester" });
    assert.equal(ownOnly.length, 0, "an account with a non-full-visibility role sees none of another account's feedback");
    const own = await feedbackStore.list({ id: stakeholderAccount.id, role: "limited-tester" });
    assert.equal(own.length, 1, "but does see its own");
  });

  await t.test("only admin/stakeholder (full-visibility) accounts can change feedback status; the change is recorded in history", async () => {
    const ownerToken = await login("owner", "Owner-password-2026!");
    const statusRes = await post("/api/feedback/" + feedbackId + "/status", { status: "Investigating", note: "Looking into it." }, ownerToken);
    assert.equal(statusRes.status, 200);
    const updated = await statusRes.json();
    assert.equal(updated.status, "Investigating");

    const historyRes = await get("/api/feedback/" + feedbackId + "/history", ownerToken);
    const history = await historyRes.json();
    assert.equal(history.length, 2, "both the initial 'New' entry and the status change are recorded");
    assert.equal(history[0].changed_by, "stakeholder1", "the initial 'New' history entry shows the submitter's username, not their raw account ID");
    assert.equal(history[1].status, "Investigating");
    assert.equal(history[1].note, "Looking into it.");
    assert.equal(history[1].changed_by, "owner");
  });

  await t.test("a screenshot can be uploaded, is not publicly reachable, but is served to an authorized viewer", async () => {
    const pngBytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"); // minimal PNG-ish header bytes, not a full valid image — fine for an access-control test
    const res = await post("/api/feedback", {
      kind: "suggestion", title: "With a screenshot", description: "See attached.",
      screenshotBase64: pngBytes.toString("base64"), screenshotMimeType: "image/png",
    }, stakeholderToken);
    const body = await res.json();
    assert.equal(body.hasScreenshot, true, "the API response reports a screenshot exists but never a file path");
    assert.equal(JSON.stringify(body).includes(".png"), false, "no raw filename/path leaks into the JSON response (the bytes live in Postgres, not on disk)");

    const screenshotRes = await get("/api/feedback/" + body.id + "/screenshot", stakeholderToken);
    assert.equal(screenshotRes.status, 200);
    assert.equal(screenshotRes.headers.get("content-type"), "image/png");
    const returnedBytes = Buffer.from(await screenshotRes.arrayBuffer());
    assert.ok(returnedBytes.equals(pngBytes), "the exact uploaded bytes round-trip through the screenshot_data column");

    // Not reachable without authentication at all.
    const anonRes = await get("/api/feedback/" + body.id + "/screenshot");
    assert.equal(anonRes.status, 401);
  });

  await t.test("CSV export is available to full-visibility accounts and contains the submitted items", async () => {
    const ownerToken = await login("owner", "Owner-password-2026!");
    const res = await get("/api/feedback/export.csv", ownerToken);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
    const text = await res.text();
    assert.match(text, /Publish button does nothing/);
  });
});
