"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto, pbkdf2Sync } = require("node:crypto");
const ROOT = path.resolve(__dirname, "../..");
function browser(apiBaseUrl = "", hostname = "lilth2.github.io") {
  const password = "Synthetic-test-only-2026!";
  const demoAccount = { enabled: true, username: "admin", salt: "test-salt", iterations: 1000, passwordHash: pbkdf2Sync(password, "test-salt", 1000, 32, "sha256").toString("hex") };
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const context = { crypto: webcrypto, TextEncoder, Uint8Array, sessionStorage: storage, localStorage: storage,
    document: { querySelector: () => null }, CustomEvent: class {}, fetch: async () => { throw new Error("Offline test backend"); } };
  context.window = { RD_SITE_CONFIG: { apiBaseUrl, demoAccount }, location: { hostname, pathname: "/COMP8715demo/admin/index.html" }, dispatchEvent: () => {}, addEventListener: () => {} };
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
