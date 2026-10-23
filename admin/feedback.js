(function () {
  "use strict";
  var Auth = window.RD_ADMIN_AUTH;
  if (!Auth) return;

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function esc(value) { return window.RD_ADMIN_UI ? window.RD_ADMIN_UI.esc(value) : String(value == null ? "" : value); }

  var available = false;
  var canTriage = false; // true for admin/stakeholder (full-visibility) roles
  var idempotencyKey = null; // regenerated each time the dialog opens; reused across retries of the same submission

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(",")[1] || ""); };
      reader.onerror = function () { reject(new Error("Could not read the screenshot file.")); };
      reader.readAsDataURL(file);
    });
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function statusPillHtml(status) {
    var cls = { New: "status-draft", Investigating: "status-draft", Fixed: "status-published", "Ready for retest": "status-published", Closed: "" }[status] || "";
    return '<span class="pill ' + esc(cls) + '">' + esc(status) + "</span>";
  }
  function formatDate(value) {
    if (!value) return "—";
    try { return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); } catch (e) { return value; }
  }

  function openReportDialog() {
    $("#feedbackForm").reset();
    idempotencyKey = uuid();
    $("#feedbackDialog").showModal();
  }

  async function submitFeedback(event) {
    event.preventDefault();
    var submitBtn = $("#feedbackForm button[type=submit]");
    submitBtn.disabled = true;
    try {
      var payload = {
        kind: $("#feedbackKind").value, title: $("#feedbackTitle").value.trim(), description: $("#feedbackDescription").value.trim(),
        reproSteps: $("#feedbackRepro").value.trim() || undefined, expectedResult: $("#feedbackExpected").value.trim() || undefined,
        actualResult: $("#feedbackActual").value.trim() || undefined, relatedRecordId: $("#feedbackRelatedRecord").value.trim() || undefined,
        relatedPage: window.location.pathname + window.location.hash, currentPage: document.title,
        appVersion: (window.RD_SITE_CONFIG && window.RD_SITE_CONFIG.appVersion) || "0.2.0",
        idempotencyKey: idempotencyKey,
      };
      var file = $("#feedbackScreenshot").files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) throw new Error("Screenshot is too large (max 5 MB).");
        payload.screenshotBase64 = await fileToBase64(file);
        payload.screenshotMimeType = file.type;
      }
      var created = await Auth.request("api/feedback", payload);
      // Submission succeeded; only now is it safe to stop treating this as "the same attempt" --
      // a form left open after success and resubmitted would otherwise reuse a stale key, which
      // the server interprets as idempotent (fine), but regenerating keeps intent accurate.
      idempotencyKey = uuid();
      $("#feedbackDialog").close();
      if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast("Thank you — feedback #" + created.feedbackNumber + " submitted.");
      renderFeedback();
    } catch (error) {
      // Per the brief: a failed submission must preserve what was typed, not clear the form.
      if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showError(error); else alert(error.message);
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function renderFeedback() {
    var navBtn = $("#feedbackNavBtn");
    if (!navBtn || Auth.isDemo()) { if (navBtn) navBtn.hidden = true; $("#reportIssueBtn").hidden = true; return; }
    try {
      var items = await Auth.request("api/feedback" + queryString());
      available = true;
      navBtn.hidden = false;
      $("#reportIssueBtn").hidden = false;
      $("#feedbackNavCount").textContent = items.filter(function (i) { return i.status !== "Closed"; }).length;
      var body = $("#feedbackTableBody");
      if (!body) return;
      body.innerHTML = items.length ? items.map(function (item) {
        return "<tr><td>#" + item.feedbackNumber + "</td><td>" + esc(item.kind) + "</td><td>" + esc(item.title) + "</td><td>" + esc(item.submittedByUsername || "") + "</td><td>" + statusPillHtml(item.status) + "</td><td>" + esc(formatDate(item.submittedAt)) + "</td><td><button class=\"btn small\" data-feedback-view=\"" + esc(item.id) + "\">View</button></td></tr>";
      }).join("") : '<tr><td colspan="7" class="empty">No feedback yet.</td></tr>';
    } catch (error) {
      if (error.status === 404) { available = false; navBtn.hidden = true; $("#reportIssueBtn").hidden = true; return; }
      if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast(error.message, true);
    }
  }
  function queryString() {
    var status = $("#feedbackStatusFilter") ? $("#feedbackStatusFilter").value : "";
    var kind = $("#feedbackKindFilter") ? $("#feedbackKindFilter").value : "";
    var params = [];
    if (status) params.push("status=" + encodeURIComponent(status));
    if (kind) params.push("kind=" + encodeURIComponent(kind));
    return params.length ? "?" + params.join("&") : "";
  }

  async function openDetail(id) {
    try {
      var items = await Auth.request("api/feedback");
      var item = items.filter(function (i) { return i.id === id; })[0];
      if (!item) return;
      $("#feedbackDetailTitle").textContent = "#" + item.feedbackNumber + " — " + item.title;
      var rows = [
        ["Type", item.kind], ["Status", item.status], ["Submitted by", item.submittedByUsername],
        ["Submitted", formatDate(item.submittedAt)], ["Page", item.relatedPage || "—"], ["Related record", item.relatedRecordId || "—"],
        ["Description", item.description], ["Steps to reproduce", item.reproSteps || "—"],
        ["Expected result", item.expectedResult || "—"], ["Actual result", item.actualResult || "—"],
        ["App version", item.appVersion || "—"], ["Request ID", item.requestId || "—"],
      ];
      $("#feedbackDetailBody").innerHTML = rows.map(function (r) { return "<strong>" + esc(r[0]) + ":</strong> " + esc(r[1]) + "\n"; }).join("");
      $("#feedbackScreenshotWrap").hidden = !item.hasScreenshot;
      if (item.hasScreenshot) {
        var url = (window.RD_SITE_CONFIG && window.RD_SITE_CONFIG.apiBaseUrl ? window.RD_SITE_CONFIG.apiBaseUrl : "") + "/api/feedback/" + id + "/screenshot";
        // The screenshot endpoint requires an Authorization header, which an <img src> cannot
        // send; fetch it as a blob and use an object URL instead so access control still applies.
        var token = sessionStorage.getItem("rd-admin-session-v1");
        fetch(url, { headers: token ? { Authorization: "Bearer " + token } : {}, credentials: "same-origin" })
          .then(function (r) { return r.ok ? r.blob() : null; })
          .then(function (blob) { if (blob) $("#feedbackScreenshotImg").src = URL.createObjectURL(blob); });
      }
      $("#feedbackTriage").hidden = !canTriage;
      if (canTriage) {
        $("#feedbackNewStatus").value = item.status;
        $("#feedbackStatusNote").value = "";
        $("#feedbackSaveStatusBtn").onclick = async function () {
          try {
            await Auth.request("api/feedback/" + id + "/status", { status: $("#feedbackNewStatus").value, note: $("#feedbackStatusNote").value.trim() || undefined });
            if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast("Status updated.");
            openDetail(id); // refresh history
            renderFeedback();
          } catch (error) { if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showError(error); }
        };
        var history = await Auth.request("api/feedback/" + id + "/history");
        $("#feedbackHistoryList").innerHTML = history.length ? history.map(function (h) {
          return '<div class="audit-item"><div class="audit-time">' + esc(formatDate(h.changed_at)) + '</div><div><div class="audit-title">' + esc(h.status) + " · " + esc(h.changed_by) + '</div><div class="audit-detail">' + esc(h.note || "") + "</div></div></div>";
        }).join("") : '<div class="empty">No history.</div>';
      }
      $("#feedbackDetailDialog").showModal();
    } catch (error) { if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showError(error); }
  }

  function wireEvents() {
    $("#reportIssueBtn").addEventListener("click", openReportDialog);
    $("#feedbackReportBtn2").addEventListener("click", openReportDialog);
    $("#feedbackForm").addEventListener("submit", submitFeedback);
    $("#feedbackStatusFilter").addEventListener("change", renderFeedback);
    $("#feedbackKindFilter").addEventListener("change", renderFeedback);
    $("#feedbackExportBtn").addEventListener("click", function () {
      var base = (window.RD_SITE_CONFIG && window.RD_SITE_CONFIG.apiBaseUrl) || "";
      var token = sessionStorage.getItem("rd-admin-session-v1");
      fetch(base + "/api/feedback/export.csv", { headers: token ? { Authorization: "Bearer " + token } : {}, credentials: "same-origin" })
        .then(function (r) { return r.blob(); })
        .then(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url; a.download = "feedback-export.csv"; a.click();
          URL.revokeObjectURL(url);
        });
    });
    document.addEventListener("click", function (event) {
      var viewBtn = event.target.closest("[data-feedback-view]");
      if (viewBtn) openDetail(viewBtn.dataset.feedbackView);
    });
  }

  async function setRole(role) {
    canTriage = role === "admin" || role === "stakeholder";
    $("#feedbackExportBtn").hidden = !canTriage;
    $("#feedbackPageDesc").textContent = canTriage
      ? "All bugs and suggestions reported in this environment."
      : "Bugs and suggestions you have reported.";
  }

  window.RD_FEEDBACK = { wireEvents: wireEvents, render: renderFeedback, setRole: setRole };
})();
