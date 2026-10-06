(function () {
  "use strict";
  var D = window.RD_DATA;
  var Auth = window.RD_ADMIN_AUTH;
  if (!D || !Auth) return;
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function replaceArray(target, source) { target.splice.apply(target, [0, target.length].concat(clone(source || []))); }
  function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  var state = { version: 1, actors: clone(D.actors), projects: clone(D.projectNodes), themes: clone(D.themeNodes), relationships: clone(D.relationships), sources: clone(D.sources), audit: [] };
  function apply(value) {
    state = value;
    state.audit = state.audit || [];
    replaceArray(D.actors, state.actors);
    replaceArray(D.projectNodes, state.projects);
    replaceArray(D.themeNodes, state.themes);
    replaceArray(D.relationships, state.relationships);
    replaceArray(D.sources, state.sources);
    replaceArray(D.allNodes, D.actors.concat(D.themeNodes, D.projectNodes));
    D.regions.forEach(function (region) {
      var inState = D.actors.filter(function (actor) { return actor.state === region.code; });
      region.crcCount = inState.filter(function (actor) { return actor.type === "crc"; }).length;
      region.ncrisCount = inState.filter(function (actor) { return actor.type === "ncris_facility"; }).length;
      region.orgCount = inState.length;
      region.capabilityDensity = inState.length >= 4 ? "high" : (inState.length >= 1 ? "medium" : "low");
      region.decarbHotspot = inState.filter(function (actor) { return (actor.themes || []).indexOf("decarbonisation") !== -1; }).length >= 3;
      region.collaborationLinks = D.relationships.filter(function (relationship) {
        var source = D.allNodes.filter(function (node) { return node.id === relationship.sourceId; })[0];
        var target = D.allNodes.filter(function (node) { return node.id === relationship.targetId; })[0];
        return (source && source.state === region.code) || (target && target.state === region.code);
      }).length;
    });
    window.dispatchEvent(new CustomEvent("rd-admin-data-changed"));
  }
  var isAdmin = /\/admin\/(?:index\.html)?$/.test(window.location.pathname);
  async function change(operation, value, id) {
    if (Auth.isDemo()) {
      apply(await window.RD_DEMO_STORE.change(operation, value, id));
      return clone(state);
    }
    apply(await Auth.request("api/admin/action", { operation: operation, value: value, id: id }));
    return clone(state);
  }
  function find(collection, id) { return clone(state[collection].filter(function (item) { return item.id === id; })[0] || null); }
  var store = {
    snapshot: function () { return clone(state); },
    findActor: function (id) { return find("actors", id); },
    findProject: function (id) { return find("projects", id); },
    findTheme: function (id) { return find("themes", id); },
    findRelationship: function (id) { return find("relationships", id); },
    upsertActor: function (actor) {
      var value = Object.assign({ sectors: [], themes: [], offices: [], sourceNotes: [] }, actor);
      value.id = value.id || slug(value.name);
      return change("upsertActor", value);
    },
    upsertProject: function (project) {
      var value = Object.assign({ themes: [] }, project);
      value.id = value.id || slug(value.name);
      return change("upsertProject", value);
    },
    upsertTheme: function (theme) {
      var value = Object.assign({ type: "research_theme" }, theme);
      value.id = value.id || slug(value.name);
      return change("upsertTheme", value);
    },
    upsertRelationship: function (rel) {
      var value = clone(rel);
      value.id = value.id || "rel-" + slug(value.sourceId + "-" + value.type + "-" + value.targetId);
      return change("upsertRelationship", value);
    },
    upsertSource: function (source) {
      var value = clone(source);
      value.id = value.id || slug(value.type || value.name);
      return change("upsertSource", value);
    },
    deleteActor: function (id) { return change("deleteActor", undefined, id); },
    deleteProject: function (id) { return change("deleteProject", undefined, id); },
    deleteTheme: function (id) { return change("deleteTheme", undefined, id); },
    deleteRelationship: function (id) { return change("deleteRelationship", undefined, id); },
    deleteSource: function (id) { return change("deleteSource", undefined, id); },
    publish: function (collection, id) { return change("publish", { collection: collection }, id); },
    withdraw: function (collection, id) { return change("withdraw", { collection: collection }, id); },
    archiveRecord: function (collection, id) { return change("archive", { collection: collection }, id); },
    restoreRecord: function (collection, id) { return change("restore", { collection: collection }, id); },
    // Relationships (in either status) that reference this record — used by the
    // admin UI to warn before an archive/withdraw/delete hides or removes edges.
    relationshipsTouching: function (id) {
      return state.relationships.filter(function (item) { return item.sourceId === id || item.targetId === id; });
    },
    reset: function () { return change("reset"); },
    importState: function (value) { return change("importState", value); }
  };
  // Public (non-admin) pages must only ever receive published, self-consistent
  // records — the live working copy with drafts/archives belongs to the admin
  // console only. In backend mode this split already happens server-side
  // (GET /api/dataset vs /api/admin/dataset); in browser demo mode there is no
  // server, so the split has to happen here instead.
  store.ready = (Auth.isDemo()
    ? Promise.resolve(isAdmin ? window.RD_DEMO_STORE.snapshot() : window.RD_DEMO_STORE.publicSnapshot())
    : Auth.request(isAdmin ? "api/admin/dataset" : "api/dataset")
  ).then(function (value) {
    if (!isAdmin) value.audit = [];
    apply(value); return true;
  }).catch(function (error) {
    store.loadError = error.message;
    if (!isAdmin) {
      // Never leave the public page silently showing the full illustrative
      // seed dataset as if it were live data when the real fetch failed.
      apply({ version: 0, actors: [], projects: [], themes: [], relationships: [], sources: [], audit: [] });
    }
    return false;
  });
  // Re-fetch the current view of the data (published-only on public pages). Used
  // after the tab regains focus so a publish/withdraw made elsewhere shows up
  // without a manual page reload. Failures keep the last good data and record the error.
  store.reload = async function () {
    if (Auth.isDemo()) { apply(isAdmin ? window.RD_DEMO_STORE.snapshot() : window.RD_DEMO_STORE.publicSnapshot()); return true; }
    try {
      var value = await Auth.request(isAdmin ? "api/admin/dataset" : "api/dataset");
      if (!isAdmin) value.audit = [];
      store.loadError = "";
      apply(value);
      return true;
    } catch (error) { store.loadError = error.message; return false; }
  };
  window.RD_ADMIN_STORE = store;
  if (Auth.isDemo()) window.addEventListener("storage", function (event) {
    if (event.key === "rd-directory-demo-data-v1") apply(isAdmin ? window.RD_DEMO_STORE.snapshot() : window.RD_DEMO_STORE.publicSnapshot());
  });
})();
