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
const theme = id => ({ id, name: id.toUpperCase(), type: "research_theme", summary: "Theme.", dataConfidence: "needs-review", lastUpdated: "2026-10-06" });
const project = (id, extra = {}) => ({ id, name: id.toUpperCase(), type: "project_initiative", summary: "Project.", themes: [], dataConfidence: "needs-review", lastUpdated: "2026-10-06", ...extra });
const rel = (id, s, t, type = "collaborates_with") => ({ id, sourceId: s, targetId: t, type, intensity: "medium", confidence: "needs-review", evidence: "Because." });
const pub = state => core.publicData(state);
const find = (state, key, id) => state[key].find(r => r.id === id);

test("fresh seed: everything published, links reconciled from tags/hosts, public equals admin", () => {
  const s = core.defaults();
  for (const key of ["actors", "projects", "themes", "relationships"]) assert.ok(s[key].every(r => r.status === "published"), key);
  const p = pub(s);
  assert.equal(p.actors.length, s.actors.length);
  assert.equal(p.relationships.length, s.relationships.length);
  assert.equal(find(p, "projects", "anu-battery-program").hostId, "anu-eci");
  assert.ok(find(p, "actors", "cicada").themes.includes("decarbonisation"), "tag without an edge must become a published link, not vanish");
  assert.ok(p.actors.every(a => !("status" in a) && !("publishedSnapshot" in a)));
});

test("legacy v1 data without status migrates as published", () => {
  const { state, report } = core.normalize({ version: 1, actors: [org("legacy")], projects: [], relationships: [], sources: [] });
  assert.equal(find(state, "actors", "legacy").status, "published");
  assert.equal(report.migratedToPublished, 1);
  assert.equal(pub(state).actors.some(a => a.id === "legacy"), true);
});

test("archived records are never discarded or published: they become non-public drafts", () => {
  const raw = core.defaults();
  const archivedOrg = { ...org("old-org"), status: "archived", publishedSnapshot: strip(org("old-org")) };
  function strip(o) { return JSON.parse(JSON.stringify(o)); }
  raw.actors.push(archivedOrg);
  raw.version = 2;
  const { state, report } = core.normalize(raw);
  const migrated = find(state, "actors", "old-org");
  assert.equal(migrated.status, "draft");
  assert.equal("publishedSnapshot" in migrated, false);
  assert.equal(report.archivedToDraft, 1);
  assert.equal(migrated.name, "OLD-ORG", "content is kept");
  assert.equal(pub(state).actors.some(a => a.id === "old-org"), false);
  core.validate(state);
});

test("draft lifecycle: save stays private, publish exposes, edit keeps public copy, withdraw hides", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("alpha"));
  assert.equal(find(s, "actors", "alpha").status, "draft");
  assert.equal(pub(s).actors.some(a => a.id === "alpha"), false);
  s = op(s, "publish", { collection: "actors" }, "alpha");
  assert.equal(pub(s).actors.find(a => a.id === "alpha").summary, "Test.");
  s = op(s, "upsertActor", org("alpha", { summary: "Edited." }));
  assert.equal(core.hasPendingChanges(find(s, "actors", "alpha")), true);
  assert.equal(pub(s).actors.find(a => a.id === "alpha").summary, "Test.");
  s = op(s, "publish", { collection: "actors" }, "alpha");
  assert.equal(pub(s).actors.find(a => a.id === "alpha").summary, "Edited.");
  assert.equal(core.hasPendingChanges(find(s, "actors", "alpha")), false);
  s = op(s, "withdraw", { collection: "actors" }, "alpha");
  assert.equal(find(s, "actors", "alpha").status, "draft");
  assert.equal("publishedSnapshot" in find(s, "actors", "alpha"), false);
  assert.equal(pub(s).actors.some(a => a.id === "alpha"), false);
  assert.throws(() => op(s, "archive", { collection: "actors" }, "alpha"), /Unknown operation/);
  assert.throws(() => op(s, "restore", { collection: "actors" }, "alpha"), /Unknown operation/);
});

test("relationship publish names the blocking records; withDependencies publishes them together", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("alpha"));
  s = op(s, "upsertActor", org("beta"));
  s = op(s, "upsertRelationship", rel("r-ab", "alpha", "beta"));
  const plan = core.describePublish(s, "relationships", "r-ab");
  assert.deepEqual(plan.blockers.map(b => b.name), ["ALPHA", "BETA"]);
  let error;
  try { op(s, "publish", { collection: "relationships" }, "r-ab"); } catch (e) { error = e; }
  assert.ok(error);
  assert.match(error.message, /"ALPHA" \(organisation, draft\) and "BETA"/);
  assert.equal(error.blockers.length, 2);
  assert.equal(find(s, "relationships", "r-ab").status, "draft", "failure leaves the draft untouched");
  const done = op(s, "publish", { collection: "relationships", withDependencies: true }, "r-ab");
  assert.equal(pub(done).actors.some(a => a.id === "alpha"), true);
  assert.equal(pub(done).relationships.some(r => r.id === "r-ab"), true);
});

test("withdrawing an endpoint removes the edge from the public view without a dangling reference", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("alpha")); s = op(s, "upsertActor", org("beta"));
  s = op(s, "upsertRelationship", rel("r-ab", "alpha", "beta"));
  s = op(s, "publish", { collection: "relationships", withDependencies: true }, "r-ab");
  s = op(s, "withdraw", { collection: "actors" }, "beta");
  const p = pub(s);
  assert.equal(p.relationships.some(r => r.id === "r-ab"), false);
  const ids = new Set(p.actors.concat(p.projects, p.themes).map(n => n.id));
  assert.ok(p.relationships.every(r => ids.has(r.sourceId) && ids.has(r.targetId)));
});

test("theme tag on a node is represented by a relationship (single authority) and published with the node", () => {
  let s = core.defaults();
  s = op(s, "upsertTheme", theme("zz-theme"));
  s = op(s, "upsertActor", org("alpha", { themes: ["zz-theme", "free-tag"] }));
  const link = s.relationships.find(r => r.type === "shares_research_theme" && r.targetId === "alpha");
  assert.ok(link, "tag creates a link");
  assert.equal(link.status, "draft");
  assert.deepEqual(find(s, "actors", "alpha").themes.sort(), ["free-tag", "zz-theme"]);
  s = op(s, "publish", { collection: "actors" }, "alpha");
  assert.deepEqual(find(pub(s), "actors", "alpha").themes, ["free-tag"], "theme not published yet: only the free tag is public");
  assert.equal(core.describePublish(s, "actors", "alpha").hiddenLinks.length, 1);
  s = op(s, "publish", { collection: "themes" }, "zz-theme");
  assert.deepEqual(find(pub(s), "actors", "alpha").themes.sort(), ["free-tag", "zz-theme"], "publishing the far end publishes the link because alpha's published copy already references it");
  // a tag added later (draft only) must NOT go public when the theme is published
  s = op(s, "upsertTheme", theme("yy-theme"));
  s = op(s, "upsertActor", org("alpha", { themes: ["zz-theme", "free-tag", "yy-theme"] }));
  s = op(s, "publish", { collection: "themes" }, "yy-theme");
  assert.equal(find(pub(s), "actors", "alpha").themes.includes("yy-theme"), false, "alpha's new tag is still a draft edit");
  s = op(s, "publish", { collection: "actors" }, "alpha");
  assert.equal(find(pub(s), "actors", "alpha").themes.includes("yy-theme"), true);
  assert.equal(pub(s).relationships.some(r => r.id === link.id), true);
  // creating the theme relationship directly updates the node's tags too
  s = op(s, "upsertActor", org("beta"));
  s = op(s, "upsertRelationship", rel("t-beta", "zz-theme", "beta", "shares_research_theme"));
  assert.ok(find(s, "actors", "beta").themes.includes("zz-theme"));
  s = op(s, "deleteRelationship", undefined, "t-beta");
  assert.equal(find(s, "actors", "beta").themes.includes("zz-theme"), false);
});

test("project host comes from a hosted_by relationship; wrong direction and second host are rejected", () => {
  let s = core.defaults();
  s = op(s, "upsertActor", org("alpha")); s = op(s, "upsertActor", org("beta"));
  s = op(s, "upsertProject", project("proj"));
  s = op(s, "upsertRelationship", rel("h1", "proj", "alpha", "hosted_by"));
  assert.equal(find(s, "projects", "proj").hostId, "alpha");
  assert.throws(() => op(s, "upsertRelationship", rel("h2", "proj", "beta", "hosted_by")), /already has a host/);
  assert.throws(() => op(s, "upsertRelationship", rel("h3", "alpha", "proj", "hosted_by")), /from a project to an organisation/);
  s = op(s, "publish", { collection: "projects" }, "proj");
  s = op(s, "publish", { collection: "actors" }, "alpha");
  assert.equal(find(pub(s), "projects", "proj").hostId, "alpha", "publishing the project also published its host link");
  s = op(s, "withdraw", { collection: "actors" }, "alpha");
  assert.equal(find(pub(s), "projects", "proj").hostId, "", "no public host once the host is withdrawn");
});

test("delete removes the record everywhere: snapshot, relationships, references, layout", () => {
  let s = core.defaults();
  s = op(s, "upsertTheme", theme("zz-theme"));
  s = op(s, "upsertActor", org("alpha", { themes: ["zz-theme"] }));
  s = op(s, "upsertActor", org("beta"));
  s = op(s, "upsertProject", project("proj"));
  s = op(s, "upsertRelationship", rel("h1", "proj", "alpha", "hosted_by"));
  s = op(s, "upsertRelationship", rel("r-ab", "alpha", "beta"));
  for (const [c, id] of [["themes", "zz-theme"], ["actors", "alpha"], ["actors", "beta"], ["projects", "proj"]]) s = op(s, "publish", { collection: c }, id);
  s = op(s, "publish", { collection: "relationships", withDependencies: true }, "r-ab");
  s = op(s, "setLayout", { positions: { alpha: { x: 10, y: 20 }, beta: { x: 30, y: 40 } } });
  const impact = core.impactOf(s, "actors", "alpha");
  assert.deepEqual(impact.hostedProjects.map(p => p.id), ["proj"]);
  assert.ok(impact.relationships.length >= 3);
  s = op(s, "deleteActor", undefined, "alpha");
  const { audit, ...withoutAudit } = s;
  assert.equal(JSON.stringify(withoutAudit).includes('"alpha"'), false, "no trace of the deleted id remains anywhere (incl. publishedSnapshot/layout)");
  assert.ok(audit.some(a => a.action === "Deleted" && a.recordId === "alpha"), "the audit log still records that it happened");
  assert.equal(find(s, "projects", "proj").hostId, "");
  assert.equal(pub(s).relationships.some(r => r.sourceId === "alpha" || r.targetId === "alpha"), false);
  s = op(s, "deleteTheme", undefined, "zz-theme");
  assert.equal(JSON.stringify({ ...s, audit: [] }).includes("zz-theme"), false);
  core.validate(s);
});

test("layout positions persist separately from business data and are validated", () => {
  let s = core.defaults();
  const before = s.updatedAt, auditLength = s.audit.length;
  s = op(s, "setLayout", { positions: { "hilt-crc": { x: 12.34, y: -50 } } });
  assert.deepEqual(s.layout.nodes["hilt-crc"], { x: 12.3, y: -50 });
  assert.equal(s.updatedAt, before, "moving a node is not a data change");
  assert.equal(s.audit.length, auditLength);
  assert.equal(find(pub(s), "actors", "hilt-crc").x, undefined, "layout never reaches the public data");
  assert.throws(() => op(s, "setLayout", { positions: { nope: { x: 1, y: 1 } } }), /Unknown record/);
  assert.throws(() => op(s, "setLayout", { positions: { "hilt-crc": { x: NaN, y: 1 } } }), /Invalid layout/);
  s = op(s, "setLayout", { reset: true });
  assert.deepEqual(s.layout.nodes, {});
});

test("importState needs real arrays; a bare object is rejected", () => {
  const s = core.defaults();
  assert.throws(() => op(s, "importState", {}), /Expected/);
  assert.throws(() => op(s, "__proto__"), /Unknown operation/);
});
