(function () {
  "use strict";

  var D = window.RD_DATA;
  if (!D) return;

  var DATA_KEY = "rd-directory-admin-data-v1";
  var AUDIT_KEY = "rd-directory-admin-audit-v1";
  var MAX_AUDIT_ITEMS = 100;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function slug(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "record";
  }

  function replaceArray(target, source) {
    target.splice.apply(target, [0, target.length].concat(clone(source)));
  }

  function sourceId(source) {
    return source.id || slug(source.type || source.name);
  }

  function prepareSource(source) {
    var result = clone(source);
    result.id = sourceId(result);
    return result;
  }

  var defaults = {
    version: 1,
    actors: clone(D.actors),
    projects: clone(D.projectNodes),
    relationships: clone(D.relationships),
    sources: D.sources.map(prepareSource),
    updatedAt: new Date().toISOString(),
  };

  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : clone(fallback);
    } catch (error) {
      return clone(fallback);
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function validState(value) {
    return value && Array.isArray(value.actors) && Array.isArray(value.relationships) && Array.isArray(value.sources);
  }

  var saved = readJSON(DATA_KEY, defaults);
  var state = validState(saved) ? saved : clone(defaults);
  if (!Array.isArray(state.projects)) state.projects = clone(defaults.projects);
  state.sources = state.sources.map(prepareSource);
  var audit = readJSON(AUDIT_KEY, []);
  if (!Array.isArray(audit)) audit = [];

  function apply() {
    replaceArray(D.actors, state.actors);
    replaceArray(D.projectNodes, state.projects);
    replaceArray(D.relationships, state.relationships);
    replaceArray(D.sources, state.sources);
    replaceArray(D.allNodes, D.actors.concat(D.themeNodes, D.projectNodes));
    D.regions.forEach(function (region) {
      var inState = D.actors.filter(function (actor) { return actor.state === region.code; });
      region.crcCount = inState.filter(function (actor) { return actor.type === "crc"; }).length;
      region.ncrisCount = inState.filter(function (actor) { return actor.type === "ncris_facility"; }).length;
      region.orgCount = inState.length;
      region.capabilityDensity = inState.length >= 4 ? "high" : (inState.length >= 1 ? "medium" : "low");
      region.collaborationLinks = D.relationships.filter(function (relationship) {
        var source = D.allNodes.filter(function (node) { return node.id === relationship.sourceId; })[0];
        var target = D.allNodes.filter(function (node) { return node.id === relationship.targetId; })[0];
        return (source && source.state === region.code) || (target && target.state === region.code);
      }).length;
    });
  }

  function persist() {
    state.updatedAt = new Date().toISOString();
    writeJSON(DATA_KEY, state);
    writeJSON(AUDIT_KEY, audit);
    apply();
    window.dispatchEvent(new CustomEvent("rd-admin-data-changed", { detail: snapshot() }));
  }

  function addAudit(action, recordType, recordId, label, details) {
    audit.unshift({
      id: "audit-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      timestamp: new Date().toISOString(),
      actor: "Directory administrator",
      action: action,
      recordType: recordType,
      recordId: recordId,
      label: label || recordId,
      details: details || "",
    });
    audit = audit.slice(0, MAX_AUDIT_ITEMS);
  }

  function snapshot() {
    return {
      version: state.version,
      actors: clone(state.actors),
      projects: clone(state.projects),
      relationships: clone(state.relationships),
      sources: clone(state.sources),
      audit: clone(audit),
      updatedAt: state.updatedAt,
    };
  }

  function findActor(id) {
    return state.actors.filter(function (item) { return item.id === id; })[0] || null;
  }

  function upsertActor(actor) {
    var next = clone(actor);
    next.id = next.id || slug(next.name);
    next.sectors = Array.isArray(next.sectors) ? next.sectors : [];
    next.themes = Array.isArray(next.themes) ? next.themes : [];
    next.sourceNotes = Array.isArray(next.sourceNotes) ? next.sourceNotes : [];
    next.offices = Array.isArray(next.offices) ? next.offices : [];
    next.lastUpdated = next.lastUpdated || new Date().toISOString().slice(0, 10);
    var index = state.actors.findIndex(function (item) { return item.id === next.id; });
    var action = index >= 0 ? "Updated" : "Created";
    if (index >= 0) state.actors[index] = next;
    else state.actors.push(next);
    addAudit(action, "Organisation", next.id, next.name, "Confidence: " + (next.dataConfidence || "not set"));
    persist();
    return clone(next);
  }

  function deleteActor(id) {
    var item = findActor(id);
    if (!item) return false;
    state.actors = state.actors.filter(function (actor) { return actor.id !== id; });
    var removedRelationships = state.relationships.filter(function (rel) { return rel.sourceId === id || rel.targetId === id; }).length;
    state.relationships = state.relationships.filter(function (rel) { return rel.sourceId !== id && rel.targetId !== id; });
    addAudit("Archived", "Organisation", id, item.name, removedRelationships ? "Also removed " + removedRelationships + " linked relationship(s)." : "Removed from the published directory.");
    persist();
    return true;
  }

  function findProject(id) {
    return state.projects.filter(function (item) { return item.id === id; })[0] || null;
  }

  function upsertProject(project) {
    var next = clone(project);
    next.id = next.id || slug(next.name);
    next.type = "project_initiative";
    next.themes = Array.isArray(next.themes) ? next.themes : [];
    next.lastUpdated = next.lastUpdated || new Date().toISOString().slice(0, 10);
    var index = state.projects.findIndex(function (item) { return item.id === next.id; });
    var action = index >= 0 ? "Updated" : "Created";
    if (index >= 0) state.projects[index] = next;
    else state.projects.push(next);
    addAudit(action, "Project", next.id, next.name, "Confidence: " + (next.dataConfidence || "not set"));
    persist();
    return clone(next);
  }

  function deleteProject(id) {
    var item = findProject(id);
    if (!item) return false;
    state.projects = state.projects.filter(function (project) { return project.id !== id; });
    var removedRelationships = state.relationships.filter(function (rel) { return rel.sourceId === id || rel.targetId === id; }).length;
    state.relationships = state.relationships.filter(function (rel) { return rel.sourceId !== id && rel.targetId !== id; });
    addAudit("Archived", "Project", id, item.name, removedRelationships ? "Also removed " + removedRelationships + " linked relationship(s)." : "Removed from the published directory.");
    persist();
    return true;
  }

  function upsertRelationship(relationship) {
    var next = clone(relationship);
    next.id = next.id || "rel-" + slug(next.sourceId + "-" + next.type + "-" + next.targetId);
    var index = state.relationships.findIndex(function (item) { return item.id === next.id; });
    var action = index >= 0 ? "Updated" : "Created";
    if (index >= 0) state.relationships[index] = next;
    else state.relationships.push(next);
    addAudit(action, "Relationship", next.id, next.sourceId + " → " + next.targetId, next.type || "");
    persist();
    return clone(next);
  }

  function deleteRelationship(id) {
    var item = state.relationships.filter(function (rel) { return rel.id === id; })[0];
    if (!item) return false;
    state.relationships = state.relationships.filter(function (rel) { return rel.id !== id; });
    addAudit("Deleted", "Relationship", id, item.sourceId + " → " + item.targetId, item.type || "");
    persist();
    return true;
  }

  function upsertSource(source) {
    var next = prepareSource(source);
    var index = state.sources.findIndex(function (item) { return sourceId(item) === next.id; });
    var action = index >= 0 ? "Updated" : "Created";
    if (index >= 0) state.sources[index] = next;
    else state.sources.push(next);
    addAudit(action, "Source", next.id, next.name, next.type || "");
    persist();
    return clone(next);
  }

  function deleteSource(id) {
    var item = state.sources.filter(function (source) { return sourceId(source) === id; })[0];
    if (!item) return false;
    state.sources = state.sources.filter(function (source) { return sourceId(source) !== id; });
    addAudit("Deleted", "Source", id, item.name, item.type || "");
    persist();
    return true;
  }

  function reset() {
    state = clone(defaults);
    audit = [];
    addAudit("Reset", "Dataset", "demo-data", "Demo dataset", "Restored the original repository data.");
    persist();
  }

  function importState(value) {
    if (!validState(value)) throw new Error("The file does not contain actors, relationships and sources arrays.");
    state = {
      version: 1,
      actors: clone(value.actors),
      projects: Array.isArray(value.projects) ? clone(value.projects) : clone(defaults.projects),
      relationships: clone(value.relationships),
      sources: value.sources.map(prepareSource),
      updatedAt: new Date().toISOString(),
    };
    addAudit("Imported", "Dataset", "admin-import", "Imported dataset", state.actors.length + " organisations, " + state.relationships.length + " relationships.");
    persist();
  }

  apply();

  window.RD_ADMIN_STORE = {
    snapshot: snapshot,
    findActor: findActor,
    upsertActor: upsertActor,
    deleteActor: deleteActor,
    findProject: findProject,
    upsertProject: upsertProject,
    deleteProject: deleteProject,
    upsertRelationship: upsertRelationship,
    deleteRelationship: deleteRelationship,
    upsertSource: upsertSource,
    deleteSource: deleteSource,
    reset: reset,
    importState: importState,
  };
})();
