(function () {
  "use strict";

  var D = window.RD_DATA;
  var Store = window.RD_ADMIN_STORE;
  var Editor = window.RD_NETWORK_EDITOR;
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
  // A theme tag is either a theme node (show its name) or a free tag with no node (show it as typed).
  function tagName(id) {
    var node = D.allNodes.filter(function (item) { return item.id === id; })[0];
    return node ? node.name : id;
  }
  function confidencePill(value) {
    var meta = D.CONFIDENCE_META[value] || { label: title(value || "not set") };
    return '<span class="pill ' + esc(value) + '"><span class="dot"></span>' + esc(meta.label) + "</span>";
  }

  // ------------------------------------------------------------------- dialogs
  function showToast(message, isError) {
    var toast = $("#toast");
    toast.textContent = message;
    toast.classList.toggle("error", Boolean(isError));
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () { toast.hidden = true; }, 3500);
  }
  // Resolves "ok", "secondary" or null (cancel / Esc / close).
  function askConfirm(opts) {
    return new Promise(function (resolve) {
      var dlg = $("#confirmDialog");
      var ok = $("#confirmOk"), cancel = $("#confirmCancel"), secondary = $("#confirmSecondary"), close = $("#confirmClose");
      $("#confirmTitle").textContent = opts.title;
      $("#confirmBody").innerHTML = opts.html;
      ok.textContent = opts.okLabel || "OK";
      ok.className = "btn " + (opts.danger ? "dangerfill" : "teal");
      cancel.textContent = opts.cancelLabel || "Cancel";
      cancel.hidden = Boolean(opts.infoOnly);
      secondary.hidden = !opts.secondaryLabel;
      secondary.textContent = opts.secondaryLabel || "";
      var finished = false;
      function done(value) {
        if (finished) return;
        finished = true;
        ok.onclick = cancel.onclick = secondary.onclick = close.onclick = null;
        dlg.removeEventListener("cancel", onCancel);
        if (dlg.open) dlg.close();
        resolve(value);
      }
      function onCancel(event) { event.preventDefault(); done(null); }
      ok.onclick = function () { done("ok"); };
      cancel.onclick = function () { done(null); };
      secondary.onclick = function () { done("secondary"); };
      close.onclick = function () { done(null); };
      dlg.addEventListener("cancel", onCancel);
      dlg.showModal();
    });
  }
  function showError(error) {
    var html = "<p>" + esc(error && error.message ? error.message : String(error)) + "</p>";
    if (error && error.blockers && error.blockers.length) {
      html += "<ul>" + error.blockers.map(function (b) { return "<li><strong>" + esc(b.name) + "</strong> — " + esc(b.kind) + ", " + esc(b.status) + "</li>"; }).join("") + "</ul>";
    }
    html += '<p class="help">Your draft is unchanged.</p>';
    return askConfirm({ title: "That didn't work", html: html, okLabel: "OK", infoOnly: true });
  }
  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (value === selected ? " selected" : "") + ">" + esc(label) + "</option>";
  }

  // ------------------------------------------------- draft / publish lifecycle
  var STATUS_LABEL = { draft: "Draft", published: "Published" };
  var COLLECTION_BY_KIND = { org: "actors", project: "projects", theme: "themes", rel: "relationships" };
  var KIND_BY_COLLECTION = { actors: "org", projects: "project", themes: "theme", relationships: "rel" };
  var KIND_NOUN = { org: "organisation", project: "project", theme: "research theme", rel: "relationship" };
  function statusPill(record) {
    var label = STATUS_LABEL[record.status] || title(record.status);
    if (Store.hasPendingChanges(record)) label += " · unpublished changes";
    return '<span class="pill status-' + esc(record.status) + '">' + esc(label) + "</span>";
  }
  function actionButton(action, kind, id, label, cls) {
    return '<button class="btn small' + (cls ? " " + cls : "") + '" data-action="' + action + '" data-kind="' + kind + '" data-id="' + esc(id) + '">' + esc(label) + "</button>";
  }
  function lifecycleActionsHTML(kind, record) {
    var html = actionButton("edit", kind, record.id, "Edit") + actionButton("preview", kind, record.id, "Preview");
    if (record.status === "draft") html += actionButton("publish", kind, record.id, "Publish", "teal");
    else {
      if (Store.hasPendingChanges(record)) html += actionButton("publish", kind, record.id, "Publish changes", "teal");
      html += actionButton("withdraw", kind, record.id, "Withdraw");
    }
    html += actionButton("delete", kind, record.id, "Delete", "danger");
    return '<div class="row-actions">' + html + "</div>";
  }
  function passesStatusFilter(record, selectId) {
    var value = $(selectId) ? $(selectId).value : "";
    return !value || record.status === value;
  }
  function recordLabel(kind, record) {
    return kind === "rel" ? Store.relLabel(record) : record.name;
  }
  function fieldSummary(kind, record) {
    var rows = [];
    if (kind === "rel") {
      rows.push(["Relationship", ((D.RELATIONSHIP_META[record.type] || {}).label || record.type) + ": " + nodeName(record.sourceId) + " → " + nodeName(record.targetId)]);
      rows.push(["Strength", record.intensity]); rows.push(["Evidence", record.evidence || "—"]);
    } else {
      rows.push(["Name", record.name]);
      if (kind === "org") { rows.push(["Type", (D.TYPE_META[record.type] || {}).label || title(record.type)]); rows.push(["State", record.state || "—"]); }
      if (kind === "project") { rows.push(["Host", record.hostId ? nodeName(record.hostId) : "—"]); rows.push(["State", record.state || "—"]); }
      if (kind !== "theme") rows.push(["Theme tags", (record.themes || []).map(tagName).join(", ") || "—"]);
      rows.push(["Summary", record.summary || "—"]);
    }
    return rows;
  }
  // Field-level difference between the working copy and the published copy.
  function changedFields(record) {
    var snap = record.publishedSnapshot || {};
    var keys = {};
    Object.keys(record).concat(Object.keys(snap)).forEach(function (k) { keys[k] = true; });
    return Object.keys(keys).filter(function (k) {
      return k !== "status" && k !== "publishedSnapshot" && JSON.stringify(record[k]) !== JSON.stringify(snap[k]);
    }).map(function (k) {
      var show = function (v) { return v == null || v === "" ? "(empty)" : (typeof v === "object" ? JSON.stringify(v) : String(v)); };
      return { field: k, before: show(snap[k]), after: show(record[k]) };
    });
  }
  function publishSummaryHTML(kind, plan) {
    var record = plan.record;
    var html = "<dl>" + fieldSummary(kind, record).map(function (row) { return "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>"; }).join("") + "</dl>";
    if (plan.isUpdate) {
      var diff = changedFields(record);
      html += '<div class="warn">This replaces the version visitors see now. Changes being published:<ul>' +
        (diff.length ? diff.map(function (d) { return "<li><strong>" + esc(d.field) + "</strong>: " + esc(d.before) + " → " + esc(d.after) + "</li>"; }).join("") : "<li>No field differences.</li>") + "</ul></div>";
    } else {
      html += '<div class="warn">This record is currently a draft. Publishing makes it visible on the public site.</div>';
    }
    if (plan.alsoPublish.length) html += "<p>These links are published together with it:</p><ul>" + plan.alsoPublish.map(function (l) { return "<li>" + esc(l.label) + "</li>"; }).join("") + "</ul>";
    if (plan.hiddenLinks.length) html += "<p>These links stay hidden until the other record is published:</p><ul>" + plan.hiddenLinks.map(function (l) { return "<li>" + esc(l.label) + " — " + esc(l.reason) + "</li>"; }).join("") + "</ul>";
    return html;
  }
  function blockersHTML(plan) {
    return "<p>This relationship connects records that are not public yet, so it would be a dangling edge:</p><ul>" +
      plan.blockers.map(function (b) { return "<li><strong>" + esc(b.name) + "</strong> — " + esc(b.kind) + ", " + esc(b.status) + "</li>"; }).join("") +
      '</ul><p>You can publish those records together with the relationship, or cancel and publish them yourself first.</p>';
  }

  async function publishFlow(kind, id) {
    var collection = COLLECTION_BY_KIND[kind];
    var plan = Store.describePublish(collection, id);
    var name = recordLabel(kind, plan.record);
    if (plan.blockers.length) {
      var choice = await askConfirm({ title: "Can't publish yet: " + name, html: blockersHTML(plan), okLabel: "Publish these records too" });
      if (choice !== "ok") return false;
      await Store.publish(collection, id, { withDependencies: true });
      return true;
    }
    var confirmed = await askConfirm({ title: (plan.isUpdate ? "Publish changes: " : "Publish: ") + name, html: publishSummaryHTML(kind, plan), okLabel: plan.isUpdate ? "Publish changes" : "Publish" });
    if (confirmed !== "ok") return false;
    await Store.publish(collection, id);
    return true;
  }
  function impactHTML(impact, kind) {
    var html = "";
    if (impact.relationships.length) html += "<p>" + impact.relationships.length + " relationship(s) will be deleted with it:</p><ul>" + impact.relationships.map(function (r) { return "<li>" + esc(r.label) + " <em>(" + esc(r.status) + ")</em></li>"; }).join("") + "</ul>";
    if (impact.hostedProjects.length) html += "<p>These projects lose their host:</p><ul>" + impact.hostedProjects.map(function (p) { return "<li>" + esc(p.name) + "</li>"; }).join("") + "</ul>";
    if (impact.taggedRecords.length) html += "<p>The theme tag is removed from:</p><ul>" + impact.taggedRecords.map(function (n) { return "<li>" + esc(n.name) + "</li>"; }).join("") + "</ul>";
    if (!html && kind !== "rel") html = "<p>No relationships or references depend on it.</p>";
    return html;
  }

  async function lifecycleAction(action, kind, id) {
    var collection = COLLECTION_BY_KIND[kind];
    var record = Store.snapshot()[collection].filter(function (item) { return item.id === id; })[0];
    if (!record) { showToast("Record not found.", true); return; }
    try {
      if (action === "edit") { openEdit(kind, id); }
      else if (action === "preview") {
        var rels = kind === "rel" ? [] : Store.relationshipsTouching(id);
        var visibility = record.status === "published" ? (Store.hasPendingChanges(record) ? "Published (the public copy differs from this draft)" : "Published (the public copy matches)") : "Not public (draft)";
        $("#previewTitle").textContent = "Preview — " + recordLabel(kind, record);
        $("#previewBody").textContent = "Visibility: " + visibility + "\n\n" + fieldSummary(kind, record).map(function (row) { return row[0] + ": " + row[1]; }).join("\n") +
          (kind !== "rel" ? "\n\nRelationships: " + (rels.length ? rels.map(function (r) { return Store.relLabel(r) + " [" + STATUS_LABEL[r.status] + "]"; }).join("; ") : "none") : "");
        $("#previewDialog").showModal();
      } else if (action === "publish") {
        if (await publishFlow(kind, id)) showToast("Published.");
      } else if (action === "withdraw") {
        var impactW = Store.impactOf(collection, id);
        var pubLinks = impactW.relationships.filter(function (r) { return r.status === "published"; }).length;
        var okW = await askConfirm({ title: "Withdraw: " + recordLabel(kind, record), okLabel: "Withdraw",
          html: "<p>This " + esc(KIND_NOUN[kind]) + " disappears from the public site and returns to draft. Nothing is deleted.</p>" +
            (kind !== "rel" && pubLinks ? '<div class="warn">' + pubLinks + " published relationship(s) touching it also stop appearing publicly until it is published again.</div>" : "") });
        if (okW !== "ok") return;
        await Store.withdraw(collection, id);
        showToast("Withdrawn to draft.");
      } else if (action === "delete") {
        var impactD = Store.impactOf(collection, id);
        var okD = await askConfirm({ title: "Delete: " + recordLabel(kind, record), okLabel: "Delete permanently", danger: true,
          html: "<p>You are about to delete this " + esc(KIND_NOUN[kind]) + ". This cannot be undone.</p>" +
            (impactD.published ? '<div class="danger-note">It is published: it is removed from the public site immediately, including its published copy.</div>' : "") + impactHTML(impactD, kind) });
        if (okD !== "ok") return;
        await DELETE_BY_KIND[kind](id);
        showToast(title(KIND_NOUN[kind]) + " deleted.");
      }
    } catch (error) { await showError(error); }
  }
  var DELETE_BY_KIND = {
    org: function (id) { return Store.deleteActor(id); },
    project: function (id) { return Store.deleteProject(id); },
    theme: function (id) { return Store.deleteTheme(id); },
    rel: function (id) { return Store.deleteRelationship(id); },
  };

  // ------------------------------------------------------------------ rendering
  function showPage(page) {
    $$(".page").forEach(function (item) { item.classList.toggle("active", item.id === "page-" + page); });
    $$(".nav-btn").forEach(function (item) { item.classList.toggle("active", item.dataset.page === page); });
    renderAll();
    if (page === "network" && Editor) Editor.activate();
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
    if (Editor && $("#page-network").classList.contains("active")) Editor.render();
  }

  // ---------------------------------------------------------------------- forms
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
  // Every record that can be a relationship end, drafts included: a relationship can be
  // authored before both ends are published, and publishing it names what is still missing.
  function fillNodeOptions(selectedSource, selectedTarget) {
    var snapshot = Store.snapshot();
    var all = snapshot.actors.concat(snapshot.projects, snapshot.themes).sort(function (a, b) { return a.name.localeCompare(b.name); });
    function renderOption(node, selected) {
      return option(node.id, node.name + (node.status !== "published" ? " (" + STATUS_LABEL[node.status] + ")" : ""), selected);
    }
    $("#relSource").innerHTML = all.map(function (node) { return renderOption(node, selectedSource); }).join("");
    $("#relTarget").innerHTML = all.map(function (node) { return renderOption(node, selectedTarget); }).join("");
  }
  // Where a node created from the graph editor should appear; saved to the layout after the save.
  var pendingPlacement = null;
  async function placeIfNew(isNew, id) {
    var placement = pendingPlacement;
    pendingPlacement = null;
    if (isNew && placement) { try { await Store.setLayout((function (o) { o[id] = placement; return o; })({})); } catch (error) { /* position only */ } }
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
    var themeIds = {}; D.themeNodes.forEach(function (t) { themeIds[t.id] = true; });
    $("#orgThemes").value = actor ? (actor.themes || []).filter(function (t) { return !themeIds[t]; }).join(", ") : "";
    $("#orgWebsite").value = actor ? actor.website || "" : "";
    $("#orgUpdated").value = actor ? actor.lastUpdated || "" : new Date().toISOString().slice(0, 10);
    $("#orgOffices").value = actor ? officesToText(actor.offices) : "";
    $("#orgSourceNotes").value = actor ? (actor.sourceNotes || []).join("\n") : "";
    $("#organisationDialog").showModal();
  }
  function openRelationship(id, preset) {
    var snapshot = Store.snapshot();
    var rel = id ? snapshot.relationships.filter(function (item) { return item.id === id; })[0] : null;
    preset = preset || {};
    $("#relationshipForm").reset();
    $("#relationshipDialogTitle").textContent = rel ? "Edit relationship" : "Add relationship";
    $("#relId").value = rel ? rel.id : "";
    fillNodeOptions(rel ? rel.sourceId : preset.sourceId, rel ? rel.targetId : preset.targetId);
    $("#relType").value = rel ? rel.type : (preset.type || "collaborates_with");
    $("#relConfidence").value = rel ? rel.confidence : "needs-review";
    $("#relIntensity").value = rel ? rel.intensity || "medium" : "medium";
    $("#relEvidence").value = rel ? rel.evidence || "" : "";
    $("#relationshipDialog").showModal();
  }
  function openProject(id) {
    var project = id ? Store.findProject(id) : null;
    $("#projectForm").reset();
    $("#projectDialogTitle").textContent = project ? "Edit project" : "Add project";
    $("#projectOriginalId").value = project ? project.id : "";
    $("#projectName").value = project ? project.name : "";
    $("#projectId").value = project ? project.id : "";
    $("#projectId").disabled = Boolean(project);
    $("#projectHostInfo").textContent = project && project.hostId ? nodeName(project.hostId) : "None yet";
    $("#projectState").value = project ? project.state || "" : "";
    $("#projectConfidence").value = project ? project.dataConfidence || "needs-review" : "needs-review";
    $("#projectSummary").value = project ? project.summary || "" : "";
    var themeIds = {}; D.themeNodes.forEach(function (t) { themeIds[t.id] = true; });
    $("#projectThemes").value = project ? (project.themes || []).filter(function (t) { return !themeIds[t]; }).join(", ") : "";
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
  var OPEN_BY_KIND = { org: openOrganisation, project: openProject, theme: openTheme, rel: function (id) { openRelationship(id); } };
  function openEdit(kind, id) { OPEN_BY_KIND[kind](id); }
  function openNew(kind, placement) { pendingPlacement = placement || null; OPEN_BY_KIND[kind](); }

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

    ["#orgSearch", "#orgConfidence", "#orgStatus", "#projectSearch", "#projectStatus", "#themeSearch", "#themeStatus", "#relSearch", "#relStatus"].forEach(function (sel) {
      var el = $(sel);
      if (el) el.addEventListener(el.tagName === "SELECT" ? "change" : "input", renderAll);
    });
    $("#addOrganisationBtn").addEventListener("click", function () { openNew("org"); });
    $("#addProjectBtn").addEventListener("click", function () { openNew("project"); });
    $("#addThemeBtn").addEventListener("click", function () { openNew("theme"); });
    $("#addRelationshipBtn").addEventListener("click", function () { openRelationship(); });
    $("#addSourceBtn").addEventListener("click", function () { openSource(); });
    $("#exportBtn").addEventListener("click", exportData);

    document.addEventListener("click", async function (event) {
      try {
        var lifecycleBtn = event.target.closest("[data-action][data-kind][data-id]");
        if (lifecycleBtn) { await lifecycleAction(lifecycleBtn.dataset.action, lifecycleBtn.dataset.kind, lifecycleBtn.dataset.id); return; }
        var editSource = event.target.closest("[data-edit-source]");
        var deleteSource = event.target.closest("[data-delete-source]");
        if (editSource) openSource(editSource.dataset.editSource);
        if (deleteSource) {
          var src = Store.snapshot().sources.filter(function (s) { return s.id === deleteSource.dataset.deleteSource; })[0];
          var okS = await askConfirm({ title: "Delete source: " + (src ? src.name : ""), okLabel: "Delete permanently", danger: true, html: "<p>This source category is removed. This cannot be undone.</p>" });
          if (okS === "ok") { await Store.deleteSource(deleteSource.dataset.deleteSource); showToast("Source deleted."); }
        }
      } catch (error) { await showError(error); }
    });

    $("#organisationForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
        var original = $("#orgOriginalId").value;
        var existing = original ? Store.findActor(original) : {};
        var id = original || $("#orgId").value.trim();
        await Store.upsertActor(Object.assign({}, existing || {}, {
          id: id, name: $("#orgName").value.trim(), type: $("#orgType").value,
          state: $("#orgState").value, dataConfidence: $("#orgConfidenceField").value,
          summary: $("#orgSummary").value.trim(), sectors: list($("#orgSectors").value), themes: list($("#orgThemes").value),
          website: $("#orgWebsite").value.trim(), lastUpdated: $("#orgUpdated").value, sourceNotes: lines($("#orgSourceNotes").value),
          offices: textToOffices($("#orgOffices").value),
        }));
        $("#organisationDialog").close();
        await placeIfNew(!original, id);
        showToast(original ? "Draft saved. Publish to update the public directory." : "Draft created. Publish when it is ready to go live.");
      } catch (error) { await showError(error); }
    });
    $("#relationshipForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
        if ($("#relSource").value === $("#relTarget").value) { await showError(new Error("Choose two different records.")); return; }
        await Store.upsertRelationship({
          id: $("#relId").value, sourceId: $("#relSource").value, targetId: $("#relTarget").value,
          type: $("#relType").value, confidence: $("#relConfidence").value, intensity: $("#relIntensity").value,
          evidence: $("#relEvidence").value.trim(), lastUpdated: new Date().toISOString().slice(0, 10),
        });
        $("#relationshipDialog").close();
        showToast("Draft saved. Publish it to make it public (both ends must be published).");
      } catch (error) { await showError(error); }
    });
    $("#projectForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
        var original = $("#projectOriginalId").value;
        var id = original || $("#projectId").value.trim();
        var existing = original ? Store.findProject(original) : {};
        await Store.upsertProject(Object.assign({}, existing || {}, {
          id: id, name: $("#projectName").value.trim(), type: "project_initiative",
          state: $("#projectState").value,
          dataConfidence: $("#projectConfidence").value, summary: $("#projectSummary").value.trim(),
          themes: list($("#projectThemes").value), lastUpdated: $("#projectUpdated").value,
          evidenceSnippet: $("#projectEvidence").value.trim(),
        }));
        $("#projectDialog").close();
        await placeIfNew(!original, id);
        showToast(original ? "Draft saved. Publish to update the public directory." : "Draft created. Publish when it is ready to go live.");
      } catch (error) { await showError(error); }
    });
    $("#themeForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
        var original = $("#themeOriginalId").value;
        var id = original || $("#themeId").value.trim();
        var existing = original ? Store.findTheme(original) : {};
        await Store.upsertTheme(Object.assign({}, existing || {}, {
          id: id, name: $("#themeName").value.trim(), type: "research_theme",
          dataConfidence: $("#themeConfidence").value, summary: $("#themeSummary").value.trim(), lastUpdated: $("#themeUpdated").value,
        }));
        $("#themeDialog").close();
        await placeIfNew(!original, id);
        showToast(original ? "Draft saved. Publish to update the public directory." : "Draft created. Publish when it is ready to go live.");
      } catch (error) { await showError(error); }
    });
    $("#sourceForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
        await Store.upsertSource({ id: $("#sourceId").value, name: $("#sourceName").value.trim(), type: $("#sourceType").value.trim(), notes: $("#sourceNotes").value.trim() });
        $("#sourceDialog").close(); showToast("Source saved.");
      } catch (error) { await showError(error); }
    });
    // A closed or cancelled form must not leave a stale placement for the next "Add".
    ["organisationDialog", "projectDialog", "themeDialog"].forEach(function (dialogId) {
      $("#" + dialogId).addEventListener("close", function () { window.setTimeout(function () { pendingPlacement = null; }, 0); });
    });

    $("#importInput").addEventListener("change", function (event) {
      var file = event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function () {
        try { await Store.importState(JSON.parse(reader.result)); showToast("Dataset imported."); }
        catch (error) { await showError(error); }
        event.target.value = "";
      };
      reader.readAsText(file);
    });
    $("#resetBtn").addEventListener("click", async function () {
      var demo = window.RD_ADMIN_AUTH.isDemo();
      var okR = await askConfirm({ title: "Reset to the original demo dataset", okLabel: "Reset data", danger: true,
        html: demo ? "<p>This resets every record, draft, publish state and editor layout saved in <strong>this browser</strong> to the original demo dataset.</p>" : "<p>This resets the shared dataset to the original demo dataset and affects all visitors.</p>" });
      if (okR !== "ok") return;
      try { await Store.reset(); showToast("Demo data reset."); }
      catch (error) { await showError(error); }
    });

    window.addEventListener("rd-admin-data-changed", renderAll);
  }

  window.RD_ADMIN_UI = {
    esc: esc, title: title, nodeName: nodeName, tagName: tagName, statusLabel: STATUS_LABEL, collectionToKind: KIND_BY_COLLECTION,
    openEdit: openEdit, openNew: openNew, openRelationship: openRelationship, lifecycle: lifecycleAction,
    showToast: showToast, showError: showError, askConfirm: askConfirm, confidencePill: confidencePill, statusPill: statusPill,
  };

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
      $(".notice").textContent = "Demo mode: changes are saved only in this browser (localStorage) and are visible only to this browser on this site. They are not shared with other visitors, browsers or devices. The draft/publish workflow still applies. This login does not secure real data.";
      $(".side-note").innerHTML = "<strong>Demo workspace</strong>Saved in this browser only. Export JSON to keep a copy before clearing browser data.";
      $("#page-history .page-head p").textContent = "Browser-local history of changes to the demonstration dataset.";
    }
    if (!await Store.ready) {
      document.body.classList.remove("auth-pending");
      $(".shell").style.display = "none";
      showToast(Store.loadError || "Unable to load administrator data. Please reload the page.", true);
      return;
    }
    fillCommonOptions();
    wireEvents();
    if (Editor) Editor.mount(window.RD_ADMIN_UI);
    renderAll();
    document.body.classList.remove("auth-pending");
    window.setInterval(requireLogin, 60000);
    window.addEventListener("pageshow", requireLogin);
  });
})();
