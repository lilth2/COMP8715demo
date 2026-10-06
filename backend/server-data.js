"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const clone = value => JSON.parse(JSON.stringify(value));
const slug = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Lifecycle: every actor / project / theme / relationship record carries a
// `status` plus a `publishedSnapshot` of the fields that are actually public.
// Editing a record only ever touches its live (draft) fields; the public API
// keeps serving `publishedSnapshot` until an explicit "publish" operation
// copies the current fields over it. This is what lets an admin edit a
// published record without instantly changing what visitors see.
const STATUS_VALUES = ["draft", "published", "archived"];
const LIFECYCLE_COLLECTIONS = ["actors", "projects", "themes", "relationships"];

function metaStrip(record) {
  const result = clone(record);
  delete result.status;
  delete result.publishedSnapshot;
  return result;
}

// Brings a record from before the draft/publish workflow existed (no
// `status` field) forward: it was effectively "live" already, so it is
// migrated in as published with its current fields as the published
// snapshot. Nothing that was previously visible disappears.
function migrateLifecycle(record) {
  if (record && STATUS_VALUES.includes(record.status)) return record;
  const fields = metaStrip(record || {});
  return { ...fields, status: "published", publishedSnapshot: clone(fields) };
}

function createDataStore(dataPath) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8"), context);
  const D = context.window.RD_DATA;
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

  const defaults = clone({
    version: 2,
    actors: D.actors.map(migrateLifecycle),
    projects: D.projectNodes.map(migrateLifecycle),
    themes: D.themeNodes.map(migrateLifecycle),
    relationships: D.relationships.map(migrateLifecycle),
    sources: D.sources.map(source => ({ ...source, id: slug(source.type || source.name) })),
    audit: [],
    updatedAt: new Date().toISOString(),
  });

  let state = dataPath && fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, "utf8")) : clone(defaults);
  // Before an older-format file (no `version: 2`) is migrated and later overwritten,
  // keep an untouched copy beside it so the migration is recoverable.
  if (dataPath && fs.existsSync(dataPath) && state.version !== 2) {
    const backup = dataPath + ".pre-publish-workflow.bak";
    if (!fs.existsSync(backup)) fs.copyFileSync(dataPath, backup);
  }
  // Normalise/migrate whatever was loaded: older persisted datasets predate
  // `status`/`publishedSnapshot` and the `themes` collection entirely.
  state.actors = (state.actors || []).map(migrateLifecycle);
  state.projects = (state.projects || []).map(migrateLifecycle);
  state.relationships = (state.relationships || []).map(migrateLifecycle);
  state.themes = ((state.themes && state.themes.length) ? state.themes : defaults.themes).map(migrateLifecycle);
  state.sources = (state.sources && state.sources.length) ? state.sources : defaults.sources;
  state.audit = state.audit || [];
  state.version = 2;

  function text(value, field, required = false) {
    if (typeof value !== "string" || value.length > 10000 || (required && !value.trim())) fail("Invalid " + field + ".");
  }
  function id(value) { if (typeof value !== "string" || !/^[a-z0-9-]{1,120}$/.test(value)) fail("Invalid record ID."); }
  function node(value, collection) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid record.");
    id(value.id); text(value.name, "name", true); text(value.summary, "summary", true);
    if (!STATUS_VALUES.includes(value.status)) fail("Invalid status.");
    if (!Object.hasOwn(D.CONFIDENCE_META, value.dataConfidence)) fail("Invalid confidence level.");
    if (value.state && !D.STATES.some(item => item.code === value.state)) fail("Invalid state.");
    if (collection !== "themes") {
      if (!Array.isArray(value.themes) || value.themes.some(item => typeof item !== "string")) fail("Invalid theme IDs.");
    }
    if (value.lastUpdated && !/^\d{4}-\d{2}-\d{2}$/.test(value.lastUpdated)) fail("Invalid review date.");
    if (collection === "actors" && (!Object.hasOwn(D.TYPE_META, value.type) || ["research_theme", "project_initiative"].includes(value.type))) fail("Invalid organisation type.");
    if (collection === "projects" && value.type !== "project_initiative") fail("Invalid project type.");
    if (collection === "themes" && value.type !== "research_theme") fail("Invalid theme type.");
    if (value.sourceNotes && (!Array.isArray(value.sourceNotes) || value.sourceNotes.some(item => typeof item !== "string"))) fail("Invalid source notes.");
    if (value.sectors && (!Array.isArray(value.sectors) || value.sectors.some(item => typeof item !== "string"))) fail("Invalid sectors.");
    if (value.offices !== undefined) {
      if (!Array.isArray(value.offices) || value.offices.length > 50) fail("Invalid offices.");
      for (const office of value.offices) {
        if (!office || !["head", "branch"].includes(office.role) || !D.STATES.some(item => item.code === office.state) ||
          (office.city !== undefined && (typeof office.city !== "string" || office.city.length > 200)) ||
          (office.focus !== undefined && (typeof office.focus !== "string" || office.focus.length > 2000))) fail("Invalid office. Use role head/branch, a valid state, and text city/focus.");
      }
    }
    if (value.website) { try { if (!["https:", "http:"].includes(new URL(value.website).protocol)) fail("Invalid website URL."); } catch { fail("Invalid website URL."); } }
  }
  function validate(value) {
    if (!value || !["actors", "projects", "themes", "relationships", "sources"].every(key => Array.isArray(value[key]) && value[key].length <= 10000)) fail("Expected actors, projects, themes, relationships and sources arrays.");
    value.actors.forEach(item => node(item, "actors"));
    value.projects.forEach(item => node(item, "projects"));
    value.themes.forEach(item => node(item, "themes"));
    const nodes = [...value.actors, ...value.projects, ...value.themes];
    const ids = new Set(nodes.map(item => item.id));
    if (ids.size !== nodes.length) fail("Organisation, project and theme IDs must be unique.");
    for (const project of value.projects) if (project.hostId && !value.actors.some(item => item.id === project.hostId)) fail("Unknown project host.");
    for (const relation of value.relationships) {
      id(relation.id);
      if (!STATUS_VALUES.includes(relation.status)) fail("Invalid status.");
      if (!ids.has(relation.sourceId) || !ids.has(relation.targetId) || relation.sourceId === relation.targetId) fail("A relationship must connect two existing, different records.");
      if (!Object.hasOwn(D.RELATIONSHIP_META, relation.type) || !Object.hasOwn(D.CONFIDENCE_META, relation.confidence) || !["weak", "medium", "strong"].includes(relation.intensity)) fail("Invalid relationship classification.");
      text(relation.evidence || "", "evidence");
    }
    for (const source of value.sources) { id(source.id); text(source.name, "source name", true); text(source.type, "source type", true); text(source.notes, "source notes", true); }
    for (const key of ["relationships", "sources"]) if (new Set(value[key].map(item => item.id)).size !== value[key].length) fail("Duplicate " + key + " IDs.");
  }
  validate(state);

  // A relationship may only go public once both the relationship itself and
  // the records it connects have been published. Checked at publish time so
  // the error is immediate and actionable for whoever clicked "Publish".
  function assertPublishable(collection, record, candidate) {
    if (collection !== "relationships") return;
    const publishedIds = new Set([...candidate.actors, ...candidate.projects, ...candidate.themes]
      .filter(item => item.status === "published").map(item => item.id));
    if (!publishedIds.has(record.sourceId)) fail("Cannot publish: \"" + record.sourceId + "\" is not published yet.");
    if (!publishedIds.has(record.targetId)) fail("Cannot publish: \"" + record.targetId + "\" is not published yet.");
  }

  function publicData() {
    function publishedOf(key) {
      return state[key].filter(item => item.status === "published").map(item => item.publishedSnapshot || metaStrip(item));
    }
    const actors = publishedOf("actors");
    const projects = publishedOf("projects");
    const themes = publishedOf("themes");
    const publishedIds = new Set([...actors, ...projects, ...themes].map(item => item.id));
    // Self-healing: if either endpoint is later withdrawn or archived, the
    // relationship stops being public automatically — no dangling edges,
    // and no need to cascade-write anything when an entity is unpublished.
    const relationships = publishedOf("relationships").filter(item => publishedIds.has(item.sourceId) && publishedIds.has(item.targetId));
    return clone({ version: state.version, actors, projects, themes, relationships, sources: state.sources, updatedAt: state.updatedAt });
  }

  function apply(operation, value, recordId, username) {
    const next = clone(state);
    let label = "Directory dataset";
    let action = operation;
    let recordType = "Dataset";
    const upserts = { upsertActor: "actors", upsertProject: "projects", upsertTheme: "themes", upsertRelationship: "relationships", upsertSource: "sources" };
    const deletes = { deleteActor: "actors", deleteProject: "projects", deleteTheme: "themes", deleteRelationship: "relationships", deleteSource: "sources" };

    if (Object.hasOwn(upserts, operation)) {
      const key = upserts[operation];
      if (!value || typeof value !== "object") fail("Missing record.");
      id(value.id);
      const index = next[key].findIndex(item => item.id === value.id);
      const existing = index >= 0 ? next[key][index] : null;
      const incoming = clone(value);
      if (key !== "sources") {
        // Saving only ever updates the draft/working fields. Status and the
        // published snapshot are untouched here — that is what keeps "save
        // draft" on a published record from instantly changing what is public.
        incoming.status = existing ? existing.status : "draft";
        incoming.publishedSnapshot = existing ? (existing.publishedSnapshot || null) : null;
      }
      if (index < 0) next[key].push(incoming); else next[key][index] = incoming;
      label = value.name || (value.sourceId ? value.sourceId + " → " + value.targetId : value.id);
      action = index < 0 ? "Created" : "Updated";
      recordId = value.id;
      recordType = key;
    } else if (Object.hasOwn(deletes, operation)) {
      const key = deletes[operation];
      const item = next[key].find(item => item.id === recordId);
      if (!item) fail("Record not found.");
      label = item.name || (item.sourceId ? item.sourceId + " → " + item.targetId : recordId);
      next[key] = next[key].filter(item => item.id !== recordId);
      if (key === "actors" || key === "projects" || key === "themes") {
        next.relationships = next.relationships.filter(item => item.sourceId !== recordId && item.targetId !== recordId);
      }
      if (key === "actors") next.projects.forEach(item => { if (item.hostId === recordId) item.hostId = ""; });
      action = "Deleted";
      recordType = key;
    } else if (["publish", "withdraw", "archive", "restore"].includes(operation)) {
      if (!value || !LIFECYCLE_COLLECTIONS.includes(value.collection)) fail("Invalid collection.");
      const key = value.collection;
      const item = next[key].find(item => item.id === recordId);
      if (!item) fail("Record not found.");
      if (operation === "publish") {
        assertPublishable(key, item, next);
        item.publishedSnapshot = metaStrip(item);
        item.status = "published";
        action = "Published";
      } else if (operation === "withdraw") {
        if (item.status !== "published") fail("Only published records can be withdrawn.");
        item.status = "draft";
        action = "Withdrawn";
      } else if (operation === "archive") {
        if (item.status === "archived") fail("Record is already archived.");
        item.status = "archived";
        action = "Archived";
      } else {
        if (item.status !== "archived") fail("Only archived records can be restored.");
        item.status = "draft";
        action = "Restored";
      }
      label = item.name || (item.sourceId ? item.sourceId + " → " + item.targetId : recordId);
      recordType = key;
    } else if (operation === "importState" || operation === "reset") {
      const input = operation === "reset" ? defaults : value;
      validate(input);
      for (const key of ["actors", "projects", "themes", "relationships", "sources"]) next[key] = clone(input[key]);
      action = operation === "reset" ? "Reset" : "Imported";
    } else fail("Unknown operation.");

    validate(next);
    next.updatedAt = new Date().toISOString();
    next.audit.unshift({ id: randomUUID(), timestamp: next.updatedAt, actor: username, action, recordType, recordId: recordId || "dataset", label, details: "Saved by " + username });
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
module.exports = { createDataStore, STATUS_VALUES };
