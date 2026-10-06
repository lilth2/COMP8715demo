"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("removed features stay removed from the shipped files", () => {
  for (const file of ["index.html", "app.js", "data.js", "ai-engine.js", "README.md", "docs/DEPLOYMENT.md"]) {
    assert.doesNotMatch(read(file), /walkthrough|wt-highlight|wtStep/i, file + " still mentions the demo walkthrough");
  }
  for (const file of ["admin/index.html", "admin/console.js", "admin/store.js", "admin/demo-store.js", "admin/network-editor.js", "backend/server.js"]) {
    assert.doesNotMatch(read(file), /data-action="(archive|restore)"|archiveRecord|restoreRecord|value="archived"/, file + " still has an Archive/Restore action");
  }
  assert.doesNotMatch(read("data.js"), /matchKeywords|explorerCategories|const questions|walkthrough/, "the scripted AI bank is back in data.js");
});

test("visible public wording matches how the site now works", () => {
  for (const file of ["index.html", "app.js"]) {
    assert.doesNotMatch(read(file), /pre-scripted|mock answers|mock-computed|mock data/i, file + " still describes generated content as mock/scripted");
  }
  assert.match(read("index.html"), /Answers are generated from the currently published records/);
});

test("card titles are plain text (they are escaped when rendered, so entities would show literally)", () => {
  assert.doesNotMatch(read("app.js"), /insightCard\("[^"]*&amp;/);
});
