"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDataStore } = require("../server-data");

function store(dataPath) {
  return createDataStore(dataPath);
}

function tmpDataPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-publish-test-"));
  return path.join(directory, "dataset.json");
}

const ORG = { id: "acme-crc", name: "Acme CRC", type: "crc", state: "NSW", summary: "Test CRC.", themes: [], sectors: [], sourceNotes: [], dataConfidence: "needs-review", lastUpdated: "2026-10-03" };
const ORG2 = { id: "acme-partner", name: "Acme Partner", type: "industry_partner", state: "NSW", summary: "Test partner.", themes: [], sectors: [], sourceNotes: [], dataConfidence: "needs-review", lastUpdated: "2026-10-03" };
const REL = { id: "acme-rel-1", sourceId: "acme-crc", targetId: "acme-partner", type: "collaborates_with", confidence: "needs-review", intensity: "medium", evidence: "" };
const THEME = { id: "acme-theme", name: "Acme Theme", type: "research_theme", summary: "Test theme.", dataConfidence: "needs-review", lastUpdated: "2026-10-03" };

test("existing seed data migrates in as already published (no data loss)", () => {
  const s = store(undefined);
  const snapshot = s.snapshot();
  assert.ok(snapshot.actors.length > 0);
  assert.ok(snapshot.themes.length > 0, "themes collection must be seeded from the static theme nodes");
  assert.ok(snapshot.actors.every(item => item.status === "published"));
  assert.ok(snapshot.themes.every(item => item.status === "published"));
  assert.ok(snapshot.relationships.every(item => item.status === "published"));
  const pub = s.publicData();
  assert.equal(pub.actors.length, snapshot.actors.length);
  assert.equal(pub.themes.length, snapshot.themes.length);
  assert.equal(pub.relationships.length, snapshot.relationships.length);
});

test("a pre-existing dataset.json saved before the publish workflow existed is migrated, not wiped", () => {
  const dataPath = tmpDataPath();
  const legacyActor = { id: "legacy-org", name: "Legacy Org", type: "university", state: "VIC", summary: "Pre-existing live record.", themes: [], sectors: [], sourceNotes: [], dataConfidence: "verified", lastUpdated: "2025-01-01" };
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify({ version: 1, actors: [legacyActor], projects: [], relationships: [], sources: [], audit: [] }));
  const s = store(dataPath);
  const pub = s.publicData();
  assert.equal(pub.actors.some(item => item.id === "legacy-org"), true, "a legacy record with no status field must remain publicly visible after migration");
  assert.equal(s.snapshot().actors.find(item => item.id === "legacy-org").status, "published");
});

test("new records are drafts: invisible publicly, editable, deletable, until published", () => {
  const s = store(undefined);
  s.apply("upsertActor", ORG, undefined, "tester");
  assert.equal(s.snapshot().actors.find(item => item.id === ORG.id).status, "draft");
  assert.equal(s.publicData().actors.some(item => item.id === ORG.id), false);

  s.apply("upsertActor", { ...ORG, summary: "Edited while still a draft." }, undefined, "tester");
  assert.equal(s.snapshot().actors.find(item => item.id === ORG.id).summary, "Edited while still a draft.");
  assert.equal(s.publicData().actors.some(item => item.id === ORG.id), false);

  s.apply("deleteActor", undefined, ORG.id, "tester");
  assert.equal(s.snapshot().actors.some(item => item.id === ORG.id), false);
});

test("relationships can only publish once both endpoints are published; publishing is otherwise blocked with a clear error", () => {
  const s = store(undefined);
  s.apply("upsertActor", ORG, undefined, "tester");
  s.apply("upsertActor", ORG2, undefined, "tester");
  s.apply("upsertRelationship", REL, undefined, "tester");

  assert.throws(() => s.apply("publish", { collection: "relationships" }, REL.id, "tester"), /not published yet/);
  s.apply("publish", { collection: "actors" }, ORG.id, "tester");
  assert.throws(() => s.apply("publish", { collection: "relationships" }, REL.id, "tester"), /not published yet/);
  s.apply("publish", { collection: "actors" }, ORG2.id, "tester");
  s.apply("publish", { collection: "relationships" }, REL.id, "tester");
  assert.equal(s.publicData().relationships.some(item => item.id === REL.id), true);
});

test("withdrawing a published actor hides it and self-heals away any relationship that depended on it, with no dangling edges", () => {
  const s = store(undefined);
  s.apply("upsertActor", ORG, undefined, "tester");
  s.apply("upsertActor", ORG2, undefined, "tester");
  s.apply("upsertRelationship", REL, undefined, "tester");
  s.apply("publish", { collection: "actors" }, ORG.id, "tester");
  s.apply("publish", { collection: "actors" }, ORG2.id, "tester");
  s.apply("publish", { collection: "relationships" }, REL.id, "tester");
  assert.equal(s.publicData().relationships.some(item => item.id === REL.id), true);

  s.apply("withdraw", { collection: "actors" }, ORG2.id, "tester");
  const pub = s.publicData();
  assert.equal(pub.actors.some(item => item.id === ORG2.id), false);
  assert.equal(pub.relationships.some(item => item.id === REL.id), false, "a relationship must never be public if either endpoint is not");
  // The relationship record itself is untouched/still marked published in the admin view — it simply
  // will not surface publicly again until its endpoint is republished.
  assert.equal(s.snapshot().relationships.find(item => item.id === REL.id).status, "published");

  s.apply("publish", { collection: "actors" }, ORG2.id, "tester");
  assert.equal(s.publicData().relationships.some(item => item.id === REL.id), true, "relationship reappears once both endpoints are published again");
});

test("saving a draft edit on a published record does not change the public copy until re-published; withdraw/restore/archive follow explicit rules", () => {
  const s = store(undefined);
  s.apply("upsertActor", ORG, undefined, "tester");
  s.apply("publish", { collection: "actors" }, ORG.id, "tester");
  assert.equal(s.publicData().actors.find(item => item.id === ORG.id).summary, ORG.summary);

  s.apply("upsertActor", { ...ORG, summary: "Pending edit, not yet published." }, undefined, "tester");
  assert.equal(s.snapshot().actors.find(item => item.id === ORG.id).status, "published", "status stays published while an edit is pending");
  assert.equal(s.publicData().actors.find(item => item.id === ORG.id).summary, ORG.summary, "public copy must be unchanged by a draft save");

  s.apply("publish", { collection: "actors" }, ORG.id, "tester");
  assert.equal(s.publicData().actors.find(item => item.id === ORG.id).summary, "Pending edit, not yet published.");

  // withdraw: published -> draft, no longer public, draft content is retained
  s.apply("withdraw", { collection: "actors" }, ORG.id, "tester");
  assert.equal(s.snapshot().actors.find(item => item.id === ORG.id).status, "draft");
  assert.equal(s.publicData().actors.some(item => item.id === ORG.id), false);
  assert.throws(() => s.apply("withdraw", { collection: "actors" }, ORG.id, "tester"), /published/);

  // archive: explicit retirement, distinct from draft; restore brings it back into the draft pipeline
  s.apply("publish", { collection: "actors" }, ORG.id, "tester");
  s.apply("archive", { collection: "actors" }, ORG.id, "tester");
  assert.equal(s.snapshot().actors.find(item => item.id === ORG.id).status, "archived");
  assert.equal(s.publicData().actors.some(item => item.id === ORG.id), false);
  assert.throws(() => s.apply("restore", { collection: "actors" }, "no-such-id", "tester"), /not found/);
  s.apply("restore", { collection: "actors" }, ORG.id, "tester");
  assert.equal(s.snapshot().actors.find(item => item.id === ORG.id).status, "draft");
  assert.equal(s.publicData().actors.some(item => item.id === ORG.id), false, "restoring does not silently re-publish");
});

test("themes are a first-class manageable collection with the same lifecycle", () => {
  const s = store(undefined);
  s.apply("upsertTheme", THEME, undefined, "tester");
  assert.equal(s.snapshot().themes.find(item => item.id === THEME.id).status, "draft");
  assert.equal(s.publicData().themes.some(item => item.id === THEME.id), false);
  s.apply("publish", { collection: "themes" }, THEME.id, "tester");
  assert.equal(s.publicData().themes.some(item => item.id === THEME.id), true);
  assert.throws(() => s.apply("upsertTheme", { ...THEME, type: "crc" }, undefined, "tester"), /Invalid theme type/);
  s.apply("deleteTheme", undefined, THEME.id, "tester");
  assert.equal(s.snapshot().themes.some(item => item.id === THEME.id), false);
});

test("deleting an entity cascades to any relationship that referenced it, in every status", () => {
  const s = store(undefined);
  s.apply("upsertActor", ORG, undefined, "tester");
  s.apply("upsertActor", ORG2, undefined, "tester");
  s.apply("upsertRelationship", REL, undefined, "tester");
  s.apply("deleteActor", undefined, ORG2.id, "tester");
  assert.equal(s.snapshot().relationships.some(item => item.id === REL.id), false);
});
