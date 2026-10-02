(function () {
  "use strict";

  var D = window.RD_DATA;
  var Store = window.RD_ADMIN_STORE;
  if (!D || !Store) return;

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }
  function title(value) {
    return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }
  function list(value) {
    return String(value || "").split(",").map(function (item) { return item.trim(); }).filter(Boolean);
  }
  function lines(value) {
    return String(value || "").split(/\r?\n/).map(function (item) { return item.trim(); }).filter(Boolean);
  }
  function formatDate(value, withTime) {
    if (!value) return "—";
    var date = new Date(value.length === 10 ? value + "T00:00:00" : value);
    if (isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-AU", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
  }
  function nodeName(id) {
    var node = D.allNodes.filter(function (item) { return item.id === id; })[0];
    return node ? node.name : id;
  }
  function confidencePill(value) {
    var meta = D.CONFIDENCE_META[value] || { label: title(value || "not set") };
    return '<span class="pill ' + esc(value) + '"><span class="dot"></span>' + esc(meta.label) + "</span>";
  }
  function showToast(message, isError) {
    var toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", Boolean(isError));
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () { toast.hidden = true; }, 3000);
  }
  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (value === selected ? " selected" : "") + ">" + esc(label) + "</option>";
  }

  function showPage(page) {
    $$(".page").forEach(function (item) { item.classList.toggle("active", item.id === "page-" + page); });
    $$(".nav-btn").forEach(function (item) { item.classList.toggle("active", item.dataset.page === page); });
    renderAll();
  }

  function renderMetrics(snapshot) {
    var needsReview = snapshot.actors.filter(function (item) { return item.dataConfidence === "needs-review" || item.dataConfidence === "stale"; }).length;
    var verified = snapshot.actors.filter(function (item) { return item.dataConfidence === "verified"; }).length;
    var cards = [
      [snapshot.actors.length, "Organisations", verified + " verified records"],
      [snapshot.projects.length, "Projects", snapshot.projects.filter(function (item) { return item.dataConfidence === "verified"; }).length + " verified records"],
      [snapshot.relationships.length, "Relationships", snapshot.relationships.filter(function (item) { return item.confidence === "verified"; }).length + " verified links"],
      [snapshot.sources.length, "Source categories", "Used for provenance"],
      [needsReview, "Records to review", needsReview ? "Action recommended" : "No review backlog"],
    ];
    $("#metricGrid").innerHTML = cards.map(function (card) {
      return '<div class="metric"><div class="value">' + card[0] + '</div><div class="label">' + esc(card[1]) + '</div><div class="meta">' + esc(card[2]) + "</div></div>";
    }).join("");
  }

  function auditHTML(items, emptyText) {
    if (!items.length) return '<div class="empty">' + esc(emptyText || "No changes recorded yet.") + "</div>";
    return items.map(function (item) {
      return '<div class="audit-item"><div class="audit-time">' + esc(formatDate(item.timestamp, true)) + '</div><div><div class="audit-title">' + esc(item.action + " · " + item.label) + '</div><div class="audit-detail">' + esc(item.details || item.recordType) + '</div></div><span class="activity-tag">' + esc(item.recordType) + "</span></div>";
    }).join("");
  }

  function renderReadiness(snapshot) {
    function percentage(predicate) {
      if (!snapshot.actors.length) return 0;
      return Math.round(snapshot.actors.filter(predicate).length / snapshot.actors.length * 100);
    }
    var rows = [
      ["Core descriptions", percentage(function (item) { return Boolean(item.summary); })],
      ["Source notes", percentage(function (item) { return item.sourceNotes && item.sourceNotes.length; })],
      ["Review dates", percentage(function (item) { return Boolean(item.lastUpdated); })],
      ["Location data", percentage(function (item) { return Boolean(item.state); })],
    ];
    $("#readiness").innerHTML = rows.map(function (row) {
      return '<div class="ready-row"><span>' + esc(row[0]) + '</span><div class="bar"><span style="width:' + row[1] + '%"></span></div><strong>' + row[1] + "%</strong></div>";
    }).join("");
  }

  function renderDashboard(snapshot) {
    renderMetrics(snapshot);
    $("#recentAudit").innerHTML = auditHTML(snapshot.audit.slice(0, 5));
    renderReadiness(snapshot);
  }

  function renderOrganisations(snapshot) {
    var query = $("#orgSearch").value.trim().toLowerCase();
    var confidence = $("#orgConfidence").value;
    var actors = snapshot.actors.filter(function (actor) {
      var haystack = [actor.name, actor.type, actor.state, (actor.sectors || []).join(" ")].join(" ").toLowerCase();
      return (!query || haystack.indexOf(query) >= 0) && (!confidence || actor.dataConfidence === confidence);
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    $("#orgTableBody").innerHTML = actors.length ? actors.map(function (actor) {
      return '<tr><td><div class="record-name">' + esc(actor.name) + '</div><div class="record-sub">' + esc(actor.id) + '</div></td><td>' + esc((D.TYPE_META[actor.type] || {}).label || title(actor.type)) + '</td><td>' + esc(actor.state || "—") + '</td><td>' + confidencePill(actor.dataConfidence) + '</td><td>' + esc(formatDate(actor.lastUpdated)) + '</td><td><div class="row-actions"><button class="btn small" data-edit-org="' + esc(actor.id) + '">Edit</button><button class="btn small danger" data-delete-org="' + esc(actor.id) + '">Archive</button></div></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">No matching organisations.</td></tr>';
  }

  function renderRelationships(snapshot) {
    var query = $("#relSearch").value.trim().toLowerCase();
    var relationships = snapshot.relationships.filter(function (rel) {
      return [nodeName(rel.sourceId), nodeName(rel.targetId), rel.type].join(" ").toLowerCase().indexOf(query) >= 0;
    });
    $("#relTableBody").innerHTML = relationships.length ? relationships.map(function (rel) {
      return '<tr><td><span class="record-name">' + esc(nodeName(rel.sourceId)) + '</span></td><td>' + esc((D.RELATIONSHIP_META[rel.type] || {}).label || title(rel.type)) + '</td><td><span class="record-name">' + esc(nodeName(rel.targetId)) + '</span></td><td>' + confidencePill(rel.confidence) + '</td><td><div class="record-sub">' + esc(rel.evidence || "No evidence note") + '</div></td><td><div class="row-actions"><button class="btn small" data-edit-rel="' + esc(rel.id) + '">Edit</button><button class="btn small danger" data-delete-rel="' + esc(rel.id) + '">Delete</button></div></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">No matching relationships.</td></tr>';
  }

  function renderProjects(snapshot) {
    var query = $("#projectSearch").value.trim().toLowerCase();
    var projects = snapshot.projects.filter(function (project) {
      return [project.name, nodeName(project.hostId), project.state, (project.themes || []).join(" ")].join(" ").toLowerCase().indexOf(query) >= 0;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    $("#projectTableBody").innerHTML = projects.length ? projects.map(function (project) {
      return '<tr><td><div class="record-name">' + esc(project.name) + '</div><div class="record-sub">' + esc(project.id) + '</div></td><td>' + esc(project.hostId ? nodeName(project.hostId) : "—") + '</td><td>' + esc(project.state || "—") + '</td><td>' + confidencePill(project.dataConfidence) + '</td><td>' + esc(formatDate(project.lastUpdated)) + '</td><td><div class="row-actions"><button class="btn small" data-edit-project="' + esc(project.id) + '">Edit</button><button class="btn small danger" data-delete-project="' + esc(project.id) + '">Archive</button></div></td></tr>';
    }).join("") : '<tr><td colspan="6" class="empty">No matching projects.</td></tr>';
  }

  function renderSources(snapshot) {
    $("#sourceTableBody").innerHTML = snapshot.sources.length ? snapshot.sources.map(function (source) {
      return '<tr><td><span class="record-name">' + esc(source.name) + '</span></td><td><span class="pill">' + esc(source.type) + '</span></td><td>' + esc(source.notes || "—") + '</td><td><div class="row-actions"><button class="btn small" data-edit-source="' + esc(source.id) + '">Edit</button><button class="btn small danger" data-delete-source="' + esc(source.id) + '">Delete</button></div></td></tr>';
    }).join("") : '<tr><td colspan="4" class="empty">No source categories.</td></tr>';
  }

  function renderAll() {
    var snapshot = Store.snapshot();
    $("#orgNavCount").textContent = snapshot.actors.length;
    $("#projectNavCount").textContent = snapshot.projects.length;
    $("#relNavCount").textContent = snapshot.relationships.length;
    $("#sourceNavCount").textContent = snapshot.sources.length;
    renderDashboard(snapshot);
    renderOrganisations(snapshot);
    renderProjects(snapshot);
    renderRelationships(snapshot);
    renderSources(snapshot);
    $("#auditList").innerHTML = auditHTML(snapshot.audit, "No changes have been made through the console yet.");
  }

  function fillCommonOptions() {
    $("#orgType").innerHTML = Object.keys(D.TYPE_META).filter(function (key) { return key !== "research_theme" && key !== "project_initiative"; }).map(function (key) { return option(key, D.TYPE_META[key].label); }).join("");
    $("#orgState").innerHTML = option("", "Not specified") + D.STATES.map(function (state) { return option(state.code, state.name + " (" + state.code + ")"); }).join("");
    var confidenceOptions = Object.keys(D.CONFIDENCE_META).map(function (key) { return option(key, D.CONFIDENCE_META[key].label); }).join("");
    $("#orgConfidenceField").innerHTML = confidenceOptions;
    $("#projectConfidence").innerHTML = confidenceOptions;
    $("#projectState").innerHTML = option("", "Not specified") + D.STATES.map(function (state) { return option(state.code, state.name + " (" + state.code + ")"); }).join("");
    $("#relConfidence").innerHTML = confidenceOptions;
    $("#relType").innerHTML = Object.keys(D.RELATIONSHIP_META).map(function (key) { return option(key, D.RELATIONSHIP_META[key].label); }).join("");
  }

  function fillNodeOptions(selectedSource, selectedTarget) {
    var nodes = D.allNodes.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    $("#relSource").innerHTML = nodes.map(function (node) { return option(node.id, node.name, selectedSource); }).join("");
    $("#relTarget").innerHTML = nodes.map(function (node) { return option(node.id, node.name, selectedTarget); }).join("");
  }

  function openOrganisation(id) {
    var actor = id ? Store.findActor(id) : null;
    $("#organisationForm").reset();
    $("#organisationDialogTitle").textContent = actor ? "Edit organisation" : "Add organisation";
    $("#orgOriginalId").value = actor ? actor.id : "";
    $("#orgName").value = actor ? actor.name : "";
    $("#orgId").value = actor ? actor.id : "";
    $("#orgId").disabled = Boolean(actor);
    $("#orgType").value = actor ? actor.type : "crc";
    $("#orgState").value = actor ? actor.state || "" : "";
    $("#orgConfidenceField").value = actor ? actor.dataConfidence || "needs-review" : "needs-review";
    $("#orgSummary").value = actor ? actor.summary || "" : "";
    $("#orgSectors").value = actor ? (actor.sectors || []).join(", ") : "";
    $("#orgThemes").value = actor ? (actor.themes || []).join(", ") : "";
    $("#orgWebsite").value = actor ? actor.website || "" : "";
    $("#orgUpdated").value = actor ? actor.lastUpdated || "" : new Date().toISOString().slice(0, 10);
    $("#orgSourceNotes").value = actor ? (actor.sourceNotes || []).join("\n") : "";
    $("#organisationDialog").showModal();
  }

  function openRelationship(id) {
    var snapshot = Store.snapshot();
    var rel = id ? snapshot.relationships.filter(function (item) { return item.id === id; })[0] : null;
    $("#relationshipForm").reset();
    $("#relationshipDialogTitle").textContent = rel ? "Edit relationship" : "Add relationship";
    $("#relId").value = rel ? rel.id : "";
    fillNodeOptions(rel && rel.sourceId, rel && rel.targetId);
    $("#relType").value = rel ? rel.type : "collaborates_with";
    $("#relConfidence").value = rel ? rel.confidence : "needs-review";
    $("#relEvidence").value = rel ? rel.evidence || "" : "";
    $("#relationshipDialog").showModal();
  }

  function fillProjectHosts(selected) {
    $("#projectHost").innerHTML = option("", "Not specified", selected) + D.actors.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (actor) { return option(actor.id, actor.name, selected); }).join("");
  }

  function openProject(id) {
    var project = id ? Store.findProject(id) : null;
    $("#projectForm").reset();
    $("#projectDialogTitle").textContent = project ? "Edit project" : "Add project";
    $("#projectOriginalId").value = project ? project.id : "";
    $("#projectName").value = project ? project.name : "";
    $("#projectId").value = project ? project.id : "";
    $("#projectId").disabled = Boolean(project);
    fillProjectHosts(project ? project.hostId || "" : "");
    $("#projectState").value = project ? project.state || "" : "";
    $("#projectConfidence").value = project ? project.dataConfidence || "needs-review" : "needs-review";
    $("#projectSummary").value = project ? project.summary || "" : "";
    $("#projectThemes").value = project ? (project.themes || []).join(", ") : "";
    $("#projectUpdated").value = project ? project.lastUpdated || "" : new Date().toISOString().slice(0, 10);
    $("#projectEvidence").value = project ? project.evidenceSnippet || "" : "";
    $("#projectDialog").showModal();
  }

  function openSource(id) {
    var snapshot = Store.snapshot();
    var source = id ? snapshot.sources.filter(function (item) { return item.id === id; })[0] : null;
    $("#sourceForm").reset();
    $("#sourceDialogTitle").textContent = source ? "Edit source" : "Add source";
    $("#sourceId").value = source ? source.id : "";
    $("#sourceName").value = source ? source.name : "";
    $("#sourceType").value = source ? source.type : "";
    $("#sourceNotes").value = source ? source.notes || "" : "";
    $("#sourceDialog").showModal();
  }

  function exportData() {
    var blob = new Blob([JSON.stringify(Store.snapshot(), null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "rd-directory-admin-export-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    URL.revokeObjectURL(url);
    showToast("Dataset exported.");
  }

  function wireEvents() {
    $$(".nav-btn").forEach(function (button) { button.addEventListener("click", function () { showPage(button.dataset.page); }); });
    $$('[data-go]').forEach(function (button) { button.addEventListener("click", function () { showPage(button.dataset.go); }); });
    $$('[data-close]').forEach(function (button) { button.addEventListener("click", function () { document.getElementById(button.dataset.close).close(); }); });

    $("#orgSearch").addEventListener("input", renderAll);
    $("#orgConfidence").addEventListener("change", renderAll);
    $("#projectSearch").addEventListener("input", renderAll);
    $("#relSearch").addEventListener("input", renderAll);
    $("#addOrganisationBtn").addEventListener("click", function () { openOrganisation(); });
    $("#addProjectBtn").addEventListener("click", function () { openProject(); });
    $("#addRelationshipBtn").addEventListener("click", function () { openRelationship(); });
    $("#addSourceBtn").addEventListener("click", function () { openSource(); });
    $("#exportBtn").addEventListener("click", exportData);

    document.addEventListener("click", function (event) {
      var editOrg = event.target.closest("[data-edit-org]");
      var deleteOrg = event.target.closest("[data-delete-org]");
      var editProject = event.target.closest("[data-edit-project]");
      var deleteProject = event.target.closest("[data-delete-project]");
      var editRel = event.target.closest("[data-edit-rel]");
      var deleteRel = event.target.closest("[data-delete-rel]");
      var editSource = event.target.closest("[data-edit-source]");
      var deleteSource = event.target.closest("[data-delete-source]");
      if (editOrg) openOrganisation(editOrg.dataset.editOrg);
      if (deleteOrg && window.confirm("Archive this organisation and remove its linked relationships from the demo dataset?")) {
        Store.deleteActor(deleteOrg.dataset.deleteOrg); showToast("Organisation archived."); renderAll();
      }
      if (editProject) openProject(editProject.dataset.editProject);
      if (deleteProject && window.confirm("Archive this project and remove its linked relationships from the demo dataset?")) {
        Store.deleteProject(deleteProject.dataset.deleteProject); showToast("Project archived."); renderAll();
      }
      if (editRel) openRelationship(editRel.dataset.editRel);
      if (deleteRel && window.confirm("Delete this relationship?")) {
        Store.deleteRelationship(deleteRel.dataset.deleteRel); showToast("Relationship deleted."); renderAll();
      }
      if (editSource) openSource(editSource.dataset.editSource);
      if (deleteSource && window.confirm("Delete this source category?")) {
        Store.deleteSource(deleteSource.dataset.deleteSource); showToast("Source deleted."); renderAll();
      }
    });

    $("#organisationForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var original = $("#orgOriginalId").value;
      var existing = original ? Store.findActor(original) : {};
      Store.upsertActor(Object.assign({}, existing || {}, {
        id: original || $("#orgId").value.trim(), name: $("#orgName").value.trim(), type: $("#orgType").value,
        state: $("#orgState").value, dataConfidence: $("#orgConfidenceField").value,
        summary: $("#orgSummary").value.trim(), sectors: list($("#orgSectors").value), themes: list($("#orgThemes").value),
        website: $("#orgWebsite").value.trim(), lastUpdated: $("#orgUpdated").value, sourceNotes: lines($("#orgSourceNotes").value),
      }));
      $("#organisationDialog").close(); showToast(original ? "Organisation updated." : "Organisation created."); renderAll();
    });

    $("#relationshipForm").addEventListener("submit", function (event) {
      event.preventDefault();
      if ($("#relSource").value === $("#relTarget").value) { showToast("Choose two different records.", true); return; }
      Store.upsertRelationship({
        id: $("#relId").value, sourceId: $("#relSource").value, targetId: $("#relTarget").value,
        type: $("#relType").value, confidence: $("#relConfidence").value,
        intensity: "medium", evidence: $("#relEvidence").value.trim(), lastUpdated: new Date().toISOString().slice(0, 10),
      });
      $("#relationshipDialog").close(); showToast("Relationship saved."); renderAll();
    });

    $("#projectForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var original = $("#projectOriginalId").value;
      Store.upsertProject({
        id: original || $("#projectId").value.trim(), name: $("#projectName").value.trim(), type: "project_initiative",
        hostId: $("#projectHost").value, state: $("#projectState").value,
        dataConfidence: $("#projectConfidence").value, summary: $("#projectSummary").value.trim(),
        themes: list($("#projectThemes").value), lastUpdated: $("#projectUpdated").value,
        evidenceSnippet: $("#projectEvidence").value.trim(),
      });
      $("#projectDialog").close(); showToast(original ? "Project updated." : "Project created."); renderAll();
    });

    $("#sourceForm").addEventListener("submit", function (event) {
      event.preventDefault();
      Store.upsertSource({ id: $("#sourceId").value, name: $("#sourceName").value.trim(), type: $("#sourceType").value.trim(), notes: $("#sourceNotes").value.trim() });
      $("#sourceDialog").close(); showToast("Source saved."); renderAll();
    });

    $("#importInput").addEventListener("change", function (event) {
      var file = event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try { Store.importState(JSON.parse(reader.result)); showToast("Dataset imported."); renderAll(); }
        catch (error) { showToast(error.message || "Import failed.", true); }
        event.target.value = "";
      };
      reader.readAsText(file);
    });

    $("#resetBtn").addEventListener("click", function () {
      if (!window.confirm("Reset all browser-local changes and restore the repository demo data?")) return;
      Store.reset(); showToast("Demo data restored."); renderAll();
    });

    window.addEventListener("rd-admin-data-changed", renderAll);
  }

  fillCommonOptions();
  wireEvents();
  renderAll();
})();
