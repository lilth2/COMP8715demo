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
const find = (state, key, id) => state[key].find(r => r.id === id);

test("bulk import (actors, add-only): valid rows become drafts, invalid rows are reported per-row without blocking the others from being previewed", () => {
  const s = core.defaults();
  const rows = [
    { id: "bulk-org-1", name: "Bulk Org One", type: "university", summary: "First.", sourceRow: 2 },
    { name: "", type: "university", summary: "Missing name.", sourceRow: 3 }, // invalid: no name
    { id: "bulk-org-2", name: "Bulk Org Two", type: "university", summary: "Second.", sourceRow: 4 },
  ];
  const plan = core.planBulkUpsert(s, "actors", "add-only", rows);
  assert.equal(plan.counts.created, 2);
  assert.equal(plan.counts.errors, 1);
  assert.equal(plan.canCommit, false, "a plan with any row error cannot commit");
  assert.ok(plan.rows[1].errors.some(e => /name/i.test(e)));
  assert.equal(plan.rows[1].sourceRow, 3, "the original spreadsheet row number is preserved for error location");
});

test("bulk import commit is all-or-nothing: committing a plan with errors is rejected, not silently partially applied", () => {
  let s = core.defaults();
  const rows = [
    { id: "bulk-fail-1", name: "OK Org", type: "university", summary: "Fine.", sourceRow: 2 },
    { name: "", type: "university", sourceRow: 3 },
  ];
  assert.throws(() => op(s, "bulkUpsert", { collection: "actors", mode: "add-only", rows }), /row error/);
  assert.equal(find(s, "actors", "bulk-fail-1"), undefined, "no row was committed because the batch had an error");
});

test("bulk import (actors, add-only): valid rows commit as drafts, visible in admin snapshot but not in public data", () => {
  let s = core.defaults();
  const rows = [
    { id: "bulk-draft-org", name: "Bulk Draft Org", type: "university", summary: "A new org.", sourceRow: 2 },
  ];
  s = op(s, "bulkUpsert", { collection: "actors", mode: "add-only", rows });
  const created = find(s, "actors", "bulk-draft-org");
  assert.ok(created);
  assert.equal(created.status, "draft", "bulk-imported records default to draft, never directly public");
  assert.equal(core.publicData(s).actors.some(a => a.id === "bulk-draft-org"), false);
});

test("bulk import add-only mode rejects an ID that already exists; update-by-id mode requires the ID to already exist", () => {
  let s = core.defaults();
  const existingId = s.actors[0].id;
  const addOnlyPlan = core.planBulkUpsert(s, "actors", "add-only", [{ id: existingId, name: "Dup", type: "university", summary: "x", sourceRow: 2 }]);
  assert.equal(addOnlyPlan.counts.errors, 1);
  assert.ok(addOnlyPlan.rows[0].errors.some(e => /already exists/i.test(e)));

  const updatePlan = core.planBulkUpsert(s, "actors", "update-by-id", [{ id: "does-not-exist", name: "X", type: "university", summary: "x", sourceRow: 2 }]);
  assert.equal(updatePlan.counts.errors, 1);
  assert.ok(updatePlan.rows[0].errors.some(e => /no existing record/i.test(e)));

  const validUpdate = core.planBulkUpsert(s, "actors", "update-by-id", [{ id: existingId, name: "Renamed Org", type: s.actors[0].type, summary: "Updated.", sourceRow: 2 }]);
  assert.equal(validUpdate.counts.updated, 1);
  assert.equal(validUpdate.canCommit, true);
});

test("bulk import does not silently merge records by matching name: two rows with the same name but no shared ID both get created, not merged", () => {
  let s = core.defaults();
  const rows = [
    { id: "same-name-a", name: "Same Name Org", type: "university", summary: "First copy.", sourceRow: 2 },
    { id: "same-name-b", name: "Same Name Org", type: "university", summary: "Second copy.", sourceRow: 3 },
  ];
  s = op(s, "bulkUpsert", { collection: "actors", mode: "add-only", rows });
  assert.ok(find(s, "actors", "same-name-a"));
  assert.ok(find(s, "actors", "same-name-b"));
});

test("bulk import for relationships resolves From/To by existing organisation name, reports ambiguous or unknown names instead of guessing", () => {
  let s = core.defaults();
  const [a, b] = s.actors;
  const rows = [{ source: a.name, target: b.name, type: "collaborates_with", sourceRow: 2 }];
  const plan = core.planBulkUpsert(s, "relationships", "add-only", rows);
  assert.equal(plan.counts.created, 1, plan.rows[0].errors.join("; "));
  assert.equal(plan.rows[0].row.sourceId, a.id);
  assert.equal(plan.rows[0].row.targetId, b.id);

  const unknownPlan = core.planBulkUpsert(s, "relationships", "add-only", [{ source: "Nonexistent Org Name", target: b.name, type: "collaborates_with", sourceRow: 2 }]);
  assert.equal(unknownPlan.counts.errors, 1);
  assert.ok(unknownPlan.rows[0].errors.some(e => /not found/i.test(e)));
});

test("bulk import for relationships creates a new freeform relationship type on commit, same as the single-record admin form", () => {
  let s = core.defaults();
  const [a, b] = s.actors;
  const rows = [{ source: a.id, target: b.id, type: "Bulk Imported Type", sourceRow: 2 }];
  s = op(s, "bulkUpsert", { collection: "relationships", mode: "add-only", rows });
  const createdType = s.relationshipTypes.find(t => t.displayName === "Bulk Imported Type");
  assert.ok(createdType, "a new relationship type is created from the typed text, not rejected");
  assert.ok(s.relationships.some(r => r.type === createdType.id && r.sourceId === a.id && r.targetId === b.id));
});

test("bulk import rejects more than 5000 rows in one batch rather than accepting an unbounded upload", () => {
  const s = core.defaults();
  const rows = Array.from({ length: 5001 }, (_, i) => ({ id: "row-" + i, name: "Org " + i, type: "university", summary: "x", sourceRow: i + 2 }));
  assert.throws(() => core.planBulkUpsert(s, "actors", "add-only", rows), /Too many rows/);
});

test("re-planning the exact same already-committed batch in add-only mode reports every row as a duplicate-ID error, so resubmission cannot silently duplicate records", () => {
  let s = core.defaults();
  const rows = [{ id: "resubmit-org", name: "Resubmit Org", type: "university", summary: "x", sourceRow: 2 }];
  s = op(s, "bulkUpsert", { collection: "actors", mode: "add-only", rows });
  const replan = core.planBulkUpsert(s, "actors", "add-only", rows);
  assert.equal(replan.counts.errors, 1);
  assert.equal(replan.counts.created, 0);
});
