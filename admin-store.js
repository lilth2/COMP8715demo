(function () {
  "use strict";
  var D = window.RD_DATA;
  var Auth = window.RD_ADMIN_AUTH;
  if (!D || !Auth) return;
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function replaceArray(target, source) { target.splice.apply(target, [0, target.length].concat(clone(source))); }
  function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  var state = { version: 1, actors: clone(D.actors), projects: clone(D.projectNodes), relationships: clone(D.relationships), sources: clone(D.sources), audit: [] };
  function apply(value) {
    state = value;
    state.audit = state.audit || [];
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
    window.dispatchEvent(new CustomEvent("rd-admin-data-changed"));
  }
  async function change(operation, value, id) {
    apply(await Auth.request("api/admin/action", { operation: operation, value: value, id: id }));
    return clone(state);
  }
  function find(collection, id) { return clone(state[collection].filter(function (item) { return item.id === id; })[0] || null); }
  var store = {
    snapshot: function () { return clone(state); },
    findActor: function (id) { return find("actors", id); },
    findProject: function (id) { return find("projects", id); },
    upsertActor: function (actor) {
      var value = Object.assign({ sectors: [], themes: [], offices: [], sourceNotes: [] }, actor);
      value.id = value.id || slug(value.name);
      return change("upsertActor", value);
    },
    upsertProject: function (project) { return change("upsertProject", project); },
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
    deleteRelationship: function (id) { return change("deleteRelationship", undefined, id); },
    deleteSource: function (id) { return change("deleteSource", undefined, id); },
    reset: function () { return change("reset"); },
    importState: function (value) { return change("importState", value); }
  };
  var isAdmin = /\/admin\.html$/.test(window.location.pathname);
  store.ready = Auth.request(isAdmin ? "api/admin/dataset" : "api/dataset").then(function (value) {
    apply(value); return true;
  }).catch(function (error) {
    store.loadError = error.message;
    if (!isAdmin && (window.RD_SITE_CONFIG || {}).apiBaseUrl) {
      var notice = document.querySelector(".data-notice");
      if (notice) notice.textContent = "The live dataset is unavailable. Showing the original synthetic demonstration records.";
    }
    return false;
  });
  window.RD_ADMIN_STORE = store;
})();
