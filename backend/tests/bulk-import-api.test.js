"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes, scryptSync } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");
const { makeXlsx } = require("./helpers/make-xlsx");

async function fixture(t) {
  const salt = randomBytes(32).toString("hex");
  const password = "Test-password-only-2026!";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-bulk-api-test-"));
  const dataPath = path.join(directory, "dataset.json");
  const server = createApp({ account: { username: "admin", salt, passwordHash: scryptSync(password, salt, 64).toString("hex") }, dataPath, allowedOrigins: ["https://lilth2.github.io"] });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const post = (route, value, token) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify(value) });
  const login = async () => (await (await post("/api/login", { username: "admin", password })).json()).token;
  return { base, post, login };
}

test("bulk import endpoints require admin login", async t => {
  const f = await fixture(t);
  assert.equal((await f.post("/api/admin/import/inspect", {})).status, 401);
  assert.equal((await f.post("/api/admin/import/preview", {})).status, 401);
  assert.equal((await f.post("/api/admin/import/commit", {})).status, 401);
});

test("direct-rows bulk import: preview then commit creates drafts, visible to admin but not the public API", async t => {
  const f = await fixture(t);
  const token = await f.login();
  const rows = [{ id: "api-test-org-1", name: "API Test Org", type: "university", summary: "x", sourceRow: 2 }];

  const previewRes = await f.post("/api/admin/import/preview", { collection: "actors", mode: "add-only", rows }, token);
  assert.equal(previewRes.status, 200);
  const previewBody = await previewRes.json();
  assert.equal(previewBody.plan.counts.created, 1);
  assert.equal(previewBody.plan.canCommit, true);

  const commitRes = await f.post("/api/admin/import/commit", { collection: "actors", mode: "add-only", rows }, token);
  assert.equal(commitRes.status, 200);
  const afterCommit = await commitRes.json();
  const created = afterCommit.actors.find(a => a.id === "api-test-org-1");
  assert.ok(created);
  assert.equal(created.status, "draft");

  const publicRes = await fetch(f.base + "/api/dataset");
  const publicData = await publicRes.json();
  assert.equal(publicData.actors.some(a => a.id === "api-test-org-1"), false, "a freshly bulk-imported draft must not appear on the public API");
});

test("file upload import: inspect returns sheet names and a header preview, preview+commit round-trips through field mapping", async t => {
  const f = await fixture(t);
  const token = await f.login();
  const xlsxBuf = makeXlsx({
    "Orgs": [
      ["Name", "Type", "Summary"],
      ["Uploaded Org One", "university", "First uploaded row."],
      ["Uploaded Org Two", "crc", "Second uploaded row."],
    ],
  });
  const contentBase64 = xlsxBuf.toString("base64");

  const inspectRes = await f.post("/api/admin/import/inspect", { filename: "orgs.xlsx", contentBase64 }, token);
  assert.equal(inspectRes.status, 200);
  const inspectBody = await inspectRes.json();
  assert.deepEqual(inspectBody.sheets, ["Orgs"]);
  assert.equal(inspectBody.headers.A, "Name");
  assert.equal(inspectBody.headers.B, "Type");

  const fieldMapping = { name: "A", type: "B", summary: "C" };
  const previewRes = await f.post("/api/admin/import/preview", { collection: "actors", mode: "add-only", filename: "orgs.xlsx", contentBase64, sheetName: "Orgs", headerRow: 1, fieldMapping }, token);
  assert.equal(previewRes.status, 200);
  const previewBody = await previewRes.json();
  assert.equal(previewBody.plan.counts.created, 2, JSON.stringify(previewBody.plan.rows));
  assert.equal(previewBody.previouslyImported, null, "this exact file has not been imported before");

  const commitRes = await f.post("/api/admin/import/commit", { collection: "actors", mode: "add-only", filename: "orgs.xlsx", contentBase64, sheetName: "Orgs", headerRow: 1, fieldMapping }, token);
  assert.equal(commitRes.status, 200);
  const afterCommit = await commitRes.json();
  assert.ok(afterCommit.actors.some(a => a.name === "Uploaded Org One"));
  assert.ok(afterCommit.actors.some(a => a.name === "Uploaded Org Two"));
  assert.equal(afterCommit.importBatches.length, 1, "the file import is recorded as a batch with provenance");
  assert.equal(afterCommit.importBatches[0].sourceFilename, "orgs.xlsx");
  assert.equal(afterCommit.importBatches[0].sheetName, "Orgs");
});

test("re-uploading the identical file is detected and the commit is refused, so duplicate records are not silently created", async t => {
  const f = await fixture(t);
  const token = await f.login();
  const xlsxBuf = makeXlsx({ "Orgs": [["Name", "Type", "Summary"], ["Resubmit Org", "university", "A summary."]] });
  const contentBase64 = xlsxBuf.toString("base64");
  const payload = { collection: "actors", mode: "add-only", filename: "orgs.xlsx", contentBase64, sheetName: "Orgs", headerRow: 1, fieldMapping: { name: "A", type: "B", summary: "C" } };

  const firstCommit = await f.post("/api/admin/import/commit", payload, token);
  assert.equal(firstCommit.status, 200);

  const secondPreview = await f.post("/api/admin/import/preview", payload, token);
  const secondPreviewBody = await secondPreview.json();
  assert.ok(secondPreviewBody.previouslyImported, "the preview flags this exact file/sheet/mode as already imported");

  const secondCommit = await f.post("/api/admin/import/commit", payload, token);
  assert.equal(secondCommit.status, 400);
  const secondCommitBody = await secondCommit.json();
  assert.match(secondCommitBody.message, /already imported/);
});

test("a bulk import with a row error is rejected entirely (no partial commit) and reports the specific row", async t => {
  const f = await fixture(t);
  const token = await f.login();
  const rows = [
    { id: "good-row-org", name: "Good Row", type: "university", summary: "x", sourceRow: 2 },
    { name: "", type: "university", sourceRow: 3 }, // missing name
  ];
  const commitRes = await f.post("/api/admin/import/commit", { collection: "actors", mode: "add-only", rows }, token);
  assert.equal(commitRes.status, 400);
  const body = await commitRes.json();
  assert.equal(body.plan.rows[1].sourceRow, 3);

  const datasetRes = await fetch(f.base + "/api/admin/dataset", { headers: { Authorization: "Bearer " + token } });
  const dataset = await datasetRes.json();
  assert.equal(dataset.actors.some(a => a.id === "good-row-org"), false, "no row committed from a batch that had an error, including the otherwise-valid one");
});
