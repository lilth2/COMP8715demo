"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes, scryptSync } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");

async function fixture(t, options = {}) {
  const salt = randomBytes(32).toString("hex");
  const password = "Test-password-only-2026!";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-auth-test-"));
  const dataPath = path.join(directory, "dataset.json");
  const server = createApp({ account: { username: "admin", salt, passwordHash: scryptSync(password, salt, 64).toString("hex") }, dataPath, allowedOrigins: ["https://lilth2.github.io"], ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const post = (route, value, token, origin = base) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(value) });
  const login = async () => {
    const response = await post("/api/login", { username: "admin", password });
    assert.equal(response.status, 200);
    return { response, ...await response.json() };
  };
  return { base, post, login, dataPath, password };
}

test("anonymous access is blocked and private files are never served", async t => {
  const f = await fixture(t);
  const response = await fetch(f.base + "/admin/index.html", { redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/admin/login.html");
  assert.equal((await fetch(f.base + "/admin/console.js")).status, 401);
  assert.equal((await fetch(f.base + "/api/admin/dataset")).status, 401);
  assert.equal((await f.post("/api/admin/action", { operation: "reset" })).status, 401);
  for (const operation of ["upsertActor", "upsertRelationship", "upsertTheme", "publish", "withdraw", "setLayout", "deleteTheme", "deleteActor"]) {
    assert.equal((await f.post("/api/admin/action", { operation, value: { collection: "actors" }, id: "hilt-crc" })).status, 401, operation + " must require login");
  }
  const publicBody = JSON.stringify(await (await fetch(f.base + "/api/dataset")).json());
  assert.equal(publicBody.includes("publishedSnapshot"), false, "public API must not leak draft bookkeeping");
  for (const filename of ["backend/.private/admin-account.json", "backend/server.js", "backend/setup-admin.js", "README.md", ".git/config"]) assert.equal((await fetch(f.base + "/" + filename)).status, 404);
  assert.equal((await f.post("/api/register", {})).status, 404);
});

test("only the preset credentials work, with session revocation on logout", async t => {
  const f = await fixture(t);
  assert.equal((await f.post("/api/login", { username: "admin", password: "wrong-password" })).status, 401);
  assert.equal((await f.post("/api/login", { username: "another-user", password: f.password })).status, 401);
  const login = await f.login();
  const cookie = login.response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const headers = { Authorization: "Bearer " + login.token };
  assert.equal((await (await fetch(f.base + "/api/session", { headers })).json()).authenticated, true);
  assert.equal((await fetch(f.base + "/admin/index.html", { headers })).status, 200);
  assert.equal((await f.post("/api/logout", {}, login.token)).status, 200);
  assert.equal((await fetch(f.base + "/api/admin/dataset", { headers })).status, 401);
  const forged = await fetch(f.base + "/api/admin/dataset", { headers: { Authorization: "Bearer forged-session" } });
  assert.equal(forged.status, 401);
});

test("GitHub Pages origin can authenticate; unexpected origins cannot", async t => {
  const f = await fixture(t, { secureCookies: true });
  const preflight = await fetch(f.base + "/api/login", { method: "OPTIONS", headers: { Origin: "https://lilth2.github.io" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://lilth2.github.io");
  const response = await f.post("/api/login", { username: "admin", password: f.password }, undefined, "https://lilth2.github.io");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Secure/);
  assert.equal((await f.post("/api/login", {}, undefined, "https://untrusted.example")).status, 403);
});

test("authenticated edits persist as drafts; public responses omit drafts and administrator audit details", async t => {
  const f = await fixture(t);
  const login = await f.login();
  const actor = { id: "test-research", name: "Test Research", type: "research_institute", state: "NSW", summary: "Test record.", themes: [], sectors: [], sourceNotes: [], dataConfidence: "needs-review", lastUpdated: "2026-10-03" };
  const response = await f.post("/api/admin/action", { operation: "upsertActor", value: actor }, login.token);
  assert.equal(response.status, 200);
  const afterCreate = await response.json();
  assert.equal(afterCreate.audit[0].actor, "admin");
  assert.equal(afterCreate.actors.find(item => item.id === actor.id).status, "draft");
  assert.equal(JSON.parse(fs.readFileSync(f.dataPath, "utf8")).actors.some(item => item.id === actor.id), true);
  const reopened = require("../server-data").createDataStore(f.dataPath);
  assert.equal(reopened.snapshot().actors.some(item => item.id === actor.id), true);

  // A brand-new record is a draft: invisible on the public API until published.
  const beforePublish = await (await fetch(f.base + "/api/dataset")).json();
  assert.equal(beforePublish.actors.some(item => item.id === actor.id), false);

  const publishResponse = await f.post("/api/admin/action", { operation: "publish", value: { collection: "actors" }, id: actor.id }, login.token);
  assert.equal(publishResponse.status, 200);
  assert.equal((await publishResponse.json()).actors.find(item => item.id === actor.id).status, "published");
  const publicData = await (await fetch(f.base + "/api/dataset")).json();
  assert.equal(publicData.actors.some(item => item.id === actor.id), true);
  assert.equal(publicData.audit, undefined);

  // Editing a published record (saving a draft) must not change the public copy.
  await f.post("/api/admin/action", { operation: "upsertActor", value: { ...actor, name: "Edited Name Pending Review" } }, login.token);
  const stillOldPublicName = await (await fetch(f.base + "/api/dataset")).json();
  assert.equal(stillOldPublicName.actors.find(item => item.id === actor.id).name, "Test Research");
  await f.post("/api/admin/action", { operation: "publish", value: { collection: "actors" }, id: actor.id }, login.token);
  const updatedPublicName = await (await fetch(f.base + "/api/dataset")).json();
  assert.equal(updatedPublicName.actors.find(item => item.id === actor.id).name, "Edited Name Pending Review");

  // Withdraw takes it back to draft and off the public API; restore-then-publish brings it back.
  await f.post("/api/admin/action", { operation: "withdraw", value: { collection: "actors" }, id: actor.id }, login.token);
  const afterWithdraw = await (await fetch(f.base + "/api/dataset")).json();
  assert.equal(afterWithdraw.actors.some(item => item.id === actor.id), false);

  assert.equal((await f.post("/api/admin/action", { operation: "upsertActor", value: { ...actor, type: "invalid" } }, login.token)).status, 400);
  assert.equal((await f.post("/api/admin/action", { operation: "importState", value: {} }, login.token)).status, 400);
  assert.equal((await f.post("/api/admin/action", { operation: "__proto__" }, login.token)).status, 400);
  assert.equal((await f.post("/api/admin/action", null, login.token)).status, 400);
  assert.equal((await f.post("/api/admin/action", { operation: "deleteActor", id: actor.id }, login.token)).status, 200);
});

test("password guessing is rate limited", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.post("/api/login", { username: "admin", password: "wrong" })).status, 401);
  assert.equal((await f.post("/api/login", { username: "admin", password: f.password })).status, 429);
});

test("old administrator URLs and navigation resolve after directory reorganisation", async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + "/admin-login.html", { redirect: "manual" })).headers.get("location"), "/admin/login.html");
  assert.equal((await fetch(f.base + "/admin.html", { redirect: "manual" })).headers.get("location"), "/admin/index.html");
  assert.match(await (await fetch(f.base + "/")).text(), /href="admin\/login\.html"/);
  for (const asset of ["admin/login.html", "admin/login.js", "admin/auth.js", "admin/store.js", "admin/demo-store.js"]) assert.equal((await fetch(f.base + "/" + asset)).status, 200);
  const login = await f.login();
  const cookie = login.response.headers.get("set-cookie").split(";")[0];
  const redirect = await fetch(f.base + "/admin/login.html", { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(redirect.headers.get("location"), "/admin/index.html");
});
