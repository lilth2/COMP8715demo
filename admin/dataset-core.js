// Shared dataset core. Runs unchanged in Node (backend/server-data.js) and in the browser
// (admin/demo-store.js, admin/store.js), so GitHub Pages demo mode and the real backend
// apply exactly the same rules for drafts, publishing, deleting and linking.
//
// Data model (version 4)
//   actors / projects / themes   nodes. Each has `status` ("draft" | "published") and, while
//                                published, `publishedSnapshot` = the public copy.
//   relationships                edges, same lifecycle. THEY ARE THE AUTHORITY for links:
//                                  - project -> actor "hosted_by"      defines project.hostId
//                                  - theme <-> node "shares_research_theme" defines node.themes
//                                `hostId` and the theme ids in `themes` are derived from them
//                                (see derive()); only free tags without a theme node are edited
//                                directly on a node.
//   relationshipTypes            reference data, not lifecycle-gated (like sources): stable id,
//                                editable displayName, optional color. Two ids are system types
//                                (hosted_by, shares_research_theme in THEME_LINK/HOST_LINK) and
//                                cannot be renamed, deleted or merged away because derive() and
//                                the public API depend on those exact strings. Any other type is
//                                freeform: created on first use from the admin form, network
//                                editor or bulk import, renamed freely, or merged into another
//                                type before being deleted if it is still referenced.
//   layout.nodes                 { id: {x, y} } Admin graph-editor positions. Abstract canvas
//                                coordinates, unrelated to map/office locations.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (typeof window !== "undefined" ? window : root).RD_CORE = api;
})(this, function () {
  "use strict";
  var VERSION = 4;
  var STATUSES = ["draft", "published"];
  var COLLECTIONS = ["actors", "projects", "themes", "relationships"];
  var NODE_COLLECTIONS = ["actors", "projects", "themes"];
  var ID_ARRAY_FIELDS = ["industryPartners", "relatedFacilities", "keyActorIds", "relatedProjects"];
  var THEME_LINK = "shares_research_theme";
  var HOST_LINK = "hosted_by";
  var TYPE_ID_RE = /^[a-z0-9_-]{1,80}$/;
  var has = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };
  // A readable default color for a relationship type with no explicit one, stable per id.
  var DEFAULT_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#8b1b61", "#5b6472", "#a9720a", "#0f2d52", "#631244"];
  function defaultColor(id) {
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return DEFAULT_PALETTE[hash % DEFAULT_PALETTE.length];
  }

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function canon(value) {
    if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().filter(function (k) { return value[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ":" + canon(value[k]); }).join(",") + "}";
    }
    return JSON.stringify(value);
  }
  function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function strip(record) { var copy = clone(record); delete copy.status; delete copy.publishedSnapshot; return copy; }
  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function fail(message, extra) {
    var error = new Error(message);
    error.status = 400;
    if (extra) Object.keys(extra).forEach(function (k) { error[k] = extra[k]; });
    throw error;
  }
  function hasPendingChanges(record) {
    return Boolean(record && record.status === "published" && record.publishedSnapshot && canon(strip(record)) !== canon(record.publishedSnapshot));
  }

  function createCore(D) {
    // Captured now: the browser store later replaces D.actors etc. with live data.
    var seed = clone({ actors: D.actors, projects: D.projectNodes, themes: D.themeNodes, relationships: D.relationships, sources: D.sources });
    var today = function () { return new Date().toISOString().slice(0, 10); };
    // Seed relationship types from the legacy static RELATIONSHIP_META map (data.js), used only
    // the first time a dataset is created or migrated from a version with no relationshipTypes.
    var seedRelationshipTypes = function () {
      return Object.keys(D.RELATIONSHIP_META).map(function (id) {
        return { id: id, displayName: D.RELATIONSHIP_META[id].label, color: D.RELATIONSHIP_META[id].color || defaultColor(id), isSystem: id === THEME_LINK || id === HOST_LINK };
      });
    };
    function findType(state, id) { return (state.relationshipTypes || []).filter(function (t) { return t.id === id; })[0]; }
    function typeLabel(state, type) { var t = findType(state, type); return t ? t.displayName : type; }

    function findNode(state, id) {
      for (var i = 0; i < NODE_COLLECTIONS.length; i++) {
        var record = state[NODE_COLLECTIONS[i]].find(function (item) { return item.id === id; });
        if (record) return { collection: NODE_COLLECTIONS[i], record: record };
      }
      return null;
    }
    function nameOf(state, id) { var found = findNode(state, id); return found ? found.record.name : id; }
    function relLabel(state, rel) { return nameOf(state, rel.sourceId) + " → " + nameOf(state, rel.targetId) + " (" + typeLabel(state, rel.type) + ")"; }
    function kindWord(collection) { return { actors: "organisation", projects: "project", themes: "theme" }[collection] || "record"; }
    function themeIds(state) { return new Set(state.themes.map(function (t) { return t.id; })); }

    // A relationship that defines a node field: theme tag or project host.
    function linkInfo(state, rel) {
      var a = findNode(state, rel.sourceId), b = findNode(state, rel.targetId);
      if (!a || !b) return null;
      if (rel.type === THEME_LINK) {
        if (a.collection === "themes" && b.collection !== "themes") return { kind: "theme", themeId: a.record.id, nodeId: b.record.id };
        if (b.collection === "themes" && a.collection !== "themes") return { kind: "theme", themeId: b.record.id, nodeId: a.record.id };
      }
      if (rel.type === HOST_LINK && a.collection === "projects" && b.collection === "actors") return { kind: "host", projectId: a.record.id, hostId: b.record.id };
      return null;
    }
    // Managed links touching `node`, with the node's role: "node" = the tagged record / project,
    // "other" = the theme / host organisation at the far end.
    function managedLinksOf(state, node) {
      var result = [];
      state.relationships.forEach(function (rel) {
        var info = linkInfo(state, rel);
        if (!info) return;
        if (info.kind === "theme") {
          if (info.nodeId === node.id) result.push({ rel: rel, role: "node", otherId: info.themeId });
          else if (info.themeId === node.id) result.push({ rel: rel, role: "other", otherId: info.nodeId, info: info });
        } else {
          if (info.projectId === node.id) result.push({ rel: rel, role: "node", otherId: info.hostId });
          else if (info.hostId === node.id) result.push({ rel: rel, role: "other", otherId: info.projectId, info: info });
        }
      });
      return result;
    }
    // Decides what publishing `node` does to one of its managed links.
    //  "publish": the link goes public together with the node
    //  "hidden":  the link stays hidden because the other end is not published
    //  "skip":    nothing to do
    // When the node is the far end (theme / host), the link only goes public if the tagged
    // record's PUBLISHED copy already refers to it; a draft-only tag elsewhere stays private.
    function linkDecision(state, entry, node) {
      var other = findNode(state, entry.otherId);
      if (!other) return "skip";
      if (entry.role === "node") {
        if (other.record.status !== "published") return "hidden";
        return relNeedsPublish(entry.rel) ? "publish" : "skip";
      }
      var snap = other.record.publishedSnapshot;
      if (other.record.status !== "published" || !snap) return "skip";
      var referenced = entry.info.kind === "theme" ? (snap.themes || []).indexOf(node.id) !== -1 : snap.hostId === node.id;
      return referenced && relNeedsPublish(entry.rel) ? "publish" : "skip";
    }

    // Recompute node.hostId / node.themes (working copy) from the relationships.
    function derive(state) {
      var known = themeIds(state);
      var linked = {}, hosts = {};
      state.relationships.forEach(function (rel) {
        var info = linkInfo(state, rel);
        if (!info) return;
        if (info.kind === "theme") (linked[info.nodeId] = linked[info.nodeId] || []).push(info.themeId);
        else if (!has(hosts, info.projectId)) hosts[info.projectId] = info.hostId;
      });
      ["actors", "projects"].forEach(function (key) {
        state[key].forEach(function (node) {
          // Order-stable: keep tags that are free or still linked in their existing order, then
          // append newly linked themes, so untouched records never look edited.
          var links = Array.from(new Set(linked[node.id] || []));
          var kept = (node.themes || []).filter(function (t) { return !known.has(t) || links.indexOf(t) !== -1; });
          links.forEach(function (t) { if (kept.indexOf(t) === -1) kept.push(t); });
          node.themes = kept;
        });
      });
      state.projects.forEach(function (project) { project.hostId = has(hosts, project.id) ? hosts[project.id] : ""; });
    }

    function newLink(state, type, sourceId, targetId, node, status) {
      var base = ("link-" + slug(sourceId + "-" + targetId)).slice(0, 110);
      var used = new Set(state.relationships.map(function (r) { return r.id; }));
      var id = base, n = 2;
      while (used.has(id)) id = base + "-" + (n++);
      var rel = {
        id: id, sourceId: sourceId, targetId: targetId, type: type, intensity: type === HOST_LINK ? "strong" : "weak",
        confidence: node.dataConfidence || "needs-review", lastUpdated: node.lastUpdated || today(),
        evidence: type === HOST_LINK ? "Created from the project's host when relationships became the single source of links." : "Created from the record's theme tag when relationships became the single source of links.",
        status: status,
      };
      if (status === "published") rel.publishedSnapshot = strip(rel);
      state.relationships.push(rel);
      return rel;
    }
    // mode "migrate": new links are published when both ends are (so public filters keep their
    // results). mode "edit": always drafts, published together with the node.
    function ensureLinks(state, node, collection, mode, report) {
      var known = themeIds(state);
      (node.themes || []).forEach(function (tag) {
        if (!known.has(tag)) return;
        var exists = state.relationships.some(function (rel) {
          var info = linkInfo(state, rel);
          return info && info.kind === "theme" && info.themeId === tag && info.nodeId === node.id;
        });
        if (exists) return;
        var theme = state.themes.find(function (t) { return t.id === tag; });
        var live = mode === "migrate" && node.status === "published" && theme.status === "published";
        newLink(state, THEME_LINK, tag, node.id, node, live ? "published" : "draft");
        if (report) report.themeLinksCreated++;
      });
      if (mode === "migrate" && collection === "projects" && node.hostId) {
        var host = state.actors.find(function (a) { return a.id === node.hostId; });
        var hasHost = state.relationships.some(function (rel) { var info = linkInfo(state, rel); return info && info.kind === "host" && info.projectId === node.id; });
        if (host && !hasHost) {
          newLink(state, HOST_LINK, node.id, host.id, node, node.status === "published" && host.status === "published" ? "published" : "draft");
          if (report) report.hostLinksCreated++;
        }
      }
    }

    function lifecycle(record, report) {
      if (!record || typeof record !== "object" || Array.isArray(record)) return record;
      var r = clone(record);
      if (r.status === "archived") { r.status = "draft"; delete r.publishedSnapshot; report.archivedToDraft++; return r; }
      if (STATUSES.indexOf(r.status) !== -1) {
        if (r.status === "draft") delete r.publishedSnapshot;
        else r.publishedSnapshot = r.publishedSnapshot ? strip(r.publishedSnapshot) : strip(r);
        return r;
      }
      var fields = strip(r);
      fields.status = "published";
      fields.publishedSnapshot = clone(fields);
      delete fields.publishedSnapshot.status;
      report.migratedToPublished++;
      return fields;
    }

    function withSourceIds(sources) {
      return sources.map(function (s) { return Object.assign({}, s, { id: s.id || slug(s.type || s.name) }); });
    }
    // Any relationship type referenced by data but missing from relationshipTypes (legacy
    // datasets predating this collection, or a type introduced by a freeform save) is added with
    // a generated label, so nothing ever fails to resolve to a display name.
    function withRelationshipTypes(types, relationships) {
      var list = (types && types.length ? clone(types) : seedRelationshipTypes()).map(function (t) {
        return { id: t.id, displayName: t.displayName || title(t.id), color: t.color || defaultColor(t.id), isSystem: Boolean(t.isSystem) || t.id === THEME_LINK || t.id === HOST_LINK };
      });
      var known = {}; list.forEach(function (t) { known[t.id] = true; });
      (relationships || []).forEach(function (rel) {
        if (rel && rel.type && !known[rel.type]) { known[rel.type] = true; list.push({ id: rel.type, displayName: title(rel.type), color: defaultColor(rel.type), isSystem: false }); }
      });
      return list;
    }
    function title(value) { return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, function (l) { return l.toUpperCase(); }); }

    // Brings any stored dataset (v1 without status, v2 with "archived", v3, v4) to version 4.
    function normalize(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Expected a dataset object.");
      var report = { fromVersion: raw.version || 1, archivedToDraft: 0, migratedToPublished: 0, themeLinksCreated: 0, hostLinksCreated: 0, changed: false };
      var list = function (key) { return Array.isArray(raw[key]) ? raw[key] : []; };
      var state = {
        version: VERSION,
        actors: list("actors").map(function (r) { return lifecycle(r, report); }),
        projects: list("projects").map(function (r) { return lifecycle(r, report); }),
        // Seed themes added to data saved before themes were stored are bookkeeping, not user records.
        themes: (list("themes").length ? list("themes") : seed.themes).map(function (r) { return lifecycle(r, list("themes").length ? report : { archivedToDraft: 0, migratedToPublished: 0 }); }),
        relationships: list("relationships").map(function (r) { return lifecycle(r, report); }),
        relationshipTypes: withRelationshipTypes(list("relationshipTypes"), list("relationships")),
        sources: list("sources").length ? clone(raw.sources) : withSourceIds(clone(seed.sources)),
        layout: { nodes: {} },
        audit: clone(list("audit")),
        importBatches: clone(list("importBatches")),
        updatedAt: raw.updatedAt || new Date().toISOString(),
      };
      if (raw.layout && raw.layout.nodes && typeof raw.layout.nodes === "object") {
        Object.keys(raw.layout.nodes).forEach(function (id) {
          var p = raw.layout.nodes[id];
          if (p && isFinite(p.x) && isFinite(p.y) && /^[a-z0-9-]{1,120}$/.test(id)) state.layout.nodes[id] = { x: Number(p.x), y: Number(p.y) };
        });
      }
      var shaped = state.actors.concat(state.projects, state.themes, state.relationships).every(function (r) { return r && typeof r === "object" && !Array.isArray(r); });
      if (shaped) {
        state.actors.forEach(function (n) { ensureLinks(state, n, "actors", "migrate", report); });
        state.projects.forEach(function (n) { ensureLinks(state, n, "projects", "migrate", report); });
        derive(state);
        var live = new Set(state.actors.concat(state.projects, state.themes).map(function (n) { return n.id; }));
        Object.keys(state.layout.nodes).forEach(function (id) { if (!live.has(id)) delete state.layout.nodes[id]; });
      }
      report.changed = report.fromVersion !== VERSION || report.archivedToDraft + report.migratedToPublished + report.themeLinksCreated + report.hostLinksCreated > 0;
      if (report.changed && raw.version !== undefined && report.fromVersion !== VERSION) {
        state.audit.unshift({ id: uid(), timestamp: new Date().toISOString(), actor: "system", action: "Migrated", recordType: "Dataset", recordId: "dataset", label: "Dataset upgraded to version " + VERSION,
          details: "Legacy retired records kept as drafts: " + report.archivedToDraft + "; links created from tags/hosts: " + (report.themeLinksCreated + report.hostLinksCreated) });
        state.audit = state.audit.slice(0, 100);
      }
      return { state: state, report: report };
    }

    function defaults() {
      return normalize({ version: 0, actors: seed.actors, projects: seed.projects, themes: seed.themes, relationships: seed.relationships, relationshipTypes: seedRelationshipTypes(), sources: withSourceIds(seed.sources), audit: [] }).state;
    }

    // ---------------------------------------------------------------- validation
    function text(value, field, required) {
      if (typeof value !== "string" || value.length > 10000 || (required && !value.trim())) fail("Invalid " + field + ".");
    }
    function checkId(value) { if (typeof value !== "string" || !/^[a-z0-9-]{1,120}$/.test(value)) fail("Invalid record ID."); }
    function checkNode(value, collection) {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid record.");
      checkId(value.id); text(value.name, "name", true); text(value.summary, "summary", true);
      if (STATUSES.indexOf(value.status) === -1) fail("Invalid status.");
      if (value.status === "published" && (!value.publishedSnapshot || typeof value.publishedSnapshot !== "object")) fail("A published record must have a published copy.");
      if (!has(D.CONFIDENCE_META, value.dataConfidence)) fail("Invalid confidence level.");
      if (value.state && !D.STATES.some(function (s) { return s.code === value.state; })) fail("Invalid state.");
      if (collection !== "themes" && (!Array.isArray(value.themes) || value.themes.some(function (t) { return typeof t !== "string"; }))) fail("Invalid theme IDs.");
      if (value.lastUpdated && !/^\d{4}-\d{2}-\d{2}$/.test(value.lastUpdated)) fail("Invalid review date.");
      if (collection === "actors" && (!has(D.TYPE_META, value.type) || ["research_theme", "project_initiative"].indexOf(value.type) !== -1)) fail("Invalid organisation type.");
      if (collection === "projects" && value.type !== "project_initiative") fail("Invalid project type.");
      if (collection === "themes" && value.type !== "research_theme") fail("Invalid theme type.");
      if (value.sourceNotes && (!Array.isArray(value.sourceNotes) || value.sourceNotes.some(function (t) { return typeof t !== "string"; }))) fail("Invalid source notes.");
      if (value.sectors && (!Array.isArray(value.sectors) || value.sectors.some(function (t) { return typeof t !== "string"; }))) fail("Invalid sectors.");
      if (value.offices !== undefined) {
        if (!Array.isArray(value.offices) || value.offices.length > 50) fail("Invalid offices.");
        value.offices.forEach(function (o) {
          if (!o || ["head", "branch"].indexOf(o.role) === -1 || !D.STATES.some(function (s) { return s.code === o.state; }) ||
            (o.city !== undefined && (typeof o.city !== "string" || o.city.length > 200)) ||
            (o.focus !== undefined && (typeof o.focus !== "string" || o.focus.length > 2000))) fail("Invalid office. Use role head/branch, a valid state, and text city/focus.");
        });
      }
      if (value.website) {
        var okUrl = false;
        try { okUrl = ["https:", "http:"].indexOf(new URL(value.website).protocol) !== -1; } catch (e) { okUrl = false; }
        if (!okUrl) fail("Invalid website URL.");
      }
    }
    function checkRelationshipType(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid relationship type.");
      if (typeof value.id !== "string" || !TYPE_ID_RE.test(value.id)) fail("Invalid relationship type ID.");
      text(value.displayName, "relationship type name", true);
      if (value.color !== undefined && value.color !== null && (typeof value.color !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(value.color))) fail("Invalid relationship type color.");
    }
    function validate(value) {
      if (!value || ["actors", "projects", "themes", "relationships", "sources", "relationshipTypes"].some(function (k) { return !Array.isArray(value[k]) || value[k].length > 10000; })) fail("Expected actors, projects, themes, relationships, relationshipTypes and sources arrays.");
      value.actors.forEach(function (n) { checkNode(n, "actors"); });
      value.projects.forEach(function (n) { checkNode(n, "projects"); });
      value.themes.forEach(function (n) { checkNode(n, "themes"); });
      value.relationshipTypes.forEach(checkRelationshipType);
      var typeIds = new Set(value.relationshipTypes.map(function (t) { return t.id; }));
      if (typeIds.size !== value.relationshipTypes.length) fail("Duplicate relationship type IDs.");
      if (!typeIds.has(THEME_LINK) || !typeIds.has(HOST_LINK)) fail("The system relationship types are missing.");
      var nodes = value.actors.concat(value.projects, value.themes);
      var ids = new Set(nodes.map(function (n) { return n.id; }));
      if (ids.size !== nodes.length) fail("Organisation, project and theme IDs must be unique.");
      var hosted = {};
      value.relationships.forEach(function (rel) {
        checkId(rel.id);
        if (STATUSES.indexOf(rel.status) === -1) fail("Invalid status.");
        if (rel.status === "published" && (!rel.publishedSnapshot || typeof rel.publishedSnapshot !== "object")) fail("A published record must have a published copy.");
        if (!ids.has(rel.sourceId) || !ids.has(rel.targetId) || rel.sourceId === rel.targetId) fail("A relationship must connect two existing, different records.");
        if (!typeIds.has(rel.type) || !has(D.CONFIDENCE_META, rel.confidence) || ["weak", "medium", "strong"].indexOf(rel.intensity) === -1) fail("Invalid relationship classification.");
        text(rel.evidence || "", "evidence");
        if (rel.type === HOST_LINK) {
          var s = nodes.find(function (n) { return n.id === rel.sourceId; }), t = nodes.find(function (n) { return n.id === rel.targetId; });
          if (value.projects.indexOf(s) === -1 || value.actors.indexOf(t) === -1) fail("A “Hosted by” relationship must go from a project to an organisation.");
          if (hosted[rel.sourceId]) fail("\"" + s.name + "\" already has a host. Delete its existing “Hosted by” relationship before adding another.");
          hosted[rel.sourceId] = true;
        }
      });
      value.sources.forEach(function (s) { checkId(s.id); text(s.name, "source name", true); text(s.type, "source type", true); text(s.notes, "source notes", true); });
      ["relationships", "sources"].forEach(function (k) { if (new Set(value[k].map(function (i) { return i.id; })).size !== value[k].length) fail("Duplicate " + k + " IDs."); });
      if (value.layout !== undefined) {
        if (!value.layout || typeof value.layout.nodes !== "object" || Array.isArray(value.layout.nodes)) fail("Invalid layout.");
        Object.keys(value.layout.nodes).forEach(function (id) {
          var p = value.layout.nodes[id];
          if (!ids.has(id) || !p || !isFinite(p.x) || !isFinite(p.y) || Math.abs(p.x) > 1e5 || Math.abs(p.y) > 1e5) fail("Invalid layout position.");
        });
      }
    }

    // ------------------------------------------------------------ publish planning
    function relNeedsPublish(rel) { return rel.status !== "published" || hasPendingChanges(rel); }
    // What publishing `id` will do, computed once and used both for the confirmation text and
    // for the operation itself, so the dialog can never disagree with the result.
    function describePublish(state, collection, id) {
      if (COLLECTIONS.indexOf(collection) === -1) fail("Invalid collection.");
      var record = state[collection].find(function (r) { return r.id === id; });
      if (!record) fail("Record not found.");
      var blockers = [], alsoPublish = [], hiddenLinks = [];
      if (collection === "relationships") {
        [record.sourceId, record.targetId].forEach(function (endId) {
          var f = findNode(state, endId);
          if (f && f.record.status !== "published") blockers.push({ collection: f.collection, id: endId, name: f.record.name, status: f.record.status, kind: kindWord(f.collection) });
        });
      } else {
        managedLinksOf(state, record).forEach(function (entry) {
          var decision = linkDecision(state, entry, record);
          if (decision === "publish") alsoPublish.push({ id: entry.rel.id, label: relLabel(state, entry.rel) });
          else if (decision === "hidden") hiddenLinks.push({ id: entry.rel.id, label: relLabel(state, entry.rel), reason: "\"" + nameOf(state, entry.otherId) + "\" is not published" });
        });
      }
      return { collection: collection, id: id, record: record, isUpdate: record.status === "published", pending: hasPendingChanges(record), blockers: blockers, alsoPublish: alsoPublish, hiddenLinks: hiddenLinks };
    }
    function blockedMessage(plan) {
      return "Cannot publish this relationship yet: " + plan.blockers.map(function (b) { return "\"" + b.name + "\" (" + b.kind + ", " + b.status + ")"; }).join(" and ") +
        (plan.blockers.length > 1 ? " are" : " is") + " not published. Publish " + (plan.blockers.length > 1 ? "them" : "it") + " first, or publish them together with the relationship.";
    }
    function publishRecord(record) { record.publishedSnapshot = strip(record); record.status = "published"; }
    function publishNodeWithLinks(next, collection, record) {
      // Decide against the state BEFORE this node's own snapshot changes, exactly as
      // describePublish does for the confirmation text.
      var decisions = managedLinksOf(next, record).map(function (entry) { return { entry: entry, decision: linkDecision(next, entry, record) }; });
      publishRecord(record);
      decisions.forEach(function (d) { if (d.decision === "publish") publishRecord(d.entry.rel); });
    }

    function scrubReferences(next, id) {
      NODE_COLLECTIONS.forEach(function (key) {
        next[key].forEach(function (node) {
          [node, node.publishedSnapshot].forEach(function (rec) {
            if (!rec) return;
            ID_ARRAY_FIELDS.forEach(function (f) { if (Array.isArray(rec[f])) rec[f] = rec[f].filter(function (x) { return x !== id; }); });
            if (Array.isArray(rec.themes)) rec.themes = rec.themes.filter(function (x) { return x !== id; });
            if (rec.hostId === id) rec.hostId = "";
          });
        });
      });
    }

    // -------------------------------------------------------------- bulk import planning
    var BULK_COLLECTIONS = ["actors", "projects", "themes", "relationships"];
    var REQUIRED_FIELDS = {
      actors: ["name", "type", "summary"], projects: ["name", "summary"], themes: ["name", "summary"],
      relationships: ["sourceId", "targetId", "type"],
    };
    function bulkRowKey(collection, row) {
      return collection === "relationships" ? (row && row.id) : (row && row.id);
    }
    // Resolves a source/target cell that may be an existing id OR a plain organisation/project/
    // theme name (so bulk rows pasted from a spreadsheet can reference records by name without
    // the operator having to know internal ids). Ambiguous or missing names are reported, never
    // guessed.
    function resolveNodeRef(state, raw, newRowsById) {
      var text = String(raw || "").trim();
      if (!text) return { error: "missing" };
      var byId = findNode(state, text) || (newRowsById[text] ? { record: newRowsById[text] } : null);
      if (byId) return { id: text };
      var nodes = state.actors.concat(state.projects, state.themes).map(function (n) { return { id: n.id, name: n.name }; })
        .concat(Object.keys(newRowsById).map(function (id) { return { id: id, name: newRowsById[id].name }; }));
      var matches = nodes.filter(function (n) { return n.name.toLowerCase() === text.toLowerCase(); });
      if (matches.length === 1) return { id: matches[0].id };
      if (matches.length > 1) return { error: "ambiguous", matches: matches.map(function (m) { return m.id; }) };
      return { error: "not-found" };
    }
    // Pure planning function shared by the preview (read-only) and the actual commit, so the
    // preview counts can never disagree with what committing will do. `rows` are partial records
    // in upsert shape (same fields the single-record admin forms submit), each tagged with the
    // 1-based `sourceRow` it came from (spreadsheet/paste row number) for error messages.
    function planBulkUpsert(state, collection, mode, rows) {
      if (BULK_COLLECTIONS.indexOf(collection) === -1) fail("Invalid collection for bulk import.");
      if (["add-only", "update-by-id"].indexOf(mode) === -1) fail("Invalid import mode.");
      if (!Array.isArray(rows) || rows.length === 0) fail("No rows to import.");
      if (rows.length > 5000) fail("Too many rows in one import (maximum 5000).");
      var existingIds = new Set((state[collection] || []).map(function (r) { return r.id; }));
      var newRowsById = {}; // id -> partial record, for cross-row name resolution within this same batch
      var seenInBatch = {};
      var planned = rows.map(function (row, index) {
        var sourceRow = row && row.sourceRow != null ? row.sourceRow : index + 1;
        var errors = [];
        var warnings = [];
        var id = row && typeof row.id === "string" ? row.id.trim() : "";
        (REQUIRED_FIELDS[collection] || []).forEach(function (f) {
          if (collection === "relationships") return; // relationship refs are checked below, with name resolution
          if (!row || row[f] === undefined || row[f] === null || String(row[f]).trim() === "") errors.push("Missing required field \"" + f + "\".");
        });
        var action = null, resolvedId = id;
        if (mode === "update-by-id") {
          if (!id) errors.push("Row has no ID to update.");
          else if (!existingIds.has(id)) errors.push("No existing record with ID \"" + id + "\" to update.");
          else action = "updated";
        } else { // add-only
          if (id && existingIds.has(id)) errors.push("ID \"" + id + "\" already exists. Use \"update by ID\" mode to change an existing record, or remove the ID to create a new one.");
          else action = "created";
        }
        if (!id && mode === "add-only" && row && row.name) resolvedId = slug(row.name);
        if (collection === "relationships") {
          ["sourceId", "targetId"].forEach(function (field) {
            var resolved = resolveNodeRef(state, row && row[field === "sourceId" ? "source" : "target"] !== undefined ? row[field === "sourceId" ? "source" : "target"] : (row && row[field]), newRowsById);
            if (resolved.error === "missing") errors.push((field === "sourceId" ? "From" : "To") + " organisation/project/theme is required.");
            else if (resolved.error === "ambiguous") errors.push((field === "sourceId" ? "From" : "To") + " \"" + (row[field === "sourceId" ? "source" : "target"] || row[field]) + "\" matches more than one record; use its ID instead of its name.");
            else if (resolved.error === "not-found") errors.push((field === "sourceId" ? "From" : "To") + " \"" + (row[field === "sourceId" ? "source" : "target"] || row[field]) + "\" was not found. Create it first or check spelling.");
            else row[field] = resolved.id;
          });
          if (row.sourceId && row.targetId && row.sourceId === row.targetId) errors.push("From and To must be different records.");
          if (!row.type || !String(row.type).trim()) errors.push("Relationship type is required.");
          // A relationship row with no explicit ID gets one generated from its (now-resolved)
          // endpoints and type, exactly like the single-record admin form (admin/store.js).
          if (!id && mode === "add-only" && !errors.length) resolvedId = ("rel-" + slug(row.sourceId + "-" + row.type + "-" + row.targetId)).slice(0, 120);
        }
        if (resolvedId && seenInBatch[resolvedId]) errors.push("Duplicate ID \"" + resolvedId + "\" within this import.");
        if (resolvedId) seenInBatch[resolvedId] = true;
        if (action && !errors.length && mode === "add-only" && collection !== "relationships") newRowsById[resolvedId || id] = row;
        return { sourceRow: sourceRow, id: resolvedId || id, action: errors.length ? "error" : action, errors: errors, warnings: warnings, row: row };
      });
      var counts = { created: 0, updated: 0, skipped: 0, errors: 0 };
      planned.forEach(function (p) {
        if (p.action === "error") counts.errors++;
        else if (p.action === "created") counts.created++;
        else if (p.action === "updated") counts.updated++;
        else counts.skipped++;
      });
      return { collection: collection, mode: mode, rows: planned, counts: counts, canCommit: counts.errors === 0 };
    }

    // Single-record upsert, shared by the upsertActor/upsertProject/upsertTheme/upsertRelationship/
    // upsertSource operations AND bulkUpsert, so a bulk-imported row is created/updated through
    // exactly the same path (draft-by-default, host/theme link derivation, validation) as a row
    // saved from the one-record admin form.
    function upsertOne(next, key, value) {
      var incoming = clone(value);
      var index = next[key].findIndex(function (i) { return i.id === incoming.id; });
      var existing = index >= 0 ? next[key][index] : null;
      if (key !== "sources") {
        delete incoming.status; delete incoming.publishedSnapshot;
        incoming.status = existing ? existing.status : "draft";
        if (existing && existing.publishedSnapshot) incoming.publishedSnapshot = existing.publishedSnapshot;
        if (key === "projects") incoming.hostId = existing ? existing.hostId : "";
      }
      if (index < 0) next[key].push(incoming); else next[key][index] = incoming;
      if (key === "actors" || key === "projects") ensureLinks(next, incoming, key, "edit");
      return { id: incoming.id, created: index < 0, label: incoming.name || (incoming.sourceId ? relLabel(next, incoming) : incoming.id) };
    }

    // What deleting (or withdrawing) a record touches; used for the confirmation text.
    function impactOf(state, collection, id) {
      var record = (state[collection] || []).find(function (r) { return r.id === id; });
      if (!record) fail("Record not found.");
      if (collection === "relationships") {
        return { record: record, name: relLabel(state, record), published: record.status === "published", relationships: [], hostedProjects: [], taggedRecords: [] };
      }
      return {
        record: record, name: record.name, published: record.status === "published",
        relationships: state.relationships.filter(function (r) { return r.sourceId === id || r.targetId === id; })
          .map(function (r) { return { id: r.id, label: relLabel(state, r), status: r.status }; }),
        hostedProjects: collection === "actors" ? state.projects.filter(function (p) { return p.hostId === id; }).map(function (p) { return { id: p.id, name: p.name }; }) : [],
        taggedRecords: collection === "themes" ? state.actors.concat(state.projects).filter(function (n) { return (n.themes || []).indexOf(id) !== -1; }).map(function (n) { return { id: n.id, name: n.name }; }) : [],
      };
    }

    // Aggregated impact across several ids at once, for a batch-action confirmation dialog: every
    // relationship/hosted-project/tagged-record touched by ANY of the selected records, de-duplicated.
    function batchImpactOf(state, collection, ids) {
      var seenRel = {}, seenHosted = {}, seenTagged = {};
      var relationships = [], hostedProjects = [], taggedRecords = [];
      var publishedCount = 0, names = [];
      ids.forEach(function (id) {
        var one = impactOf(state, collection, id);
        names.push(one.name);
        if (one.published) publishedCount++;
        one.relationships.forEach(function (r) { if (!seenRel[r.id]) { seenRel[r.id] = true; relationships.push(r); } });
        one.hostedProjects.forEach(function (p) { if (!seenHosted[p.id]) { seenHosted[p.id] = true; hostedProjects.push(p); } });
        one.taggedRecords.forEach(function (n) { if (!seenTagged[n.id]) { seenTagged[n.id] = true; taggedRecords.push(n); } });
      });
      return { count: ids.length, names: names, publishedCount: publishedCount, relationships: relationships, hostedProjects: hostedProjects, taggedRecords: taggedRecords };
    }
    // Fields a batch edit may safely set in bulk, per collection — deliberately a narrow,
    // explicit allowlist (not "any field"), so a batch edit can never be used to smuggle in
    // id/status/publishedSnapshot changes outside the normal publish/withdraw/delete operations.
    var BATCH_EDITABLE_FIELDS = {
      actors: ["state", "dataConfidence", "sectors", "website"],
      projects: ["state", "dataConfidence"],
      themes: ["dataConfidence"],
      relationships: ["confidence", "intensity", "evidence"],
    };

    // ---------------------------------------------------------------------- apply
    function apply(state, operation, value, recordId, username) {
      var next = clone(state);
      next.layout = next.layout || { nodes: {} };
      var label = "Directory dataset", action = operation, recordType = "Dataset", audited = true, touched = true;
      var upserts = { upsertActor: "actors", upsertProject: "projects", upsertTheme: "themes", upsertRelationship: "relationships", upsertSource: "sources" };
      var deletes = { deleteActor: "actors", deleteProject: "projects", deleteTheme: "themes", deleteRelationship: "relationships", deleteSource: "sources" };

      if (has(upserts, operation)) {
        var key = upserts[operation];
        if (!value || typeof value !== "object" || Array.isArray(value)) fail("Missing record.");
        checkId(value.id);
        var upsertResult = upsertOne(next, key, value);
        label = upsertResult.label;
        action = upsertResult.created ? "Created" : "Updated";
        recordId = upsertResult.id; recordType = key;
      } else if (operation === "bulkUpsert") {
        if (!value || BULK_COLLECTIONS.indexOf(value.collection) === -1) fail("Invalid collection for bulk import.");
        // A fingerprint ties this commit to the exact uploaded file + sheet + mode (computed by
        // the caller from the file bytes; see backend/import). Resubmitting the identical file is
        // recognised and refused here rather than silently creating duplicate records — the
        // admin sees "already imported" and can choose to proceed only by explicitly changing
        // something (e.g. switching mode), not by accident.
        if (value.fingerprint && next.importBatches.some(function (b) { return b.fingerprint === value.fingerprint; })) {
          fail("This exact file (and sheet/mode) was already imported on " + next.importBatches.filter(function (b) { return b.fingerprint === value.fingerprint; })[0].importedAt + ". Re-importing it again would risk duplicate records; choose a different file or mode, or ask an administrator to review the prior import batch.", { code: "duplicate-import" });
        }
        var bulkPlan = planBulkUpsert(next, value.collection, value.mode, value.rows);
        if (!bulkPlan.canCommit) fail("This import has " + bulkPlan.counts.errors + " row error(s) and cannot be committed. Fix or remove those rows first.", { code: "bulk-errors", plan: bulkPlan });
        var bulkCreated = 0, bulkUpdated = 0;
        var batchId = uid();
        var importRows = [];
        bulkPlan.rows.forEach(function (p) {
          if (p.action !== "created" && p.action !== "updated") { importRows.push({ sourceRow: p.sourceRow, recordId: null, outcome: "skipped", detail: p.errors.join("; ") || null }); return; }
          var rowValue = clone(p.row);
          rowValue.id = p.id;
          if (value.collection === "relationships") {
            var typedType = String(rowValue.type || "").trim();
            var resolvedType = next.relationshipTypes.find(function (t) { return t.id === typedType || t.displayName.toLowerCase() === typedType.toLowerCase(); });
            rowValue.type = resolvedType ? resolvedType.id : slug(typedType);
            if (!resolvedType) next.relationshipTypes.push({ id: rowValue.type, displayName: typedType, color: defaultColor(rowValue.type), isSystem: false });
            rowValue.confidence = rowValue.confidence || "needs-review";
            rowValue.intensity = rowValue.intensity || "weak";
            rowValue.evidence = rowValue.evidence || "";
          } else {
            if (value.collection === "actors") rowValue.type = rowValue.type || "crc";
            if (value.collection === "projects") rowValue.type = "project_initiative";
            if (value.collection === "themes") rowValue.type = "research_theme";
            rowValue.dataConfidence = rowValue.dataConfidence || "needs-review";
            rowValue.themes = Array.isArray(rowValue.themes) ? rowValue.themes : [];
            rowValue.summary = rowValue.summary || "";
          }
          var result = upsertOne(next, value.collection, rowValue);
          if (result.created) bulkCreated++; else bulkUpdated++;
          importRows.push({ sourceRow: p.sourceRow, recordId: result.id, outcome: result.created ? "created" : "updated", detail: null });
        });
        next.importBatches = next.importBatches || [];
        next.importBatches.unshift({
          id: batchId, collection: value.collection, mode: value.mode, fingerprint: value.fingerprint || null,
          sourceFilename: value.sourceFilename || null, sheetName: value.sheetName || null,
          importedBy: username, importedAt: new Date().toISOString(),
          rowCount: bulkPlan.rows.length, createdCount: bulkCreated, updatedCount: bulkUpdated,
          skippedCount: bulkPlan.rows.length - bulkCreated - bulkUpdated, rows: importRows,
        });
        next.importBatches = next.importBatches.slice(0, 200);
        label = "Bulk import: " + value.collection; recordType = value.collection; recordId = batchId;
        action = "Bulk imported (" + bulkCreated + " created, " + bulkUpdated + " updated)";
        if (!bulkCreated && !bulkUpdated) { audited = false; touched = false; }
      } else if (operation === "bulkAction") {
        // value: { collection, ids: [...], action: "publish"|"withdraw"|"delete"|"setField",
        //          withDependencies, field, fieldValue }. All-or-nothing: if ANY id fails (not
        // found, or a relationship blocked from publishing), the whole batch is rejected before
        // anything is changed — never a silent partial batch.
        if (!value || BULK_COLLECTIONS.indexOf(value.collection) === -1) fail("Invalid collection for bulk action.");
        var bKey = value.collection;
        var bIds = Array.isArray(value.ids) ? value.ids : [];
        if (!bIds.length) fail("No records selected.");
        if (bIds.length > 2000) fail("Too many records selected in one batch (maximum 2000).");
        var missing = bIds.filter(function (id) { return !next[bKey].some(function (r) { return r.id === id; }); });
        if (missing.length) fail("Record(s) not found: " + missing.join(", "), { code: "not-found", ids: missing });

        if (value.action === "publish") {
          var blockedIds = [];
          bIds.forEach(function (id) {
            var plan = describePublish(next, bKey, id);
            if (plan.blockers.length && !value.withDependencies) blockedIds.push(id);
          });
          if (blockedIds.length) fail("Some selected relationships connect records that are not published yet. Publish them together, or publish the endpoints first.", { code: "blocked", ids: blockedIds });
          bIds.forEach(function (id) {
            var plan = describePublish(next, bKey, id);
            plan.blockers.forEach(function (b) { publishNodeWithLinks(next, b.collection, next[b.collection].find(function (r) { return r.id === b.id; })); });
            var target = next[bKey].find(function (r) { return r.id === id; });
            if (bKey === "relationships") publishRecord(target); else publishNodeWithLinks(next, bKey, target);
          });
          action = "Bulk published"; recordType = bKey;
        } else if (value.action === "withdraw") {
          var notPublished = bIds.filter(function (id) { return next[bKey].find(function (r) { return r.id === id; }).status !== "published"; });
          if (notPublished.length) fail("Some selected records are already drafts (only published records can be withdrawn).", { code: "not-published", ids: notPublished });
          bIds.forEach(function (id) {
            var target = next[bKey].find(function (r) { return r.id === id; });
            target.status = "draft"; delete target.publishedSnapshot;
          });
          action = "Bulk withdrawn"; recordType = bKey;
        } else if (value.action === "delete") {
          bIds.forEach(function (id) {
            if (NODE_COLLECTIONS.indexOf(bKey) !== -1) {
              next.relationships = next.relationships.filter(function (r) { return r.sourceId !== id && r.targetId !== id; });
              scrubReferences(next, id);
              delete next.layout.nodes[id];
            }
          });
          next[bKey] = next[bKey].filter(function (r) { return bIds.indexOf(r.id) === -1; });
          action = "Bulk deleted"; recordType = bKey;
        } else if (value.action === "setField") {
          var allowed = BATCH_EDITABLE_FIELDS[bKey] || [];
          if (allowed.indexOf(value.field) === -1) fail("\"" + value.field + "\" cannot be batch-edited for " + bKey + ". Allowed fields: " + allowed.join(", "));
          bIds.forEach(function (id) {
            var target = next[bKey].find(function (r) { return r.id === id; });
            target[value.field] = value.fieldValue;
          });
          action = "Bulk edited " + value.field; recordType = bKey;
        } else fail("Unknown bulk action.");
        label = bIds.length + " " + bKey; recordId = undefined;
      } else if (operation === "upsertRelationshipType") {
        if (!value || typeof value !== "object" || typeof value.id !== "string") fail("Missing relationship type.");
        var typeId = value.id.trim() ? value.id.trim() : slug(value.displayName);
        if (!TYPE_ID_RE.test(typeId)) fail("Invalid relationship type ID.");
        var existingType = next.relationshipTypes.find(function (t) { return t.id === typeId; });
        var displayName = String(value.displayName || "").trim();
        if (!displayName) fail("A relationship type needs a name.");
        if (existingType) {
          existingType.displayName = displayName;
          if (value.color) existingType.color = value.color;
          action = "Renamed";
        } else {
          next.relationshipTypes.push({ id: typeId, displayName: displayName, color: value.color || defaultColor(typeId), isSystem: false });
          action = "Created";
        }
        label = displayName; recordId = typeId; recordType = "relationshipTypes";
      } else if (operation === "deleteRelationshipType") {
        var delType = next.relationshipTypes.find(function (t) { return t.id === recordId; });
        if (!delType) fail("Relationship type not found.");
        if (delType.isSystem) fail("\"" + delType.displayName + "\" is a system relationship type and cannot be deleted.");
        var inUse = next.relationships.some(function (r) { return r.type === recordId; });
        if (inUse) {
          var mergeInto = value && value.mergeInto;
          if (!mergeInto || !next.relationshipTypes.some(function (t) { return t.id === mergeInto; })) {
            fail("\"" + delType.displayName + "\" is used by one or more relationships. Merge it into another type before deleting it.", { code: "in-use", typeId: recordId });
          }
          if (mergeInto === recordId) fail("Choose a different relationship type to merge into.");
          next.relationships.forEach(function (r) {
            if (r.type === recordId) { r.type = mergeInto; if (r.publishedSnapshot) r.publishedSnapshot.type = mergeInto; }
          });
        }
        next.relationshipTypes = next.relationshipTypes.filter(function (t) { return t.id !== recordId; });
        label = delType.displayName; recordType = "relationshipTypes"; action = "Deleted";
      } else if (has(deletes, operation)) {
        var dkey = deletes[operation];
        var item = next[dkey].find(function (i) { return i.id === recordId; });
        if (!item) fail("Record not found.");
        label = item.name || relLabel(next, item);
        if (NODE_COLLECTIONS.indexOf(dkey) !== -1) {
          next.relationships = next.relationships.filter(function (r) { return r.sourceId !== recordId && r.targetId !== recordId; });
          scrubReferences(next, recordId);
          delete next.layout.nodes[recordId];
        }
        next[dkey] = next[dkey].filter(function (i) { return i.id !== recordId; });
        action = "Deleted"; recordType = dkey;
      } else if (operation === "publish" || operation === "withdraw") {
        if (!value || COLLECTIONS.indexOf(value.collection) === -1) fail("Invalid collection.");
        var pkey = value.collection;
        var target = next[pkey].find(function (i) { return i.id === recordId; });
        if (!target) fail("Record not found.");
        label = target.name || relLabel(next, target);
        if (operation === "publish") {
          var plan = describePublish(next, pkey, recordId);
          if (plan.blockers.length) {
            if (!value.withDependencies) fail(blockedMessage(plan), { code: "blocked", blockers: plan.blockers });
            plan.blockers.forEach(function (b) { publishNodeWithLinks(next, b.collection, next[b.collection].find(function (r) { return r.id === b.id; })); });
          }
          if (pkey === "relationships") publishRecord(target); else publishNodeWithLinks(next, pkey, target);
          action = "Published";
        } else {
          if (target.status !== "published") fail("Only published records can be withdrawn.");
          target.status = "draft"; delete target.publishedSnapshot;
          action = "Withdrawn";
        }
        recordType = pkey;
      } else if (operation === "setLayout") {
        audited = false; touched = false;
        var v = value || {};
        if (v.reset === true) next.layout = { nodes: {} };
        if (v.positions && typeof v.positions === "object") {
          Object.keys(v.positions).forEach(function (id) {
            var p = v.positions[id];
            if (!findNode(next, id)) fail("Unknown record in layout.");
            if (!p || !isFinite(p.x) || !isFinite(p.y) || Math.abs(p.x) > 1e5 || Math.abs(p.y) > 1e5) fail("Invalid layout position.");
            next.layout.nodes[id] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
          });
        }
      } else if (operation === "importState" || operation === "reset") {
        var input;
        if (operation === "reset") input = defaults();
        else {
          if (!value || typeof value !== "object" || ["actors", "projects", "relationships", "sources"].some(function (k) { return !Array.isArray(value[k]); })) fail("Expected actors, projects, relationships and sources arrays.");
          input = normalize(value).state;
        }
        validate(input);
        ["actors", "projects", "themes", "relationships", "relationshipTypes", "sources"].forEach(function (k) { next[k] = clone(input[k]); });
        next.layout = clone(input.layout);
        action = operation === "reset" ? "Reset" : "Imported";
      } else fail("Unknown operation.");

      derive(next);
      validate(next);
      if (touched) next.updatedAt = new Date().toISOString();
      if (audited) {
        next.audit.unshift({ id: uid(), timestamp: next.updatedAt, actor: username, action: action, recordType: recordType, recordId: recordId || "dataset", label: label, details: "Saved by " + username });
        next.audit = next.audit.slice(0, 100);
      }
      return next;
    }

    // ----------------------------------------------------------------- public view
    // Everything visitors may see, derived only from published records. Host and theme tags
    // come from PUBLISHED relationships whose two ends are both published, so a node can never
    // show a host/theme/edge that the graph does not.
    function publicData(state) {
      var published = function (key) { return state[key].filter(function (i) { return i.status === "published"; }); };
      var snap = function (item) { return clone(item.publishedSnapshot || strip(item)); };
      var pubNodes = published("actors").concat(published("projects"), published("themes"));
      var pubIds = new Set(pubNodes.map(function (n) { return n.id; }));
      var relationships = published("relationships").map(snap).filter(function (r) { return pubIds.has(r.sourceId) && pubIds.has(r.targetId); });
      var known = themeIds(state);
      var isTheme = function (id) { return known.has(id); };
      function sanitize(node, collection) {
        ID_ARRAY_FIELDS.forEach(function (f) { if (Array.isArray(node[f])) node[f] = node[f].filter(function (x) { return pubIds.has(x); }); });
        if (collection === "themes") return node;
        var linked = [], host = "";
        relationships.forEach(function (r) {
          if (r.type === THEME_LINK) {
            if (r.sourceId === node.id && isTheme(r.targetId)) linked.push(r.targetId);
            else if (r.targetId === node.id && isTheme(r.sourceId)) linked.push(r.sourceId);
          }
          if (collection === "projects" && r.type === HOST_LINK && r.sourceId === node.id && !host) host = r.targetId;
        });
        node.themes = (node.themes || []).filter(function (t) { return !known.has(t); }).concat(Array.from(new Set(linked)));
        if (collection === "projects") node.hostId = host;
        return node;
      }
      return clone({
        version: state.version,
        actors: published("actors").map(function (n) { return sanitize(snap(n), "actors"); }),
        projects: published("projects").map(function (n) { return sanitize(snap(n), "projects"); }),
        themes: published("themes").map(function (n) { return sanitize(snap(n), "themes"); }),
        relationships: relationships, relationshipTypes: state.relationshipTypes, sources: state.sources, updatedAt: state.updatedAt,
      });
    }

    return { VERSION: VERSION, defaults: defaults, normalize: normalize, validate: validate, apply: apply, publicData: publicData,
      describePublish: describePublish, impactOf: impactOf, hasPendingChanges: hasPendingChanges, nameOf: nameOf, relLabel: relLabel, typeLabel: typeLabel, findNode: findNode, managedLinksOf: managedLinksOf,
      planBulkUpsert: planBulkUpsert, batchImpactOf: batchImpactOf, batchEditableFields: BATCH_EDITABLE_FIELDS };
  }

  return { createCore: createCore, strip: strip, canon: canon, hasPendingChanges: hasPendingChanges };
});
