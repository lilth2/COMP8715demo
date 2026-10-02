"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const clone = value => JSON.parse(JSON.stringify(value));
const slug = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function createDataStore(dataPath) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8"), context);
  const D = context.window.RD_DATA;
  const defaults = clone({ version: 1, actors: D.actors, projects: D.projectNodes, relationships: D.relationships, sources: D.sources.map(source => ({ ...source, id: slug(source.type || source.name) })), audit: [], updatedAt: new Date().toISOString() });
  let state = dataPath && fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, "utf8")) : clone(defaults);
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  function text(value, field, required = false) {
    if (typeof value !== "string" || value.length > 10000 || (required && !value.trim())) fail("Invalid " + field + ".");
  }
  function id(value) { if (typeof value !== "string" || !/^[a-z0-9-]{1,120}$/.test(value)) fail("Invalid record ID."); }
  function node(value, collection) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid record.");
    id(value.id); text(value.name, "name", true); text(value.summary, "summary", true);
    if (!Object.hasOwn(D.CONFIDENCE_META, value.dataConfidence)) fail("Invalid confidence level.");
    if (value.state && !D.STATES.some(item => item.code === value.state)) fail("Invalid state.");
    if (!Array.isArray(value.themes) || value.themes.some(item => typeof item !== "string")) fail("Invalid theme IDs.");
    if (value.lastUpdated && !/^\d{4}-\d{2}-\d{2}$/.test(value.lastUpdated)) fail("Invalid review date.");
    if (collection === "actors" && (!Object.hasOwn(D.TYPE_META, value.type) || ["research_theme", "project_initiative"].includes(value.type))) fail("Invalid organisation type.");
    if (collection === "projects" && value.type !== "project_initiative") fail("Invalid project type.");
    if (value.sourceNotes && (!Array.isArray(value.sourceNotes) || value.sourceNotes.some(item => typeof item !== "string"))) fail("Invalid source notes.");
    if (value.sectors && (!Array.isArray(value.sectors) || value.sectors.some(item => typeof item !== "string"))) fail("Invalid sectors.");
    if (value.website) { try { if (!["https:", "http:"].includes(new URL(value.website).protocol)) fail("Invalid website URL."); } catch { fail("Invalid website URL."); } }
  }
  function validate(value) {
    if (!value || !["actors", "projects", "relationships", "sources"].every(key => Array.isArray(value[key]) && value[key].length <= 10000)) fail("Expected actors, projects, relationships and sources arrays.");
    value.actors.forEach(item => node(item, "actors"));
    value.projects.forEach(item => node(item, "projects"));
    const nodes = [...value.actors, ...value.projects, ...D.themeNodes];
    const ids = new Set(nodes.map(item => item.id));
    if (ids.size !== nodes.length) fail("Organisation, project and theme IDs must be unique.");
    for (const project of value.projects) if (project.hostId && !value.actors.some(item => item.id === project.hostId)) fail("Unknown project host.");
    for (const relation of value.relationships) {
      id(relation.id);
      if (!ids.has(relation.sourceId) || !ids.has(relation.targetId) || relation.sourceId === relation.targetId) fail("A relationship must connect two existing, different records.");
      if (!Object.hasOwn(D.RELATIONSHIP_META, relation.type) || !Object.hasOwn(D.CONFIDENCE_META, relation.confidence) || !["weak", "medium", "strong"].includes(relation.intensity)) fail("Invalid relationship classification.");
      text(relation.evidence || "", "evidence");
    }
    for (const source of value.sources) { id(source.id); text(source.name, "source name", true); text(source.type, "source type", true); text(source.notes, "source notes", true); }
    for (const key of ["relationships", "sources"]) if (new Set(value[key].map(item => item.id)).size !== value[key].length) fail("Duplicate " + key + " IDs.");
  }
  validate(state);
  function publicData() { const { audit, ...result } = state; return clone(result); }
  function apply(operation, value, recordId, username) {
    const next = clone(state);
    let label = "Directory dataset";
    let action = operation;
    const upserts = { upsertActor: "actors", upsertProject: "projects", upsertRelationship: "relationships", upsertSource: "sources" };
    const deletes = { deleteActor: "actors", deleteProject: "projects", deleteRelationship: "relationships", deleteSource: "sources" };
    if (Object.hasOwn(upserts, operation)) {
      const key = upserts[operation];
      if (!value || typeof value !== "object") fail("Missing record.");
      id(value.id);
      const index = next[key].findIndex(item => item.id === value.id);
      if (index < 0) next[key].push(clone(value)); else next[key][index] = clone(value);
      label = value.name || value.sourceId + " → " + value.targetId;
      action = index < 0 ? "Created" : "Updated";
      recordId = value.id;
    } else if (Object.hasOwn(deletes, operation)) {
      const key = deletes[operation];
      const item = next[key].find(item => item.id === recordId);
      if (!item) fail("Record not found.");
      label = item.name || recordId;
      next[key] = next[key].filter(item => item.id !== recordId);
      if (key === "actors" || key === "projects") next.relationships = next.relationships.filter(item => item.sourceId !== recordId && item.targetId !== recordId);
      if (key === "actors") next.projects.forEach(item => { if (item.hostId === recordId) item.hostId = ""; });
      action = "Deleted";
    } else if (operation === "importState" || operation === "reset") {
      const input = operation === "reset" ? defaults : value;
      validate(input);
      for (const key of ["actors", "projects", "relationships", "sources"]) next[key] = clone(input[key]);
      action = operation === "reset" ? "Reset" : "Imported";
    } else fail("Unknown operation.");
    validate(next);
    next.updatedAt = new Date().toISOString();
    next.audit.unshift({ id: randomUUID(), timestamp: next.updatedAt, actor: username, action, recordType: upserts[operation] || deletes[operation] || "Dataset", recordId: recordId || "dataset", label, details: "Saved by " + username });
    next.audit = next.audit.slice(0, 100);
    if (dataPath) {
      fs.mkdirSync(path.dirname(dataPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(dataPath + ".tmp", JSON.stringify(next), { mode: 0o600 });
      fs.renameSync(dataPath + ".tmp", dataPath);
    }
    state = next;
    return clone(state);
  }
  return { snapshot: () => clone(state), publicData, apply };
}
module.exports = { createDataStore };
