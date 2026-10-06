(function () {
  "use strict";
  var D = window.RD_DATA;
  var Auth = window.RD_ADMIN_AUTH;
  if (!D || !Auth || !Auth.isDemo()) return;
  var KEY = "rd-directory-demo-data-v1";
  var STATUS_VALUES = ["draft", "published", "archived"];
  var LIFECYCLE_COLLECTIONS = ["actors", "projects", "themes", "relationships"];
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function metaStrip(record) {
    var copy = clone(record);
    delete copy.status; delete copy.publishedSnapshot;
    return copy;
  }
  // Same "treat a pre-existing record as already published" migration used by the
  // Node backend (backend/server-data.js) — kept in sync by hand since this file
  // runs in the browser, not under Node. See that file for the rationale.
  function migrateLifecycle(record) {
    if (record && STATUS_VALUES.indexOf(record.status) !== -1) {
      // Heal data persisted by the first release, whose snapshot wrongly carried `status`.
      if (record.publishedSnapshot) record.publishedSnapshot = metaStrip(record.publishedSnapshot);
      return record;
    }
    var fields = metaStrip(record || {});
    var snapshot = clone(fields);
    fields.status = "published";
    fields.publishedSnapshot = snapshot;
    return fields;
  }
  var defaults = clone({
    version: 2,
    actors: D.actors.map(migrateLifecycle),
    projects: D.projectNodes.map(migrateLifecycle),
    themes: D.themeNodes.map(migrateLifecycle),
    relationships: D.relationships.map(migrateLifecycle),
    sources: D.sources.map(function (source) { return Object.assign({ id: slug(source.type || source.name) }, source); }),
    audit: [],
    updatedAt: new Date().toISOString(),
  });
  function validate(value) {
    if (!value || !["actors", "projects", "themes", "relationships", "sources"].every(function (key) { return Array.isArray(value[key]) && value[key].length <= 10000; })) throw new Error("Expected actors, projects, themes, relationships and sources arrays.");
    var records = value.actors.concat(value.projects, value.themes);
    var ids = new Set();
    records.forEach(function (item) {
      if (!item || typeof item.id !== "string" || !/^[a-z0-9-]{1,120}$/.test(item.id) || typeof item.name !== "string" || !item.name.trim() || ids.has(item.id)) throw new Error("Invalid or duplicate record ID/name.");
      if (STATUS_VALUES.indexOf(item.status) === -1) throw new Error("Invalid status.");
      ids.add(item.id);
    });
    value.relationships.forEach(function (rel) {
      if (!rel || !ids.has(rel.sourceId) || !ids.has(rel.targetId) || rel.sourceId === rel.targetId || !Object.prototype.hasOwnProperty.call(D.RELATIONSHIP_META, rel.type)) throw new Error("Invalid relationship endpoints or type.");
      if (STATUS_VALUES.indexOf(rel.status) === -1) throw new Error("Invalid status.");
    });
    value.sources.forEach(function (source) { if (!source || !source.id || !source.name || !source.type) throw new Error("Invalid source record."); });
  }
  function snapshot() {
    try {
      var value = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!value) return clone(defaults);
      value.actors = (value.actors || []).map(migrateLifecycle);
      value.projects = (value.projects || []).map(migrateLifecycle);
      value.relationships = (value.relationships || []).map(migrateLifecycle);
      value.themes = ((value.themes && value.themes.length) ? value.themes : defaults.themes).map(migrateLifecycle);
      value.sources = (value.sources && value.sources.length) ? value.sources : defaults.sources;
      value.audit = Array.isArray(value.audit) ? value.audit : [];
      validate(value);
      return clone(value);
    } catch (error) { return clone(defaults); }
  }
  // What a visitor to the public (non-admin) GitHub Pages page should see: only
  // published records, with relationships additionally self-healed so neither
  // endpoint can ever be a draft/withdrawn/archived record. Mirrors the Node
  // backend's publicData() in backend/server-data.js.
  function publicSnapshot() {
    var full = snapshot();
    function publishedOf(key) {
      return full[key].filter(function (item) { return item.status === "published"; })
        .map(function (item) { return item.publishedSnapshot || metaStrip(item); });
    }
    var actors = publishedOf("actors");
    var projects = publishedOf("projects");
    var themes = publishedOf("themes");
    var publishedIds = new Set(actors.concat(projects, themes).map(function (item) { return item.id; }));
    var relationships = publishedOf("relationships").filter(function (item) { return publishedIds.has(item.sourceId) && publishedIds.has(item.targetId); });
    return clone({ version: full.version, actors: actors, projects: projects, themes: themes, relationships: relationships, sources: full.sources, updatedAt: full.updatedAt, audit: [] });
  }
  function assertPublishable(collection, record, candidate) {
    if (collection !== "relationships") return;
    var publishedIds = new Set(candidate.actors.concat(candidate.projects, candidate.themes)
      .filter(function (item) { return item.status === "published"; }).map(function (item) { return item.id; }));
    if (!publishedIds.has(record.sourceId)) throw new Error("Cannot publish: \"" + record.sourceId + "\" is not published yet.");
    if (!publishedIds.has(record.targetId)) throw new Error("Cannot publish: \"" + record.targetId + "\" is not published yet.");
  }
  async function change(operation, value, id) {
    var session = await Auth.session();
    if (!session.authenticated) throw new Error("Please sign in again before saving.");
    var next = snapshot();
    var key;
    var label = "Demo dataset";
    var action = operation;
    var recordType = "Dataset";
    var upserts = { upsertActor: "actors", upsertProject: "projects", upsertTheme: "themes", upsertRelationship: "relationships", upsertSource: "sources" };
    var deletes = { deleteActor: "actors", deleteProject: "projects", deleteTheme: "themes", deleteRelationship: "relationships", deleteSource: "sources" };
    if (Object.prototype.hasOwnProperty.call(upserts, operation)) {
      key = upserts[operation];
      if (!value || !value.id) throw new Error("A record ID is required.");
      var index = next[key].findIndex(function (item) { return item.id === value.id; });
      var existing = index >= 0 ? next[key][index] : null;
      var incoming = clone(value);
      if (key !== "sources") {
        incoming.status = existing ? existing.status : "draft";
        incoming.publishedSnapshot = existing ? (existing.publishedSnapshot || null) : null;
      }
      if (index < 0) next[key].push(incoming); else next[key][index] = incoming;
      label = value.name || value.sourceId + " → " + value.targetId;
      id = value.id;
      action = index < 0 ? "Created" : "Updated";
      recordType = key;
    } else if (Object.prototype.hasOwnProperty.call(deletes, operation)) {
      key = deletes[operation];
      var record = next[key].filter(function (item) { return item.id === id; })[0];
      if (!record) throw new Error("Record not found.");
      label = record.name || id;
      next[key] = next[key].filter(function (item) { return item.id !== id; });
      if (key === "actors" || key === "projects" || key === "themes") {
        next.relationships = next.relationships.filter(function (item) { return item.sourceId !== id && item.targetId !== id; });
      }
      if (key === "actors") next.projects.forEach(function (project) { if (project.hostId === id) project.hostId = ""; });
      action = "Deleted";
      recordType = key;
    } else if (["publish", "withdraw", "archive", "restore"].indexOf(operation) !== -1) {
      if (!value || LIFECYCLE_COLLECTIONS.indexOf(value.collection) === -1) throw new Error("Invalid collection.");
      key = value.collection;
      var item = next[key].filter(function (entry) { return entry.id === id; })[0];
      if (!item) throw new Error("Record not found.");
      if (operation === "publish") {
        assertPublishable(key, item, next);
        item.publishedSnapshot = metaStrip(item);
        item.status = "published";
        action = "Published";
      } else if (operation === "withdraw") {
        if (item.status !== "published") throw new Error("Only published records can be withdrawn.");
        item.status = "draft";
        action = "Withdrawn";
      } else if (operation === "archive") {
        if (item.status === "archived") throw new Error("Record is already archived.");
        item.status = "archived";
        action = "Archived";
      } else {
        if (item.status !== "archived") throw new Error("Only archived records can be restored.");
        item.status = "draft";
        action = "Restored";
      }
      label = item.name || (item.sourceId ? item.sourceId + " → " + item.targetId : id);
      recordType = key;
    } else if (operation === "importState" || operation === "reset") {
      var input = operation === "reset" ? defaults : value;
      validate(input);
      ["actors", "projects", "themes", "relationships", "sources"].forEach(function (collection) { next[collection] = clone(input[collection]); });
      action = operation === "reset" ? "Reset" : "Imported";
    } else throw new Error("Unknown operation.");
    validate(next);
    next.updatedAt = new Date().toISOString();
    next.audit.unshift({ id: crypto.randomUUID(), timestamp: next.updatedAt, actor: session.username, action: action,
      recordType: recordType, recordId: id || "dataset", label: label, details: "Demo change by " + session.username });
    next.audit = next.audit.slice(0, 100);
    localStorage.setItem(KEY, JSON.stringify(next));
    return clone(next);
  }
  window.RD_DEMO_STORE = { snapshot: snapshot, publicSnapshot: publicSnapshot, change: change };
})();
