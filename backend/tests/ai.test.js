"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createCore } = require("../../admin/dataset-core");
const AI = require("../../ai-engine");

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "..", "data.js"), "utf8"), context);
const base = context.window.RD_DATA;
const core = createCore(base);

// What the public page holds after the store loads published data.
function publicD(state) {
  const pub = core.publicData(state);
  return { ...base, actors: pub.actors, projectNodes: pub.projects, themeNodes: pub.themes, relationships: pub.relationships, allNodes: [...pub.actors, ...pub.themes, ...pub.projects] };
}
const op = (state, name, value, id) => core.apply(state, name, value, id, "tester");

test("a theme question is answered from published records and matches the directory data", () => {
  const D = publicD(core.defaults());
  const result = AI.answer(D, "Which CRCs are active in decarbonisation?");
  assert.equal(result.matched, true);
  const expected = D.actors.filter(a => a.type === "crc" && a.themes.includes("decarbonisation")).map(a => a.name);
  assert.ok(expected.length > 0);
  for (const name of expected) assert.ok(result.answer.includes(name), name);
  assert.match(result.answer, new RegExp(expected.length + " published record"));
});

test("answers change with Admin edits: renamed, withdrawn and deleted records are reflected immediately", () => {
  let s = core.defaults();
  const before = AI.answer(publicD(s), "What is Cicada Innovations connected to?");
  assert.match(before.answer, /Cicada Innovations/);
  const cicada = s.actors.find(a => a.id === "cicada");
  s = op(s, "upsertActor", { ...cicada, name: "Cicada Renamed" });
  assert.match(AI.answer(publicD(s), "What is Cicada Innovations connected to?").answer, /Cicada Innovations/, "a draft rename is not public yet, so the public answer still uses the published name");
  assert.match(AI.answer(publicD(s), "What is Zebra Quantum Institute connected to?").answer, /can't answer/);
  s = op(s, "publish", { collection: "actors" }, "cicada");
  const renamed = AI.answer(publicD(s), "What is Cicada Renamed connected to?");
  assert.match(renamed.answer, /Cicada Renamed/);
  s = op(s, "withdraw", { collection: "actors" }, "cicada");
  const after = AI.answer(publicD(s), "How many organisations are published?");
  assert.ok(!after.answer.includes("Cicada"));
  const crcAnswer = AI.answer(publicD(s), "Which CRCs are active in decarbonisation?").answer;
  s = op(s, "deleteActor", undefined, "hilt-crc");
  assert.ok(!AI.answer(publicD(s), "Which CRCs are active in decarbonisation?").answer.includes("Heavy Industry Low-carbon Transition CRC"));
  assert.ok(crcAnswer.includes("Heavy Industry Low-carbon Transition CRC"));
});

test("counts, paths and gaps are computed, not scripted", () => {
  const s = core.defaults();
  const D = publicD(s);
  const total = AI.answer(D, "How many organisations are published?");
  assert.match(total.answer, new RegExp(D.actors.length + " organisations"));
  const path = AI.answer(D, "How are Future Battery Industries CRC and Australian National Fabrication Facility connected?");
  assert.equal(path.matched, true);
  assert.match(path.answer, /Future Battery Industries CRC/);
  assert.match(path.answer, /Australian National Fabrication Facility/);
  const gaps = AI.answer(D, "Where are the coverage gaps?");
  assert.match(gaps.answer, /Queensland|Tasmania|Northern Territory/);
  // adding a CRC in Tasmania removes Tasmania from the gap list (once published)
  let s2 = op(s, "upsertActor", { id: "tas-crc", name: "Tas CRC", type: "crc", state: "TAS", summary: "x", themes: [], dataConfidence: "needs-review" });
  assert.match(AI.answer(publicD(s2), "Where are the coverage gaps?").answer, /Tasmania/, "draft is not public");
  s2 = op(s2, "publish", { collection: "actors" }, "tas-crc");
  assert.doesNotMatch(AI.answer(publicD(s2), "Where are the coverage gaps?").answer.split("\n")[1] || "", /Tasmania/);
});

test("questions the data cannot answer are refused; empty data is reported honestly", () => {
  const D = publicD(core.defaults());
  const unknown = AI.answer(D, "What will the budget of the CRC programme be in 2040?");
  assert.equal(unknown.matched, false);
  assert.match(unknown.answer, /can't answer/);
  const empty = AI.answer({ ...base, actors: [], projectNodes: [], themeNodes: [], relationships: [], allNodes: [] }, "Which CRCs exist?");
  assert.equal(empty.matched, false);
  assert.match(empty.answer, /no published records/i);
  assert.deepEqual(AI.suggestions({ ...base, actors: [], projectNodes: [], themeNodes: [], relationships: [], allNodes: [] }), []);
});

test("suggestions only mention published records", () => {
  let s = core.defaults();
  s = op(s, "upsertTheme", { id: "secret-theme", name: "Secret Draft Theme", type: "research_theme", summary: "x", dataConfidence: "needs-review" });
  const text = AI.suggestions(publicD(s)).join(" ");
  assert.ok(!text.includes("Secret Draft Theme"));
  assert.ok(AI.suggestions(publicD(s)).length > 0);
});
