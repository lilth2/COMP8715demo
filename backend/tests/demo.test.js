"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto, pbkdf2Sync } = require("node:crypto");
const ROOT = path.resolve(__dirname, "../..");
function browser(apiBaseUrl = "", hostname = "lilth2.github.io", options = {}) {
  const password = "Synthetic-test-only-2026!";
  const demoAccount = { enabled: true, username: "admin", salt: "test-salt", iterations: 1000, passwordHash: pbkdf2Sync(password, "test-salt", 1000, 32, "sha256").toString("hex") };
  // Sharing `memory` across two browser() calls simulates two tabs in the same
  // browser profile (e.g. the admin console and the public page) backed by the
  // same localStorage, without them sharing any in-process JS state.
  const memory = options.memory || new Map();
  const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const context = { crypto: webcrypto, TextEncoder, Uint8Array, sessionStorage: storage, localStorage: storage,
    document: { querySelector: () => null }, CustomEvent: class {}, fetch: async () => { throw new Error("Offline test backend"); } };
  context.window = { RD_SITE_CONFIG: { apiBaseUrl, demoAccount }, location: { hostname, pathname: options.pathname || "/COMP8715demo/admin/index.html" }, dispatchEvent: () => {}, addEventListener: () => {} };
  vm.createContext(context);
  const run = filename => vm.runInContext(fs.readFileSync(path.join(ROOT, filename), "utf8"), context);
  run("data.js"); run("admin/auth.js"); run("admin/demo-store.js"); run("admin/store.js");
  return { context, auth: context.window.RD_ADMIN_AUTH, store: context.window.RD_ADMIN_STORE, password, memory };
}

test("Pages demo accepts the preset account, rejects other credentials and logs out", async () => {
  const f = browser();
  assert.equal(f.auth.isDemo(), true);
  assert.equal((await f.auth.session()).authenticated, false);
  await assert.rejects(f.auth.login("admin", "wrong"), /Incorrect/);
  await assert.rejects(f.auth.login("someone-else", f.password), /Incorrect/);
  await f.auth.login("admin", f.password);
  assert.equal((await f.auth.session()).authenticated, true);
  await f.auth.logout();
  assert.equal((await f.auth.session()).authenticated, false);
});

test("demo changes persist only in browser storage and require a demo session", async () => {
  const f = browser();
  await f.store.ready;
  const actor = { id: "demo-test", name: "Demo Test", type: "research_institute", summary: "Synthetic test", state: "NSW", themes: [], dataConfidence: "needs-review" };
  await assert.rejects(f.store.upsertActor(actor), /sign in/);
  await f.auth.login("admin", f.password);
  await f.store.upsertActor(actor);
  assert.equal(f.store.findActor(actor.id).name, actor.name);
  const saved = JSON.parse(f.memory.get("rd-directory-demo-data-v1"));
  assert.equal(saved.actors.some(item => item.id === actor.id), true);
  assert.equal(saved.audit[0].actor, "admin");
  await f.store.deleteActor(actor.id);
  assert.equal(f.store.findActor(actor.id), null);
});

test("an expired demo session cannot save changes", async () => {
  const f = browser();
  await f.auth.login("admin", f.password);
  f.memory.set("rd-admin-demo-session-v1", JSON.stringify({ username: "admin", expiresAt: 1 }));
  assert.equal((await f.auth.session()).authenticated, false);
  await assert.rejects(f.store.reset(), /sign in/);
});

test("configured backend takes precedence and never falls back to demo login", async () => {
  const f = browser("https://real-backend.example");
  assert.equal(f.auth.isDemo(), false);
  assert.equal(f.context.window.RD_DEMO_STORE, undefined);
  await assert.rejects(f.auth.login("admin", f.password), /Unable to reach/);
  assert.equal((await f.auth.session().catch(() => ({ authenticated: false }))).authenticated, false);
  assert.equal(browser("", "127.0.0.1").auth.isDemo(), false);
});

test("demo mode: a new record is a draft, invisible on the public page sharing the same browser storage, until published", async () => {
  const memory = new Map();
  const admin = browser("", "lilth2.github.io", { memory, pathname: "/COMP8715demo/admin/index.html" });
  await admin.store.ready;
  await admin.auth.login("admin", admin.password);
  const actor = { id: "demo-draft-test", name: "Demo Draft Test", type: "research_institute", summary: "Synthetic draft.", state: "NSW", themes: [], dataConfidence: "needs-review" };
  await admin.store.upsertActor(actor);
  assert.equal(admin.store.findActor(actor.id).status, "draft");

  // The public (non-admin) page, in the same browser, reads the same localStorage key
  // but must only ever see published records — never drafts.
  const publicPage = browser("", "lilth2.github.io", { memory, pathname: "/COMP8715demo/index.html" });
  await publicPage.store.ready;
  assert.equal(publicPage.store.snapshot().actors.some(item => item.id === actor.id), false, "a draft must not reach the public page even though it is in the same browser's localStorage");

  await admin.store.publish("actors", actor.id);
  const publicAfterPublish = browser("", "lilth2.github.io", { memory, pathname: "/COMP8715demo/index.html" });
  await publicAfterPublish.store.ready;
  assert.equal(publicAfterPublish.store.snapshot().actors.some(item => item.id === actor.id), true, "once published, the public page (reloaded) must see the record");

  await admin.store.withdraw("actors", actor.id);
  const publicAfterWithdraw = browser("", "lilth2.github.io", { memory, pathname: "/COMP8715demo/index.html" });
  await publicAfterWithdraw.store.ready;
  assert.equal(publicAfterWithdraw.store.snapshot().actors.some(item => item.id === actor.id), false, "withdrawing must remove it from the public page again");
});

test("demo mode: seed records show no pending changes and the public data carries no draft bookkeeping", async () => {
  const admin = browser("", "lilth2.github.io", { pathname: "/COMP8715demo/admin/index.html" });
  await admin.store.ready;
  const strip = r => { const c = JSON.parse(JSON.stringify(r)); delete c.status; delete c.publishedSnapshot; return c; };
  for (const key of ["actors", "projects", "themes", "relationships"]) {
    for (const record of admin.store.snapshot()[key]) {
      assert.equal(record.status, "published");
      assert.equal(JSON.stringify(strip(record)), JSON.stringify(record.publishedSnapshot), key + "/" + record.id + " would wrongly show 'unpublished changes'");
    }
  }
  const publicPage = browser("", "lilth2.github.io", { pathname: "/COMP8715demo/index.html" });
  await publicPage.store.ready;
  const publicState = publicPage.store.snapshot();
  for (const key of ["actors", "projects", "themes", "relationships"]) {
    for (const record of publicState[key]) assert.equal("status" in record || "publishedSnapshot" in record, false, key + "/" + record.id + " leaks bookkeeping to the public page");
  }
});

test("demo mode: browser data saved by the first release (snapshot containing status) is healed on load", async () => {
  const memory = new Map();
  const first = browser("", "lilth2.github.io", { memory });
  await first.store.ready;
  await first.auth.login("admin", first.password);
  await first.store.upsertActor({ id: "heal-test", name: "Heal Test", type: "university", summary: "x", state: "NSW", themes: [], dataConfidence: "needs-review" });
  const saved = JSON.parse(memory.get("rd-directory-demo-data-v1"));
  saved.actors.forEach(a => { if (a.publishedSnapshot) a.publishedSnapshot.status = "published"; });
  memory.set("rd-directory-demo-data-v1", JSON.stringify(saved));
  const reopened = browser("", "lilth2.github.io", { memory });
  await reopened.store.ready;
  const actor = reopened.store.snapshot().actors.find(a => a.publishedSnapshot);
  assert.equal("status" in actor.publishedSnapshot, false);
});

test("demo mode: research themes are manageable through the same store, and relationships only publish once both ends are published", async () => {
  const f = browser();
  await f.store.ready;
  await f.auth.login("admin", f.password);
  const orgA = { id: "demo-rel-a", name: "Demo Org A", type: "university", summary: "A", state: "NSW", themes: [], dataConfidence: "needs-review" };
  const orgB = { id: "demo-rel-b", name: "Demo Org B", type: "university", summary: "B", state: "NSW", themes: [], dataConfidence: "needs-review" };
  await f.store.upsertActor(orgA);
  await f.store.upsertActor(orgB);
  await f.store.upsertTheme({ id: "demo-theme", name: "Demo Theme", type: "research_theme", summary: "A synthetic theme.", dataConfidence: "needs-review" });
  assert.equal(f.store.findTheme("demo-theme").status, "draft");

  await f.store.upsertRelationship({ id: "demo-rel-1", sourceId: orgA.id, targetId: orgB.id, type: "collaborates_with", confidence: "needs-review", intensity: "medium", evidence: "" });
  await assert.rejects(f.store.publish("relationships", "demo-rel-1"), /not published yet/);
  await f.store.publish("actors", orgA.id);
  await assert.rejects(f.store.publish("relationships", "demo-rel-1"), /not published yet/);
  await f.store.publish("actors", orgB.id);
  await f.store.publish("relationships", "demo-rel-1");
  assert.equal(f.store.snapshot().relationships.find(item => item.id === "demo-rel-1").status, "published");
});
