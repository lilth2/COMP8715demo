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
const org = (id, extra = {}) => ({ id, name: id.toUpperCase(), type: "university", state: "NSW", summary: "Test.", themes: [], sectors: [], sourceNotes: [], dataConfidence: "needs-review", lastUpdated: "2026-10-23", ...extra });
const find = (state, key, id) => state[key].find(r => r.id === id);

test("bulk publish: multiple draft records become published together, all-or-nothing on a relationship with an unpublished endpoint", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("batch-org-1"));
  s = op(s, "upsertActor", org("batch-org-2"));
  s = op(s, "upsertActor", org("batch-org-3"));
  s = op(s, "bulkAction", { collection: "actors", ids: ["batch-org-1", "batch-org-2", "batch-org-3"], action: "publish" });
  assert.equal(find(s, "actors", "batch-org-1").status, "published");
  assert.equal(find(s, "actors", "batch-org-2").status, "published");
  assert.equal(find(s, "actors", "batch-org-3").status, "published");
});

test("bulk publish of relationships is all-or-nothing: one blocked relationship rejects the whole batch", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("blk-a"));
  s = op(s, "upsertActor", org("blk-b"));
  s = op(s, "upsertActor", { ...org("blk-c") }); // stays draft on purpose
  s = op(s, "publish", { collection: "actors" }, "blk-a");
  s = op(s, "publish", { collection: "actors" }, "blk-b");
  s = op(s, "upsertRelationship", { id: "rel-ok", sourceId: "blk-a", targetId: "blk-b", type: "collaborates_with", confidence: "needs-review", intensity: "weak", evidence: "x" });
  s = op(s, "upsertRelationship", { id: "rel-blocked", sourceId: "blk-a", targetId: "blk-c", type: "collaborates_with", confidence: "needs-review", intensity: "weak", evidence: "x" });
  assert.throws(() => op(s, "bulkAction", { collection: "relationships", ids: ["rel-ok", "rel-blocked"], action: "publish" }), /not published yet/);
  // Neither relationship was published — the whole batch was rejected, not a partial publish.
  assert.equal(find(s, "relationships", "rel-ok").status, "draft");
});

test("bulk withdraw rejects the whole batch if any selected record is already a draft", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("wd-a"));
  s = op(s, "upsertActor", org("wd-b"));
  s = op(s, "publish", { collection: "actors" }, "wd-a");
  // wd-b stays draft
  assert.throws(() => op(s, "bulkAction", { collection: "actors", ids: ["wd-a", "wd-b"], action: "withdraw" }), /already drafts/);
  assert.equal(find(s, "actors", "wd-a").status, "published", "wd-a must not be withdrawn either, since the batch was rejected");
});

test("bulk delete removes every selected record and scrubs references, same as individual delete", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("del-a"));
  s = op(s, "upsertActor", org("del-b"));
  s = op(s, "upsertRelationship", { id: "del-rel", sourceId: "del-a", targetId: "del-b", type: "collaborates_with", confidence: "needs-review", intensity: "weak", evidence: "x" });
  s = op(s, "bulkAction", { collection: "actors", ids: ["del-a", "del-b"], action: "delete" });
  assert.equal(find(s, "actors", "del-a"), undefined);
  assert.equal(find(s, "actors", "del-b"), undefined);
  assert.equal(find(s, "relationships", "del-rel"), undefined, "the relationship between the two deleted actors is also gone, not left dangling");
});

test("bulk setField only allows an explicit per-collection allowlist of fields, not arbitrary fields like id or status", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("fld-a"));
  s = op(s, "upsertActor", org("fld-b"));
  s = op(s, "bulkAction", { collection: "actors", ids: ["fld-a", "fld-b"], action: "setField", field: "state", fieldValue: "VIC" });
  assert.equal(find(s, "actors", "fld-a").state, "VIC");
  assert.equal(find(s, "actors", "fld-b").state, "VIC");
  assert.throws(() => op(s, "bulkAction", { collection: "actors", ids: ["fld-a"], action: "setField", field: "status", fieldValue: "published" }), /cannot be batch-edited/);
  assert.throws(() => op(s, "bulkAction", { collection: "actors", ids: ["fld-a"], action: "setField", field: "id", fieldValue: "hacked-id" }), /cannot be batch-edited/);
});

test("a batch action referencing a non-existent id is rejected entirely, naming the missing id(s)", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("exists-a"));
  assert.throws(() => op(s, "bulkAction", { collection: "actors", ids: ["exists-a", "does-not-exist"], action: "delete" }), /not found/);
  assert.ok(find(s, "actors", "exists-a"), "the existing record is untouched since the whole batch was rejected");
});

test("batchImpactOf aggregates relationships/hosted-projects/tagged-records across all selected ids, de-duplicated", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("imp-a"));
  s = op(s, "upsertActor", org("imp-b"));
  s = op(s, "upsertActor", org("imp-c"));
  s = op(s, "upsertRelationship", { id: "imp-rel-1", sourceId: "imp-a", targetId: "imp-b", type: "collaborates_with", confidence: "needs-review", intensity: "weak", evidence: "x" });
  s = op(s, "upsertRelationship", { id: "imp-rel-2", sourceId: "imp-b", targetId: "imp-c", type: "collaborates_with", confidence: "needs-review", intensity: "weak", evidence: "x" });
  const impact = core.batchImpactOf(s, "actors", ["imp-a", "imp-b"]);
  assert.equal(impact.count, 2);
  // imp-rel-1 touches both imp-a and imp-b; it must appear once, not twice.
  assert.equal(impact.relationships.filter(r => r.id === "imp-rel-1").length, 1);
  assert.ok(impact.relationships.some(r => r.id === "imp-rel-2"), "imp-rel-2 (touching imp-b) is included too");
});

test("more than 2000 ids in one batch action is rejected rather than accepted without limit", () => {
  let s = core.defaults();
  const ids = Array.from({ length: 2001 }, (_, i) => "nonexistent-" + i);
  assert.throws(() => op(s, "bulkAction", { collection: "actors", ids, action: "delete" }), /Too many records/);
});
