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
  function officesToText(offices) {
    return (offices || []).map(function (o) { return [o.role, o.state, o.city || "", o.focus || ""].join(" | "); }).join("\n");
  }
  function textToOffices(value) {
    return lines(value).map(function (line) {
      var parts = line.split("|").map(function (part) { return part.trim(); });
      return { role: parts[0].toLowerCase(), state: (parts[1] || "").toUpperCase(), city: parts[2] || "", focus: parts.slice(3).join(" | ") };
    });
  }
  function formatDate(value, withTime) {
    if (!value) return "—";
    var date = new Date(value.length === 10 ? value + "T00:00:00" : value);
    if (isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-AU", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
  }
  function nodeName(id) {
    var node = D.allNodes.filter(function (item) { return item.id === id; })[0];
    return node ? node.name : id + " (unavailable)";
  }
  function confidencePill(value) {
    var meta = D.CONFIDENCE_META[value] || { label: title(value || "not set") };
    return '<span class="pill ' + esc(value) + '"><span class="dot"></span>' + esc(meta.label) + "</span>";
  }

  // ----------------------------------------------------------- publish/draft lifecycle
  var STATUS_LABEL = { draft: "Draft", published: "Published", archived: "Archived" };
  function recordPublicFields(record) {
    var copy = Object.assign({}, record);
    delete copy.status; delete copy.publishedSnapshot;
    return copy;
  }
  function hasPendingChanges(record) {
    if (!record || record.status !== "published" || !record.publishedSnapshot) return false;
    return JSON.stringify(recordPublicFields(record)) !== JSON.stringify(record.publishedSnapshot);
  }
  function statusPill(record) {
    var label = STATUS_LABEL[record.status] || title(record.status);
    if (record.status === "published" && hasPendingChanges(record)) label += " · unpublished changes";
    return '<span class="pill status-' + esc(record.status) + '">' + esc(label) + "</span>";
  }
  function actionButton(action, kind, id, label, cls) {
    return '<button class="btn small' + (cls ? " " + cls : "") + '" data-action="' + action + '" data-kind="' + kind + '" data-id="' + esc(id) + '">' + esc(label) + "</button>";
  }
  function lifecycleActionsHTML(kind, record) {
    var html = actionButton("edit", kind, record.id, "Edit") + actionButton("preview", kind, record.id, "Preview");
    if (record.status === "draft") {
      html += actionButton("publish", kind, record.id, "Publish", "teal");
    } else if (record.status === "published") {
      if (hasPendingChanges(record)) html += actionButton("publish", kind, record.id, "Publish changes", "teal");
      html += actionButton("withdraw", kind, record.id, "Withdraw");
    } else if (record.status === "archived") {
      html += actionButton("restore", kind, record.id, "Restore", "teal");
    }
    if (record.status !== "archived") html += actionButton("archive", kind, record.id, "Archive");
    html += actionButton("delete", kind, record.id, "Delete", "danger");
    return '<div class="row-actions">' + html + "</div>";
  }
  function passesStatusFilter(record, selectId) {
    var value = $(selectId) ? $(selectId).value : "";
    return !value || record.status === value;
  }
  function publishedRelCount(id) {
    return Store.relationshipsTouching(id).filter(function (item) { return item.status === "published"; }).length;
  }
  function publishPreviewText(kind, record) {
    var lines = ["Publish this record to the public Ecosystem View?", ""];
    if (kind === "rel") {
      lines[0] = "Publish this relationship to the public Ecosystem View?";
      lines.push(((D.RELATIONSHIP_META[record.type] || {}).label || record.type) + ": " + nodeName(record.sourceId) + " → " + nodeName(record.targetId));
      lines.push("Evidence: " + (record.evidence || "—"));
    } else {
      lines.push("Name: " + record.name);
      if (kind === "org") lines.push("Type: " + ((D.TYPE_META[record.type] || {}).label || title(record.type)), "State: " + (record.state || "—"));
      if (kind === "project") lines.push("Host: " + (record.hostId ? nodeName(record.hostId) : "—"), "State: " + (record.state || "—"));
      lines.push("Summary: " + (record.summary || "—"));
    }
    if (record.status === "published") lines.push("", "This replaces the version currently visible to the public with your saved changes.");
    return lines.join("\n");
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
    function published(coll) { return snapshot[coll].filter(function (item) { return item.status === "published"; }).length; }
    function drafts(coll) { return snapshot[coll].filter(function (item) { return item.status === "draft"; }).length; }
    var needsReview = snapshot.actors.filter(function (item) { return item.dataConfidence === "needs-review" || item.dataConfidence === "stale"; }).length;
    var draftTotal = drafts("actors") + drafts("projects") + drafts("themes") + drafts("relationships");
    var cards = [
      [published("actors") + "/" + snapshot.actors.length, "Organisations (published / total)", drafts("actors") + " draft"],
      [published("projects") + "/" + snapshot.projects.length, "Projects (published / total)", drafts("projects") + " draft"],
      [published("themes") + "/" + snapshot.themes.length, "Research themes (published / total)", drafts("themes") + " draft"],
      [published("relationships") + "/" + snapshot.relationships.length, "Relationships (published / total)", drafts("relationships") + " draft"],
      [snapshot.sources.length, "Source categories", "Used for provenance"],
      [draftTotal, "Drafts awaiting publish", draftTotal ? "Review and publish when ready" : "Nothing waiting"],
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
      return (!query || haystack.indexOf(query) >= 0) && (!confidence || actor.dataConfidence === confidence) && passesStatusFilter(actor, "#orgStatus");
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    $("#orgTableBody").innerHTML = actors.length ? actors.map(function (actor) {
      return "<tr><td><div class=\"record-name\">" + esc(actor.name) + "</div><div class=\"record-sub\">" + esc(actor.id) + "</div></td><td>" + esc((D.TYPE_META[actor.type] || {}).label || title(actor.type)) + "</td><td>" + esc(actor.state || "—") + "</td><td>" + statusPill(actor) + "</td><td>" + confidencePill(actor.dataConfidence) + "</td><td>" + esc(formatDate(actor.lastUpdated)) + "</td><td>" + lifecycleActionsHTML("org", actor) + "</td></tr>";
    }).join("") : '<tr><td colspan="7" class="empty">No matching organisations.</td></tr>';
  }

  function renderRelationships(snapshot) {
    var query = $("#relSearch").value.trim().toLowerCase();
    var relationships = snapshot.relationships.filter(function (rel) {
      return [nodeName(rel.sourceId), nodeName(rel.targetId), rel.type].join(" ").toLowerCase().indexOf(query) >= 0 && passesStatusFilter(rel, "#relStatus");
    });
    $("#relTableBody").innerHTML = relationships.length ? relationships.map(function (rel) {
      return "<tr><td><span class=\"record-name\">" + esc(nodeName(rel.sourceId)) + "</span></td><td>" + esc((D.RELATIONSHIP_META[rel.type] || {}).label || title(rel.type)) + "</td><td><span class=\"record-name\">" + esc(nodeName(rel.targetId)) + "</span></td><td>" + statusPill(rel) + "</td><td>" + confidencePill(rel.confidence) + "</td><td><div class=\"record-sub\">" + esc(rel.evidence || "No evidence note") + "</div></td><td>" + lifecycleActionsHTML("rel", rel) + "</td></tr>";
    }).join("") : '<tr><td colspan="7" class="empty">No matching relationships.</td></tr>';
  }

  function renderProjects(snapshot) {
    var query = $("#projectSearch").value.trim().toLowerCase();
    var projects = snapshot.projects.filter(function (project) {
      return [project.name, nodeName(project.hostId), project.state, (project.themes || []).join(" ")].join(" ").toLowerCase().indexOf(query) >= 0 && passesStatusFilter(project, "#projectStatus");
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    $("#projectTableBody").innerHTML = projects.length ? projects.map(function (project) {
      return "<tr><td><div class=\"record-name\">" + esc(project.name) + "</div><div class=\"record-sub\">" + esc(project.id) + "</div></td><td>" + esc(project.hostId ? nodeName(project.hostId) : "—") + "</td><td>" + esc(project.state || "—") + "</td><td>" + statusPill(project) + "</td><td>" + confidencePill(project.dataConfidence) + "</td><td>" + esc(formatDate(project.lastUpdated)) + "</td><td>" + lifecycleActionsHTML("project", project) + "</td></tr>";
    }).join("") : '<tr><td colspan="7" class="empty">No matching projects.</td></tr>';
  }

  function renderThemes(snapshot) {
    var query = $("#themeSearch").value.trim().toLowerCase();
    var themes = (snapshot.themes || []).filter(function (theme) {
      return theme.name.toLowerCase().indexOf(query) >= 0 && passesStatusFilter(theme, "#themeStatus");
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    $("#themeTableBody").innerHTML = themes.length ? themes.map(function (theme) {
      return "<tr><td><div class=\"record-name\">" + esc(theme.name) + "</div><div class=\"record-sub\">" + esc(theme.id) + "</div></td><td>" + statusPill(theme) + "</td><td>" + confidencePill(theme.dataConfidence) + "</td><td>" + esc(formatDate(theme.lastUpdated)) + "</td><td>" + lifecycleActionsHTML("theme", theme) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty">No matching research themes.</td></tr>';
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
    $("#themeNavCount").textContent = (snapshot.themes || []).length;
    $("#relNavCount").textContent = snapshot.relationships.length;
    $("#sourceNavCount").textContent = snapshot.sources.length;
    renderDashboard(snapshot);
    renderOrganisations(snapshot);
    renderProjects(snapshot);
    renderThemes(snapshot);
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
    $("#themeConfidence").innerHTML = confidenceOptions;
    $("#projectState").innerHTML = option("", "Not specified") + D.STATES.map(function (state) { return option(state.code, state.name + " (" + state.code + ")"); }).join("");
    $("#relConfidence").innerHTML = confidenceOptions;
    $("#relType").innerHTML = Object.keys(D.RELATIONSHIP_META).map(function (key) { return option(key, D.RELATIONSHIP_META[key].label); }).join("");
  }

  // Every record the admin can link to as a relationship endpoint — including
  // drafts, so a relationship can be authored before both ends are published.
  // Publishing the relationship itself is still blocked until they are.
  function fillNodeOptions(selectedSource, selectedTarget) {
    var nodes = Store.snapshot();
    var all = nodes.actors.concat(nodes.projects, nodes.themes).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    function renderOption(node, selected) {
      return option(node.id, node.name + (node.status !== "published" ? " (" + STATUS_LABEL[node.status] + ")" : ""), selected);
    }
    $("#relSource").innerHTML = all.map(function (node) { return renderOption(node, selectedSource); }).join("");
    $("#relTarget").innerHTML = all.map(function (node) { return renderOption(node, selectedTarget); }).join("");
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
    $("#orgOffices").value = actor ? officesToText(actor.offices) : "";
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
    $("#projectHost").innerHTML = option("", "Not specified", selected) + Store.snapshot().actors.slice().sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (actor) { return option(actor.id, actor.name + (actor.status !== "published" ? " (" + STATUS_LABEL[actor.status] + ")" : ""), selected); }).join("");
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

  function openTheme(id) {
    var theme = id ? Store.findTheme(id) : null;
    $("#themeForm").reset();
    $("#themeDialogTitle").textContent = theme ? "Edit research theme" : "Add research theme";
    $("#themeOriginalId").value = theme ? theme.id : "";
    $("#themeName").value = theme ? theme.name : "";
    $("#themeId").value = theme ? theme.id : "";
    $("#themeId").disabled = Boolean(theme);
    $("#themeConfidence").value = theme ? theme.dataConfidence || "needs-review" : "needs-review";
    $("#themeSummary").value = theme ? theme.summary || "" : "";
    $("#themeUpdated").value = theme ? theme.lastUpdated || "" : new Date().toISOString().slice(0, 10);
    $("#themeDialog").showModal();
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

  var OPEN_BY_KIND = { org: openOrganisation, project: openProject, theme: openTheme, rel: openRelationship };
  var COLLECTION_BY_KIND = { org: "actors", project: "projects", theme: "themes", rel: "relationships" };
  var DELETE_BY_KIND = {
    org: function (id) { return Store.deleteActor(id); },
    project: function (id) { return Store.deleteProject(id); },
    theme: function (id) { return Store.deleteTheme(id); },
    rel: function (id) { return Store.deleteRelationship(id); },
  };
  var KIND_NOUN = { org: "organisation", project: "project", theme: "research theme", rel: "relationship" };

  async function handleLifecycleAction(action, kind, id) {
    var collection = COLLECTION_BY_KIND[kind];
    var record = Store.snapshot()[collection].filter(function (item) { return item.id === id; })[0];
    if (!record) { showToast("Record not found.", true); return; }
    if (action === "preview") {
      var rels = Store.relationshipsTouching(id);
      var visibility = record.status === "published" ? (hasPendingChanges(record) ? "Published (public copy differs from this draft)" : "Published (public copy matches)") : "Not public (" + STATUS_LABEL[record.status] + ")";
      $("#previewTitle").textContent = "Preview \u2014 " + (record.name || "relationship");
      $("#previewBody").textContent = "Visibility: " + visibility + "\n\n" + publishPreviewText(kind, record).replace(/^Publish this[^\n]*\n\n/, "") +
        (kind !== "rel" ? "\n\nRelationships: " + (rels.length ? rels.map(function (r) { return nodeName(r.sourceId) + " \u2192 " + nodeName(r.targetId) + " [" + STATUS_LABEL[r.status] + "]"; }).join("; ") : "none") : "");
      $("#previewDialog").showModal();
    } else if (action === "publish") {
      if (!window.confirm(publishPreviewText(kind, record))) return;
      await Store.publish(collection, id);
      showToast("Published."); renderAll();
    } else if (action === "withdraw") {
      var impact = publishedRelCount(id);
      var withdrawMsg = "Withdraw this " + KIND_NOUN[kind] + " from the public Ecosystem View?" +
        (impact ? " " + impact + " published relationship(s) referencing it will also stop appearing publicly until it is republished." : "");
      if (!window.confirm(withdrawMsg)) return;
      await Store.withdraw(collection, id);
      showToast("Withdrawn to draft."); renderAll();
    } else if (action === "archive") {
      var impactA = publishedRelCount(id);
      var archiveMsg = "Archive this " + KIND_NOUN[kind] + "? It is removed from the public Ecosystem View" +
        (impactA ? " along with " + impactA + " published relationship(s) referencing it" : "") +
        ", but kept here and can be restored later.";
      if (!window.confirm(archiveMsg)) return;
      await Store.archiveRecord(collection, id);
      showToast("Archived."); renderAll();
    } else if (action === "restore") {
      await Store.restoreRecord(collection, id);
      showToast("Restored to draft — publish it to make it public again."); renderAll();
    } else if (action === "delete") {
      var impactD = Store.relationshipsTouching(id).length;
      var deleteMsg = kind === "rel" ? "Permanently delete this relationship?" :
        "Permanently delete this " + KIND_NOUN[kind] + (impactD ? " and " + impactD + " relationship(s) referencing it" : "") + "? This cannot be undone.";
      if (!window.confirm(deleteMsg)) return;
      await DELETE_BY_KIND[kind](id);
      showToast(title(KIND_NOUN[kind]) + " deleted."); renderAll();
    }
  }

  function wireEvents() {
    $$(".nav-btn").forEach(function (button) { button.addEventListener("click", function () { showPage(button.dataset.page); }); });
    $$('[data-go]').forEach(function (button) { button.addEventListener("click", function () { showPage(button.dataset.go); }); });
    $$('[data-close]').forEach(function (button) { button.addEventListener("click", function () { document.getElementById(button.dataset.close).close(); }); });

    ["#orgSearch", "#orgConfidence", "#orgStatus", "#projectSearch", "#projectStatus", "#themeSearch", "#themeStatus", "#relSearch", "#relStatus"].forEach(function (sel) {
      var el = $(sel);
      if (el) el.addEventListener(el.tagName === "SELECT" ? "change" : "input", renderAll);
    });
    $("#addOrganisationBtn").addEventListener("click", function () { openOrganisation(); });
    $("#addProjectBtn").addEventListener("click", function () { openProject(); });
    $("#addThemeBtn").addEventListener("click", function () { openTheme(); });
    $("#addRelationshipBtn").addEventListener("click", function () { openRelationship(); });
    $("#addSourceBtn").addEventListener("click", function () { openSource(); });
    $("#exportBtn").addEventListener("click", exportData);

    document.addEventListener("click", async function (event) {
      try {
        var lifecycleBtn = event.target.closest("[data-action][data-kind][data-id]");
        if (lifecycleBtn) {
          var action = lifecycleBtn.dataset.action, kind = lifecycleBtn.dataset.kind, idValue = lifecycleBtn.dataset.id;
          if (action === "edit") { OPEN_BY_KIND[kind](idValue); }
          else { await handleLifecycleAction(action, kind, idValue); }
          return;
        }
        var editSource = event.target.closest("[data-edit-source]");
        var deleteSource = event.target.closest("[data-delete-source]");
        if (editSource) openSource(editSource.dataset.editSource);
        if (deleteSource && window.confirm("Delete this source category?")) {
          await Store.deleteSource(deleteSource.dataset.deleteSource); showToast("Source deleted."); renderAll();
        }
      } catch (error) { showToast(error.message, true); }
    });

    $("#organisationForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
      var original = $("#orgOriginalId").value;
      var existing = original ? Store.findActor(original) : {};
      await Store.upsertActor(Object.assign({}, existing || {}, {
        id: original || $("#orgId").value.trim(), name: $("#orgName").value.trim(), type: $("#orgType").value,
        state: $("#orgState").value, dataConfidence: $("#orgConfidenceField").value,
        summary: $("#orgSummary").value.trim(), sectors: list($("#orgSectors").value), themes: list($("#orgThemes").value),
        website: $("#orgWebsite").value.trim(), lastUpdated: $("#orgUpdated").value, sourceNotes: lines($("#orgSourceNotes").value),
        offices: textToOffices($("#orgOffices").value),
      }));
      $("#organisationDialog").close(); showToast(original ? "Draft saved. Publish to update the public directory." : "Draft created. Publish when it is ready to go live."); renderAll();
      } catch (error) { showToast(error.message, true); }
    });

    $("#relationshipForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
      if ($("#relSource").value === $("#relTarget").value) { showToast("Choose two different records.", true); return; }
      var existingRel = Store.snapshot().relationships.filter(function (item) { return item.id === $("#relId").value; })[0];
      await Store.upsertRelationship({
        id: $("#relId").value, sourceId: $("#relSource").value, targetId: $("#relTarget").value,
        type: $("#relType").value, confidence: $("#relConfidence").value,
        intensity: existingRel ? existingRel.intensity : "medium", evidence: $("#relEvidence").value.trim(), lastUpdated: new Date().toISOString().slice(0, 10),
      });
      $("#relationshipDialog").close(); showToast("Draft saved. Publish to make it public (both ends must be published first)."); renderAll();
      } catch (error) { showToast(error.message, true); }
    });

    $("#projectForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
      var original = $("#projectOriginalId").value;
      await Store.upsertProject({
        id: original || $("#projectId").value.trim(), name: $("#projectName").value.trim(), type: "project_initiative",
        hostId: $("#projectHost").value, state: $("#projectState").value,
        dataConfidence: $("#projectConfidence").value, summary: $("#projectSummary").value.trim(),
        themes: list($("#projectThemes").value), lastUpdated: $("#projectUpdated").value,
        evidenceSnippet: $("#projectEvidence").value.trim(),
      });
      $("#projectDialog").close(); showToast(original ? "Draft saved. Publish to update the public directory." : "Draft created. Publish when it is ready to go live."); renderAll();
      } catch (error) { showToast(error.message, true); }
    });

    $("#themeForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
      var original = $("#themeOriginalId").value;
      await Store.upsertTheme({
        id: original || $("#themeId").value.trim(), name: $("#themeName").value.trim(), type: "research_theme",
        dataConfidence: $("#themeConfidence").value, summary: $("#themeSummary").value.trim(), lastUpdated: $("#themeUpdated").value,
      });
      $("#themeDialog").close(); showToast(original ? "Draft saved. Publish to update the public directory." : "Draft created. Publish when it is ready to go live."); renderAll();
      } catch (error) { showToast(error.message, true); }
    });

    $("#sourceForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
      await Store.upsertSource({ id: $("#sourceId").value, name: $("#sourceName").value.trim(), type: $("#sourceType").value.trim(), notes: $("#sourceNotes").value.trim() });
      $("#sourceDialog").close(); showToast("Source saved."); renderAll();
      } catch (error) { showToast(error.message, true); }
    });

    $("#importInput").addEventListener("change", function (event) {
      var file = event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function () {
        try { await Store.importState(JSON.parse(reader.result)); showToast("Dataset imported."); renderAll(); }
        catch (error) { showToast(error.message || "Import failed.", true); }
        event.target.value = "";
      };
      reader.readAsText(file);
    });

    $("#resetBtn").addEventListener("click", async function () {
      var resetMessage = window.RD_ADMIN_AUTH.isDemo() ? "Restore the original demo dataset in this browser? All drafts and publish state will be reset." : "Restore the original shared demo dataset? This affects all visitors.";
      if (!window.confirm(resetMessage)) return;
      try { await Store.reset(); showToast("Demo data restored."); renderAll(); }
      catch (error) { showToast(error.message, true); }
    });

    window.addEventListener("rd-admin-data-changed", renderAll);
  }

  async function requireLogin() {
    try {
      var session = await window.RD_ADMIN_AUTH.session();
      if (!session.authenticated) { window.location.replace("login.html"); return false; }
      $("#adminIdentity").textContent = session.username + (window.RD_ADMIN_AUTH.isDemo() ? " · Demo administrator" : " · Administrator");
      return true;
    } catch (error) {
      window.location.replace("login.html");
      return false;
    }
  }
  $("#logoutBtn").addEventListener("click", async function () {
    this.disabled = true;
    try {
      await window.RD_ADMIN_AUTH.logout();
      window.location.replace("login.html");
    } catch (error) { showToast(error.message, true); this.disabled = false; }
  });
  requireLogin().then(async function (allowed) {
    if (!allowed) return;
    if (window.RD_ADMIN_AUTH.isDemo()) {
      $(".notice").textContent = "Sprint demo mode: changes affect only synthetic data saved in this browser, and still follow the draft/publish workflow below. This login is for demonstration and does not secure real management data.";
      $(".side-note").innerHTML = "<strong>Demo workspace</strong>Changes are saved in this browser. Export JSON to keep a copy before clearing browser data.";
      $("#page-history .page-head p").textContent = "Browser-local history of changes to the synthetic demonstration dataset.";
    }
    if (!await Store.ready) {
      document.body.classList.remove("auth-pending");
      $(".shell").style.display = "none";
      showToast(Store.loadError || "Unable to load administrator data. Please reload the page.", true);
      return;
    }
    fillCommonOptions();
    wireEvents();
    renderAll();
    document.body.classList.remove("auth-pending");
    window.setInterval(requireLogin, 60000);
    window.addEventListener("pageshow", requireLogin);
  });
})();
