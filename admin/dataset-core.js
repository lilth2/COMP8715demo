// Shared dataset core. Runs unchanged in Node (backend/server-data.js) and in the browser
// (admin/demo-store.js, admin/store.js), so GitHub Pages demo mode and the real backend
// apply exactly the same rules for drafts, publishing, deleting and linking.
//
// Data model (version 3)
//   actors / projects / themes   nodes. Each has `status` ("draft" | "published") and, while
//                                published, `publishedSnapshot` = the public copy.
//   relationships                edges, same lifecycle. THEY ARE THE AUTHORITY for links:
//                                  - project -> actor "hosted_by"      defines project.hostId
//                                  - theme <-> node "shares_research_theme" defines node.themes
//                                `hostId` and the theme ids in `themes` are derived from them
//                                (see derive()); only free tags without a theme node are edited
//                                directly on a node.
//   layout.nodes                 { id: {x, y} } Admin graph-editor positions. Abstract canvas
//                                coordinates, unrelated to map/office locations.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (typeof window !== "undefined" ? window : root).RD_CORE = api;
})(this, function () {
  "use strict";
  var VERSION = 3;
  var STATUSES = ["draft", "published"];
  var COLLECTIONS = ["actors", "projects", "themes", "relationships"];
  var NODE_COLLECTIONS = ["actors", "projects", "themes"];
  var ID_ARRAY_FIELDS = ["industryPartners", "relatedFacilities", "keyActorIds", "relatedProjects"];
  var THEME_LINK = "shares_research_theme";
  var HOST_LINK = "hosted_by";
  var has = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };

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
    var typeLabel = function (type) { return (D.RELATIONSHIP_META[type] || {}).label || type; };

    function findNode(state, id) {
      for (var i = 0; i < NODE_COLLECTIONS.length; i++) {
        var record = state[NODE_COLLECTIONS[i]].find(function (item) { return item.id === id; });
        if (record) return { collection: NODE_COLLECTIONS[i], record: record };
      }
      return null;
    }
    function nameOf(state, id) { var found = findNode(state, id); return found ? found.record.name : id; }
    function relLabel(state, rel) { return nameOf(state, rel.sourceId) + " → " + nameOf(state, rel.targetId) + " (" + typeLabel(rel.type) + ")"; }
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

    // Brings any stored dataset (v1 without status, v2 with "archived", v3) to version 3.
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
        sources: list("sources").length ? clone(raw.sources) : withSourceIds(clone(seed.sources)),
        layout: { nodes: {} },
        audit: clone(list("audit")),
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
      return normalize({ version: 0, actors: seed.actors, projects: seed.projects, themes: seed.themes, relationships: seed.relationships, sources: withSourceIds(seed.sources), audit: [] }).state;
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
    function validate(value) {
      if (!value || ["actors", "projects", "themes", "relationships", "sources"].some(function (k) { return !Array.isArray(value[k]) || value[k].length > 10000; })) fail("Expected actors, projects, themes, relationships and sources arrays.");
      value.actors.forEach(function (n) { checkNode(n, "actors"); });
      value.projects.forEach(function (n) { checkNode(n, "projects"); });
      value.themes.forEach(function (n) { checkNode(n, "themes"); });
      var nodes = value.actors.concat(value.projects, value.themes);
      var ids = new Set(nodes.map(function (n) { return n.id; }));
      if (ids.size !== nodes.length) fail("Organisation, project and theme IDs must be unique.");
      var hosted = {};
      value.relationships.forEach(function (rel) {
        checkId(rel.id);
        if (STATUSES.indexOf(rel.status) === -1) fail("Invalid status.");
        if (rel.status === "published" && (!rel.publishedSnapshot || typeof rel.publishedSnapshot !== "object")) fail("A published record must have a published copy.");
        if (!ids.has(rel.sourceId) || !ids.has(rel.targetId) || rel.sourceId === rel.targetId) fail("A relationship must connect two existing, different records.");
        if (!has(D.RELATIONSHIP_META, rel.type) || !has(D.CONFIDENCE_META, rel.confidence) || ["weak", "medium", "strong"].indexOf(rel.intensity) === -1) fail("Invalid relationship classification.");
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
        label = incoming.name || (incoming.sourceId ? relLabel(next, incoming) : incoming.id);
        action = index < 0 ? "Created" : "Updated";
        recordId = incoming.id; recordType = key;
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
        ["actors", "projects", "themes", "relationships", "sources"].forEach(function (k) { next[k] = clone(input[k]); });
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
        relationships: relationships, sources: state.sources, updatedAt: state.updatedAt,
      });
    }

    return { VERSION: VERSION, defaults: defaults, normalize: normalize, validate: validate, apply: apply, publicData: publicData,
      describePublish: describePublish, impactOf: impactOf, hasPendingChanges: hasPendingChanges, nameOf: nameOf, relLabel: relLabel, findNode: findNode, managedLinksOf: managedLinksOf };
  }

  return { createCore: createCore, strip: strip, canon: canon, hasPendingChanges: hasPendingChanges };
});
