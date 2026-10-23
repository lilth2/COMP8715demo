"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createCore } = require("../../admin/dataset-core");

function loadD() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "data.js"), "utf8"), context);
  return context.window.RD_DATA;
}
const core = createCore(loadD());
const op = (state, name, value, id) => core.apply(state, name, value, id, "tester");
const org = (id, extra = {}) => ({ id, name: id.toUpperCase(), type: "university", state: "NSW", summary: "Test.", themes: [], sectors: [], sourceNotes: [], dataConfidence: "needs-review", lastUpdated: "2026-10-06", ...extra });
const rel = (id, s, t, type = "collaborates_with") => ({ id, sourceId: s, targetId: t, type, intensity: "medium", confidence: "needs-review", evidence: "Because." });
const find = (state, key, id) => state[key].find(r => r.id === id);

test("a freeform relationship type is created on first use and validated like any other collection", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("org-a"));
  s = op(s, "upsertActor", org("org-b"));
  s = op(s, "upsertRelationshipType", { id: "", displayName: "Mentors" });
  const created = find(s, "relationshipTypes", "mentors");
  assert.ok(created, "slug id was generated from the display name");
  assert.equal(created.displayName, "Mentors");
  assert.equal(created.isSystem, false);
  s = op(s, "upsertRelationship", rel("rel-mentor", "org-a", "org-b", "mentors"));
  assert.equal(find(s, "relationships", "rel-mentor").type, "mentors");
});

test("relationship type IDs must be slug-shaped; a raw script string is rejected, not stored as-is", () => {
  let s = core.defaults();
  assert.throws(() => op(s, "upsertRelationshipType", { id: "<script>alert(1)</script>", displayName: "Bad" }), /Invalid relationship type ID/);
});

test("a relationship type's display name is stored as plain text; rendering code must escape it, so no markup executes merely by being saved", () => {
  let s = core.defaults();
  s = op(s, "upsertRelationshipType", { id: "", displayName: "<img src=x onerror=alert(1)>" });
  const created = s.relationshipTypes.find(t => t.displayName === "<img src=x onerror=alert(1)>");
  assert.ok(created, "the literal text is preserved, not executed or stripped, at the data layer");
  assert.equal(typeof created.displayName, "string");
});

test("renaming a relationship type keeps its ID stable and updates every relationship that uses it implicitly (label lookup, not a stored copy)", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("org-a"));
  s = op(s, "upsertActor", org("org-b"));
  s = op(s, "upsertRelationshipType", { id: "mentors", displayName: "Mentors" });
  s = op(s, "upsertRelationship", rel("rel-mentor", "org-a", "org-b", "mentors"));
  s = op(s, "upsertRelationshipType", { id: "mentors", displayName: "Mentors (renamed)" });
  assert.equal(find(s, "relationshipTypes", "mentors").displayName, "Mentors (renamed)");
  assert.equal(find(s, "relationships", "rel-mentor").type, "mentors", "the relationship's type id is untouched by a rename");
});

test("a system relationship type (hosted_by, shares_research_theme) cannot be deleted", () => {
  let s = core.defaults();
  assert.throws(() => op(s, "deleteRelationshipType", undefined, "hosted_by"), /system relationship type/);
  assert.throws(() => op(s, "deleteRelationshipType", undefined, "shares_research_theme"), /system relationship type/);
});

test("deleting a relationship type still referenced by a relationship is blocked until merged into another type", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("org-a"));
  s = op(s, "upsertActor", org("org-b"));
  s = op(s, "upsertRelationshipType", { id: "mentors", displayName: "Mentors" });
  s = op(s, "upsertRelationship", rel("rel-mentor", "org-a", "org-b", "mentors"));
  assert.throws(() => op(s, "deleteRelationshipType", undefined, "mentors"), /used by one or more relationships/);
  s = op(s, "deleteRelationshipType", { mergeInto: "collaborates_with" }, "mentors");
  assert.equal(find(s, "relationshipTypes", "mentors"), undefined, "the merged-away type is gone");
  assert.equal(find(s, "relationships", "rel-mentor").type, "collaborates_with", "the relationship now points at the merge target instead of a dangling type");
});

test("an unused, non-system relationship type can be deleted outright with no merge target", () => {
  let s = core.defaults();
  s = op(s, "upsertRelationshipType", { id: "unused-type", displayName: "Unused" });
  s = op(s, "deleteRelationshipType", undefined, "unused-type");
  assert.equal(find(s, "relationshipTypes", "unused-type"), undefined);
});

test("a dataset saved before relationshipTypes existed is migrated: types are seeded from legacy data, and any type referenced only by a relationship is backfilled so it never resolves to a blank label", () => {
  const seed = core.defaults();
  const legacy = { version: 3, actors: seed.actors, projects: seed.projects, themes: seed.themes, relationships: [...seed.relationships, { id: "legacy-custom-rel", sourceId: seed.actors[0].id, targetId: seed.actors[1].id, type: "legacy_custom_type", intensity: "weak", confidence: "needs-review", evidence: "x", status: "draft" }], sources: seed.sources, audit: [] };
  const { state, report } = core.normalize(legacy);
  assert.ok(report.changed, "version 3 -> 4 is a real migration");
  assert.ok(state.relationshipTypes.some(t => t.id === "hosted_by" && t.isSystem));
  assert.ok(state.relationshipTypes.some(t => t.id === "legacy_custom_type"), "a type referenced only by a relationship, never declared, is backfilled");
  core.validate(state);
});
