"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDataStore } = require("../server-data");

function tmpDataPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rd-persist-test-")), "dataset.json");
}
const ORG = { id: "acme-crc", name: "Acme CRC", type: "crc", state: "NSW", summary: "Test CRC.", themes: [], sectors: [], sourceNotes: [], dataConfidence: "needs-review", lastUpdated: "2026-10-03" };
const ORG2 = { id: "acme-partner", name: "Acme Partner", type: "industry_partner", state: "NSW", summary: "Test partner.", themes: [], sectors: [], sourceNotes: [], dataConfidence: "needs-review", lastUpdated: "2026-10-03" };
const REL = { id: "acme-rel-1", sourceId: "acme-crc", targetId: "acme-partner", type: "collaborates_with", confidence: "needs-review", intensity: "medium", evidence: "" };

test("office (map location) data is validated; invalid offices are rejected and valid ones persist through a restart", () => {
  const dataPath = tmpDataPath();
  const s = createDataStore(dataPath);
  const withOffices = { ...ORG, offices: [{ role: "head", state: "VIC", city: "Melbourne", focus: "HQ" }] };
  s.apply("upsertActor", withOffices, undefined, "tester");
  s.apply("publish", { collection: "actors" }, ORG.id, "tester");
  assert.throws(() => s.apply("upsertActor", { ...ORG, offices: [{ role: "boss", state: "VIC" }] }, undefined, "tester"), /Invalid office/);
  assert.throws(() => s.apply("upsertActor", { ...ORG, offices: [{ role: "head", state: "XX" }] }, undefined, "tester"), /Invalid office/);
  const reopened = createDataStore(dataPath);
  assert.deepEqual(reopened.publicData().actors.find(item => item.id === ORG.id).offices, withOffices.offices);
});

test("drafts, published state and relationships survive a restart", () => {
  const dataPath = tmpDataPath();
  const s = createDataStore(dataPath);
  s.apply("upsertActor", ORG, undefined, "tester");
  s.apply("upsertActor", ORG2, undefined, "tester");
  s.apply("publish", { collection: "actors" }, ORG.id, "tester");
  s.apply("upsertRelationship", REL, undefined, "tester");
  s.apply("upsertActor", { ...ORG, summary: "Unpublished edit." }, undefined, "tester");
  const reopened = createDataStore(dataPath);
  const snap = reopened.snapshot();
  assert.equal(snap.actors.find(item => item.id === ORG.id).status, "published");
  assert.equal(snap.actors.find(item => item.id === ORG.id).summary, "Unpublished edit.");
  assert.equal(snap.actors.find(item => item.id === ORG2.id).status, "draft");
  assert.equal(snap.relationships.find(item => item.id === REL.id).status, "draft");
  assert.equal(reopened.publicData().actors.find(item => item.id === ORG.id).summary, ORG.summary, "public copy is still the last published version after restart");
  assert.equal(reopened.publicData().actors.some(item => item.id === ORG2.id), false);
});

test("migrating a legacy dataset.json keeps an untouched backup copy of the original file", () => {
  const dataPath = tmpDataPath();
  const legacy = JSON.stringify({ version: 1, actors: [{ id: "legacy-org", name: "Legacy", type: "university", state: "VIC", summary: "x", themes: [], dataConfidence: "verified" }], projects: [], relationships: [], sources: [], audit: [] });
  fs.writeFileSync(dataPath, legacy);
  createDataStore(dataPath);
  assert.equal(fs.readFileSync(dataPath + ".pre-publish-workflow.bak", "utf8"), legacy);
});
