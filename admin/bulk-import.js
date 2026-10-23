(function () {
  "use strict";
  var D = window.RD_DATA;
  var Store = window.RD_ADMIN_STORE;
  var Auth = window.RD_ADMIN_AUTH;
  if (!D || !Store || !Auth) return;

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function esc(value) { return window.RD_ADMIN_UI ? window.RD_ADMIN_UI.esc(value) : String(value == null ? "" : value); }

  // Column definitions per collection for the type-or-paste table. `key` matches the field name
  // planBulkUpsert()/bulkUpsert() expect (dataset-core.js); relationship rows use "source"/"target"
  // (resolved server- and client-side by name or ID), not sourceId/targetId directly.
  var COLUMNS = {
    actors: [
      { key: "id", label: "ID (leave blank to auto-generate)" }, { key: "name", label: "Name *" },
      { key: "type", label: "Type (e.g. university, crc)" }, { key: "state", label: "State" },
      { key: "summary", label: "Summary *" }, { key: "website", label: "Website" },
    ],
    projects: [
      { key: "id", label: "ID (leave blank to auto-generate)" }, { key: "name", label: "Name *" },
      { key: "state", label: "State" }, { key: "summary", label: "Summary *" },
    ],
    themes: [
      { key: "id", label: "ID (leave blank to auto-generate)" }, { key: "name", label: "Name *" },
      { key: "summary", label: "Summary *" },
    ],
    relationships: [
      { key: "source", label: "From (organisation/project/theme name or ID) *" },
      { key: "target", label: "To (organisation/project/theme name or ID) *" },
      { key: "type", label: "Relationship type *" }, { key: "evidence", label: "Evidence" },
    ],
  };

  var state = { rows: [], fileRows: null, lastPlan: null, lastRequest: null };

  function currentCollection() { return $("#biCollection").value; }
  function currentMode() { return $("#biMode").value; }

  // --------------------------------------------------------------- type-or-paste table
  function emptyRow() {
    var row = {};
    COLUMNS[currentCollection()].forEach(function (c) { row[c.key] = ""; });
    return row;
  }
  function renderFormTable() {
    var cols = COLUMNS[currentCollection()];
    $("#biFormHead").innerHTML = "<tr>" + cols.map(function (c) { return "<th>" + esc(c.label) + "</th>"; }).join("") + "<th></th></tr>";
    if (!state.rows.length) state.rows = [emptyRow()];
    $("#biFormBody").innerHTML = state.rows.map(function (row, rIdx) {
      return "<tr>" + cols.map(function (c, cIdx) {
        return '<td><input type="text" data-bi-row="' + rIdx + '" data-bi-col="' + cIdx + '" data-bi-key="' + esc(c.key) + '" value="' + esc(row[c.key] || "") + '" /></td>';
      }).join("") + '<td><button class="btn small danger" type="button" data-bi-remove-row="' + rIdx + '">Remove</button></td></tr>';
    }).join("");
  }
  function readFormTable() {
    var cols = COLUMNS[currentCollection()];
    return $$("#biFormBody tr").map(function (tr, rIdx) {
      var row = { sourceRow: rIdx + 2 }; // +2: row 1 is the header, matching a real spreadsheet's numbering
      $$("input", tr).forEach(function (input) { row[input.dataset.biKey] = input.value; });
      return row;
    }).filter(function (row) { return cols.some(function (c) { return (row[c.key] || "").trim(); }); });
  }
  // Pasting a rectangular block (e.g. copied from Excel) into any cell fills that cell and the
  // following cells/rows from the clipboard's tab/newline-delimited grid, growing the table with
  // new rows as needed rather than requiring the operator to pre-create enough rows first.
  function handlePaste(event) {
    var target = event.target;
    if (!target || !target.matches("input[data-bi-row]")) return;
    var text = (event.clipboardData || window.clipboardData).getData("text");
    if (!text || text.indexOf("\t") === -1 && text.indexOf("\n") === -1) return; // let a single-cell paste behave normally
    event.preventDefault();
    var grid = text.replace(/\r/g, "").split("\n").filter(function (line, i, arr) { return !(i === arr.length - 1 && line === ""); }).map(function (line) { return line.split("\t"); });
    var startRow = parseInt(target.dataset.biRow, 10), startCol = parseInt(target.dataset.biCol, 10);
    var cols = COLUMNS[currentCollection()];
    grid.forEach(function (gridRow, gi) {
      var rIdx = startRow + gi;
      while (state.rows.length <= rIdx) state.rows.push(emptyRow());
      gridRow.forEach(function (value, gj) {
        var cIdx = startCol + gj;
        if (cIdx >= cols.length) return;
        state.rows[rIdx][cols[cIdx].key] = value;
      });
    });
    renderFormTable();
  }

  // ------------------------------------------------------------------------- file upload
  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(",")[1] || ""); };
      reader.onerror = function () { reject(new Error("Could not read the file.")); };
      reader.readAsDataURL(file);
    });
  }
  var uploadedFile = null; // { filename, contentBase64 }
  async function onFileChosen(event) {
    var file = event.target.files[0];
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) { window.RD_ADMIN_UI.showToast("Choose a .xlsx or .csv file.", true); return; }
    try {
      var contentBase64 = await fileToBase64(file);
      uploadedFile = { filename: file.name, contentBase64: contentBase64 };
      var inspect = await Auth.request("api/admin/import/inspect", { filename: file.name, contentBase64: contentBase64 });
      $("#biFileDetails").hidden = false;
      var sheetField = $("#biSheetField");
      if (inspect.sheets.length > 1) {
        sheetField.hidden = false;
        $("#biSheetSelect").innerHTML = inspect.sheets.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + "</option>"; }).join("");
      } else sheetField.hidden = true;
      $("#biHeaderRow").value = inspect.suggestedHeaderRow;
      $("#biFormulaWarning").hidden = !inspect.anyFormulas;
      renderMappingGrid(inspect.headers);
    } catch (error) { window.RD_ADMIN_UI.showError(error); }
  }
  function renderMappingGrid(headers) {
    var cols = COLUMNS[currentCollection()];
    var colLetters = Object.keys(headers);
    var options = '<option value="">(not mapped)</option>' + colLetters.map(function (letter) { return '<option value="' + esc(letter) + '">' + esc(letter) + " — " + esc(headers[letter]) + "</option>"; }).join("");
    $("#biMappingGrid").innerHTML = "<p class=\"help\">Match each field to a column from the file:</p>" + cols.map(function (c) {
      // Best-effort auto-match by header text, so the operator usually only has to confirm, not pick every field by hand.
      var guess = colLetters.filter(function (letter) { return headers[letter].toLowerCase().replace(/[^a-z0-9]/g, "") === c.label.toLowerCase().replace(/[^a-z0-9*()./]/g, "").replace(/\*$/, "").replace(/[^a-z0-9]/g, ""); })[0] || "";
      return '<div class="field"><label>' + esc(c.label) + '</label><select class="select bi-map-select" data-bi-map="' + esc(c.key) + '">' + options.replace('value="' + guess + '"', 'value="' + guess + '" selected') + "</select></div>";
    }).join("");
  }
  function readFieldMapping() {
    var mapping = {};
    $$(".bi-map-select").forEach(function (sel) { if (sel.value) mapping[sel.dataset.biMap] = sel.value; });
    return mapping;
  }

  // --------------------------------------------------------------------------- preview/commit
  function activeTab() { return $(".bi-tab.active").dataset.biTab; }
  function buildRequestBody(extra) {
    var base = { collection: currentCollection(), mode: currentMode() };
    if (activeTab() === "form") {
      base.rows = readFormTable();
    } else {
      if (!uploadedFile) throw new Error("Choose a file first.");
      Object.assign(base, uploadedFile);
      base.sheetName = $("#biSheetField").hidden ? undefined : $("#biSheetSelect").value;
      base.headerRow = parseInt($("#biHeaderRow").value, 10) || 1;
      base.fieldMapping = readFieldMapping();
    }
    return Object.assign(base, extra || {});
  }
  function actionLabel(action) { return { created: "Create", updated: "Update", skipped: "Skip", error: "Error" }[action] || action; }
  function renderPreview(plan, previouslyImported) {
    state.lastPlan = plan;
    $("#biPreviewArea").hidden = false;
    $("#biResultArea").hidden = true;
    var prevNote = $("#biPreviouslyImported");
    if (previouslyImported) {
      prevNote.hidden = false;
      prevNote.textContent = "This exact file (same sheet and mode) was already imported on " + new Date(previouslyImported.importedAt).toLocaleString() + " by " + previouslyImported.importedBy + " (" + previouslyImported.createdCount + " created, " + previouslyImported.updatedCount + " updated). Importing it again is blocked to avoid duplicate records.";
    } else prevNote.hidden = true;
    var c = plan.counts;
    $("#biCounts").innerHTML = [
      ["created", c.created, "New"], ["updated", c.updated, "Update"], ["skipped", c.skipped, "Skip"], ["errors", c.errors, "Error"],
    ].map(function (row) { return '<div class="metric"><div class="value">' + row[1] + '</div><div class="label">' + row[2] + "</div></div>"; }).join("");
    $("#biPreviewBody").innerHTML = plan.rows.map(function (r) {
      var detail = r.action === "error" ? r.errors.join("; ") : (r.row && (r.row.name || r.row.source ? (r.row.name || (r.row.source + " → " + r.row.target)) : ""));
      return "<tr" + (r.action === "error" ? ' class="bi-row-error"' : "") + "><td>" + r.sourceRow + "</td><td>" + esc(actionLabel(r.action)) + "</td><td>" + esc(detail || "") + "</td></tr>";
    }).join("");
    $("#biCommitBtn").disabled = !plan.canCommit || Boolean(previouslyImported);
  }
  async function onPreview() {
    try {
      var body = buildRequestBody();
      state.lastRequest = body;
      if (Auth.isDemo()) {
        if (activeTab() === "file") { window.RD_ADMIN_UI.showToast("File upload import needs the real backend; demo mode only supports typed/pasted rows.", true); return; }
        var plan = Store.planBulkImport(body.collection, body.mode, body.rows);
        renderPreview(plan, null);
        return;
      }
      var response = await Auth.request("api/admin/import/preview", body);
      renderPreview(response.plan, response.previouslyImported);
    } catch (error) { window.RD_ADMIN_UI.showError(error); }
  }
  async function onCommit() {
    try {
      if (Auth.isDemo()) {
        await Store.bulkUpsert(state.lastRequest.collection, state.lastRequest.mode, state.lastRequest.rows);
      } else {
        await Auth.request("api/admin/import/commit", state.lastRequest);
        await Store.reload ? Store.reload() : null;
      }
      $("#biResultArea").hidden = false;
      $("#biResultSummary").innerHTML = "<p>" + state.lastPlan.counts.created + " created, " + state.lastPlan.counts.updated + " updated, as drafts. Review and publish them from their tables when ready.</p>";
      $("#biPreviewArea").hidden = true;
      window.RD_ADMIN_UI.showToast("Import complete.");
      window.dispatchEvent(new CustomEvent("rd-admin-data-changed"));
    } catch (error) { window.RD_ADMIN_UI.showError(error); }
  }

  function wireEvents() {
    $("#biCollection").addEventListener("change", function () { state.rows = []; renderFormTable(); });
    $("#biAddRow").addEventListener("click", function () { state.rows = readFormTable().length ? readFormTable() : state.rows; state.rows.push(emptyRow()); renderFormTable(); });
    $("#biDuplicateRow").addEventListener("click", function () {
      var rows = readFormTable();
      if (rows.length) rows.push(Object.assign({}, rows[rows.length - 1]));
      state.rows = rows.length ? rows : [emptyRow()];
      renderFormTable();
    });
    $("#biClearRows").addEventListener("click", function () { state.rows = [emptyRow()]; renderFormTable(); });
    $("#biFormBody").addEventListener("paste", handlePaste);
    $$(".bi-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        $$(".bi-tab").forEach(function (t) { t.classList.toggle("active", t === tab); });
        $("#biPanelForm").hidden = tab.dataset.biTab !== "form";
        $("#biPanelFile").hidden = tab.dataset.biTab !== "file";
      });
    });
    $("#biFileInput").addEventListener("change", onFileChosen);
    $("#biPreviewBtn").addEventListener("click", onPreview);
    $("#biCommitBtn").addEventListener("click", onCommit);
  }

  function activate() {
    if (!$("#biFormBody").children.length) renderFormTable();
  }

  window.RD_BULK_IMPORT = { wireEvents: wireEvents, activate: activate };
})();
