(function () {
  "use strict";
  var Store = window.RD_ADMIN_STORE;
  if (!Store) return;

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function esc(value) { return window.RD_ADMIN_UI ? window.RD_ADMIN_UI.esc(value) : String(value == null ? "" : value); }

  var KIND_NOUN = { actors: "organisation", projects: "project", themes: "theme", relationships: "relationship" };
  var selections = { actors: {}, projects: {}, themes: {}, relationships: {} }; // collection -> { id: true }
  var activeCollection = null; // which collection the batch-field dialog targets

  function isSelected(collection, id) { return Boolean(selections[collection] && selections[collection][id]); }
  function selectedIds(collection) { return Object.keys(selections[collection] || {}); }
  function clearSelection(collection) { selections[collection] = {}; refreshToolbar(collection); }

  function refreshToolbar(collection) {
    var ids = selectedIds(collection);
    var toolbar = $("[data-batch-toolbar='" + collection + "']");
    if (!toolbar) return;
    if (!ids.length) { toolbar.hidden = true; toolbar.innerHTML = ""; return; }
    toolbar.hidden = false;
    var fields = Store.batchEditableFields(collection);
    var fieldButton = fields.length ? '<button class="btn small" data-batch-op="field">Edit field…</button>' : "";
    toolbar.innerHTML =
      '<span class="batch-count">' + ids.length + " selected</span>" +
      '<button class="btn small teal" data-batch-op="publish">Publish</button>' +
      '<button class="btn small" data-batch-op="withdraw">Withdraw</button>' +
      fieldButton +
      '<button class="btn small danger" data-batch-op="delete">Delete</button>' +
      '<button class="btn small" data-batch-op="clear">Clear selection</button>';
  }

  async function confirmBatch(collection, action) {
    var ids = selectedIds(collection);
    var impact = Store.batchImpactOf(collection, ids);
    var noun = KIND_NOUN[collection];
    var title, html, danger = false, okLabel = "Confirm";
    if (action === "publish") {
      title = "Publish " + ids.length + " " + noun + (ids.length > 1 ? "s" : "");
      html = "<p>This makes the selected record(s) visible on the public site.</p>";
      if (impact.relationships.length) html += "<p>" + impact.relationships.length + " relationship(s) are connected.</p>";
      okLabel = "Publish";
    } else if (action === "withdraw") {
      title = "Withdraw " + ids.length + " " + noun + (ids.length > 1 ? "s" : "");
      html = "<p>The selected record(s) return to draft and disappear from the public site. Nothing is deleted.</p>";
      okLabel = "Withdraw";
    } else if (action === "delete") {
      title = "Delete " + ids.length + " " + noun + (ids.length > 1 ? "s" : "");
      danger = true; okLabel = "Delete permanently";
      html = "<p>This cannot be undone.</p>";
      if (impact.publishedCount) html += '<div class="danger-note">' + impact.publishedCount + " of the selected record(s) are published and will be removed from the public site immediately.</div>";
      if (impact.relationships.length) html += "<p>" + impact.relationships.length + " relationship(s) will be deleted with them:</p><ul>" + impact.relationships.slice(0, 20).map(function (r) { return "<li>" + esc(r.label) + "</li>"; }).join("") + (impact.relationships.length > 20 ? "<li>…and " + (impact.relationships.length - 20) + " more</li>" : "") + "</ul>";
      if (impact.hostedProjects.length) html += "<p>These projects lose their host:</p><ul>" + impact.hostedProjects.map(function (p) { return "<li>" + esc(p.name) + "</li>"; }).join("") + "</ul>";
      if (impact.taggedRecords.length) html += "<p>The theme tag is removed from:</p><ul>" + impact.taggedRecords.map(function (n) { return "<li>" + esc(n.name) + "</li>"; }).join("") + "</ul>";
    }
    var choice = window.RD_ADMIN_UI ? await window.RD_ADMIN_UI.askConfirm({ title: title, html: html, okLabel: okLabel, danger: danger }) : "ok";
    if (choice !== "ok") return;
    try {
      if (action === "publish") await Store.bulkPublish(collection, ids);
      else if (action === "withdraw") await Store.bulkWithdraw(collection, ids);
      else if (action === "delete") await Store.bulkDelete(collection, ids);
      clearSelection(collection);
      if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast(title + " complete.");
      window.dispatchEvent(new CustomEvent("rd-admin-data-changed"));
    } catch (error) { if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showError(error); }
  }

  function openFieldDialog(collection) {
    activeCollection = collection;
    var fields = Store.batchEditableFields(collection);
    $("#batchFieldSelect").innerHTML = fields.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + "</option>"; }).join("");
    $("#batchFieldValue").value = "";
    $("#batchFieldDialog").showModal();
  }

  function wireEvents() {
    document.addEventListener("change", function (event) {
      var cb = event.target.closest(".batch-select");
      if (cb) {
        var collection = cb.dataset.batchCollection, id = cb.dataset.batchId;
        if (cb.checked) selections[collection][id] = true; else delete selections[collection][id];
        refreshToolbar(collection);
        return;
      }
      var selectAll = event.target.closest("[data-batch-select-all]");
      if (selectAll) {
        var col = selectAll.dataset.batchSelectAll;
        var boxes = $$(".batch-select[data-batch-collection='" + col + "']");
        boxes.forEach(function (b) {
          b.checked = selectAll.checked;
          if (selectAll.checked) selections[col][b.dataset.batchId] = true; else delete selections[col][b.dataset.batchId];
        });
        refreshToolbar(col);
      }
    });
    document.addEventListener("click", function (event) {
      var opBtn = event.target.closest("[data-batch-op]");
      if (!opBtn) return;
      var toolbar = opBtn.closest("[data-batch-toolbar]");
      var collection = toolbar.dataset.batchToolbar;
      var op = opBtn.dataset.batchOp;
      if (op === "clear") clearSelection(collection);
      else if (op === "field") openFieldDialog(collection);
      else confirmBatch(collection, op);
    });
    $("#batchFieldForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
        var ids = selectedIds(activeCollection);
        await Store.bulkSetField(activeCollection, ids, $("#batchFieldSelect").value, $("#batchFieldValue").value.trim());
        $("#batchFieldDialog").close();
        clearSelection(activeCollection);
        if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast("Updated " + ids.length + " record(s).");
        window.dispatchEvent(new CustomEvent("rd-admin-data-changed"));
      } catch (error) { if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showError(error); }
    });
  }

  window.RD_BULK_ACTIONS = { wireEvents: wireEvents, refreshToolbar: refreshToolbar, isSelected: isSelected };
})();
