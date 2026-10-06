"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createCore } = require("../admin/dataset-core");
const clone = value => JSON.parse(JSON.stringify(value));

// Persistence wrapper. All dataset rules (drafts, publishing, delete cascades, links, layout,
// migration) live in admin/dataset-core.js, which the browser demo store runs as well.
function createDataStore(dataPath) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8"), context);
  const core = createCore(context.window.RD_DATA);

  function write(state) {
    if (!dataPath) return;
    fs.mkdirSync(path.dirname(dataPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(dataPath + ".tmp", JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(dataPath + ".tmp", dataPath);
  }

  let state;
  let migration = null;
  if (dataPath && fs.existsSync(dataPath)) {
    const { state: normalized, report } = core.normalize(JSON.parse(fs.readFileSync(dataPath, "utf8")));
    core.validate(normalized);
    state = normalized;
    if (report.changed) {
      // Keep an untouched copy of the file as it was before this upgrade rewrites it.
      const backup = dataPath + ".bak-v" + report.fromVersion;
      if (!fs.existsSync(backup)) fs.copyFileSync(dataPath, backup);
      write(state);
      migration = { ...report, backup };
    }
  } else {
    state = core.defaults();
  }

  return {
    snapshot: () => clone(state),
    publicData: () => core.publicData(state),
    migration: () => migration,
    apply(operation, value, recordId, username) {
      const next = core.apply(state, operation, value, recordId, username);
      write(next);
      state = next;
      return clone(state);
    },
  };
}
module.exports = { createDataStore };
