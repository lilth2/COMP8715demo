(function () {
  "use strict";
  var D = window.RD_DATA;
  var Auth = window.RD_ADMIN_AUTH;
  if (!D || !Auth || !Auth.isDemo()) return;
  var KEY = "rd-directory-demo-data-v1";
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  var defaults = clone({ version: 1, actors: D.actors, projects: D.projectNodes, relationships: D.relationships,
    sources: D.sources.map(function (source) { return Object.assign({ id: slug(source.type || source.name) }, source); }), audit: [], updatedAt: new Date().toISOString() });
  function validate(value) {
    if (!value || !["actors", "projects", "relationships", "sources"].every(function (key) { return Array.isArray(value[key]) && value[key].length <= 10000; })) throw new Error("Expected actors, projects, relationships and sources arrays.");
    var records = value.actors.concat(value.projects, D.themeNodes);
    var ids = new Set();
    records.forEach(function (item) {
      if (!item || typeof item.id !== "string" || !/^[a-z0-9-]{1,120}$/.test(item.id) || typeof item.name !== "string" || !item.name.trim() || ids.has(item.id)) throw new Error("Invalid or duplicate record ID/name.");
      ids.add(item.id);
    });
    value.relationships.forEach(function (rel) {
      if (!rel || !ids.has(rel.sourceId) || !ids.has(rel.targetId) || rel.sourceId === rel.targetId || !Object.prototype.hasOwnProperty.call(D.RELATIONSHIP_META, rel.type)) throw new Error("Invalid relationship endpoints or type.");
    });
    value.sources.forEach(function (source) { if (!source || !source.id || !source.name || !source.type) throw new Error("Invalid source record."); });
  }
  function snapshot() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || "null");
      validate(value);
      value.audit = Array.isArray(value.audit) ? value.audit : [];
      return clone(value);
    } catch (error) { return clone(defaults); }
  }
  async function change(operation, value, id) {
    var session = await Auth.session();
    if (!session.authenticated) throw new Error("Please sign in again before saving.");
    var next = snapshot();
    var key;
    var label = "Demo dataset";
    var action = operation;
    var upserts = { upsertActor: "actors", upsertProject: "projects", upsertRelationship: "relationships", upsertSource: "sources" };
    var deletes = { deleteActor: "actors", deleteProject: "projects", deleteRelationship: "relationships", deleteSource: "sources" };
    if (Object.prototype.hasOwnProperty.call(upserts, operation)) {
      key = upserts[operation];
      if (!value || !value.id) throw new Error("A record ID is required.");
      var index = next[key].findIndex(function (item) { return item.id === value.id; });
      if (index < 0) next[key].push(clone(value)); else next[key][index] = clone(value);
      label = value.name || value.sourceId + " → " + value.targetId;
      id = value.id;
      action = index < 0 ? "Created" : "Updated";
    } else if (Object.prototype.hasOwnProperty.call(deletes, operation)) {
      key = deletes[operation];
      var record = next[key].filter(function (item) { return item.id === id; })[0];
      if (!record) throw new Error("Record not found.");
      label = record.name || id;
      next[key] = next[key].filter(function (item) { return item.id !== id; });
      if (key === "actors" || key === "projects") next.relationships = next.relationships.filter(function (item) { return item.sourceId !== id && item.targetId !== id; });
      if (key === "actors") next.projects.forEach(function (project) { if (project.hostId === id) project.hostId = ""; });
      action = "Deleted";
    } else if (operation === "importState" || operation === "reset") {
      var input = operation === "reset" ? defaults : value;
      validate(input);
      ["actors", "projects", "relationships", "sources"].forEach(function (collection) { next[collection] = clone(input[collection]); });
      action = operation === "reset" ? "Reset" : "Imported";
    } else throw new Error("Unknown operation.");
    validate(next);
    next.updatedAt = new Date().toISOString();
    next.audit.unshift({ id: crypto.randomUUID(), timestamp: next.updatedAt, actor: session.username, action: action,
      recordType: key || "Dataset", recordId: id || "dataset", label: label, details: "Demo change by " + session.username });
    next.audit = next.audit.slice(0, 100);
    localStorage.setItem(KEY, JSON.stringify(next));
    return clone(next);
  }
  window.RD_DEMO_STORE = { snapshot: snapshot, change: change };
})();
