(function () {
  "use strict";
  var D = window.RD_DATA;
  var Auth = window.RD_ADMIN_AUTH;
  if (!D || !Auth || !Auth.isDemo()) return;
  // Browser-local demo storage. Rules come from the same shared core the Node backend uses
  // (admin/dataset-core.js), so demo mode and backend mode cannot drift apart. The data lives
  // in THIS browser's localStorage only; it is not shared across browsers, devices or users.
  var KEY = "rd-directory-demo-data-v1";
  var core = window.RD_CORE.createCore(D);
  var defaults = core.defaults();
  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function readRaw() {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (error) { return null; }
  }
  function snapshot() {
    var raw = readRaw();
    if (!raw) return clone(defaults);
    try {
      var result = core.normalize(raw);
      core.validate(result.state);
      if (result.report.changed) {
        // Upgrade in place, keeping the original under a backup key first (only once per version).
        var backupKey = KEY + ".backup-v" + result.report.fromVersion;
        try {
          if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, JSON.stringify(raw));
          localStorage.setItem(KEY, JSON.stringify(result.state));
        } catch (storageError) { /* quota or blocked storage: serve the upgraded copy without persisting */ }
      }
      return clone(result.state);
    } catch (error) {
      // Never overwrite unreadable data: leave it in storage and serve the seed for this view.
      return clone(defaults);
    }
  }
  // What visitors of the public page may see (published records only).
  function publicSnapshot() {
    var full = snapshot();
    var data = core.publicData(full);
    data.audit = [];
    return data;
  }
  async function change(operation, value, id) {
    var session = await Auth.session();
    if (!session.authenticated) throw new Error("Please sign in again before saving.");
    var next = core.apply(snapshot(), operation, value, id, session.username);
    localStorage.setItem(KEY, JSON.stringify(next));
    return clone(next);
  }
  window.RD_DEMO_STORE = { snapshot: snapshot, publicSnapshot: publicSnapshot, change: change, core: core };
})();
