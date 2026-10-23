(function () {
  "use strict";
  var Auth = window.RD_ADMIN_AUTH;
  if (!Auth) return;

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function esc(value) { return window.RD_ADMIN_UI ? window.RD_ADMIN_UI.esc(value) : String(value == null ? "" : value); }

  var available = false; // set true once we confirm the backend is in multi-account (Postgres) mode

  function roleLabel(role) { return role === "stakeholder" ? "Stakeholder (UAT)" : "Administrator"; }
  function statusLabel(account) {
    if (account.disabled) return '<span class="pill status-draft">Disabled</span>';
    if (account.expiresAt && new Date(account.expiresAt) <= new Date()) return '<span class="pill status-draft">Expired</span>';
    return '<span class="pill status-published">Active</span>';
  }
  function formatDate(value) {
    if (!value) return "—";
    try { return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(new Date(value)); } catch (e) { return value; }
  }

  async function renderAccounts() {
    var body = $("#accountsTableBody");
    if (!body) return;
    if (Auth.isDemo()) { available = false; $("#accountsNavBtn").hidden = true; return; } // no backend to manage accounts against
    try {
      var accounts = await Auth.request("api/admin/accounts");
      available = true;
      $("#accountsNavBtn").hidden = false;
      body.innerHTML = accounts.length ? accounts.map(function (a) {
        var actions = '<div class="row-actions">';
        actions += '<button class="btn small" data-account-password="' + esc(a.id) + '">Set password</button>';
        actions += a.disabled
          ? '<button class="btn small" data-account-enable="' + esc(a.id) + '">Enable</button>'
          : '<button class="btn small danger" data-account-disable="' + esc(a.id) + '">Disable</button>';
        actions += "</div>";
        return "<tr><td>" + esc(a.username) + (a.displayName ? '<div class="record-sub">' + esc(a.displayName) + "</div>" : "") + "</td><td>" + esc(roleLabel(a.role)) + "</td><td>" + statusLabel(a) + "</td><td>" + esc(formatDate(a.createdAt)) + "</td><td>" + actions + "</td></tr>";
      }).join("") : '<tr><td colspan="5" class="empty">No accounts yet.</td></tr>';
    } catch (error) {
      // 404 means the backend is running in single-admin JSON mode (no Postgres) — accounts
      // management simply does not exist there; hide the nav entry rather than show an error.
      if (error.status === 404) { available = false; $("#accountsNavBtn").hidden = true; return; }
      if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast(error.message, true);
    }
  }

  function openAccountDialog() {
    $("#accountForm").reset();
    $("#accountDialogTitle").textContent = "Add account";
    $("#accountRole").value = "stakeholder";
    $("#accountDialog").showModal();
  }

  function wireEvents() {
    $("#addAccountBtn").addEventListener("click", openAccountDialog);
    $("#accountForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
        await Auth.request("api/admin/accounts", {
          username: $("#accountUsername").value.trim(), password: $("#accountPassword").value,
          role: $("#accountRole").value, displayName: $("#accountDisplayName").value.trim() || undefined,
        });
        $("#accountDialog").close();
        if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast("Account created.");
        renderAccounts();
      } catch (error) { if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showError(error); }
    });
    $("#setPasswordForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      try {
        var id = $("#setPasswordAccountId").value;
        await Auth.request("api/admin/accounts/" + id + "/set-password", { password: $("#setPasswordValue").value });
        $("#setPasswordDialog").close();
        if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast("Password updated. That account's existing sessions were signed out.");
        renderAccounts();
      } catch (error) { if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showError(error); }
    });
    document.addEventListener("click", async function (event) {
      var disableBtn = event.target.closest("[data-account-disable]");
      var enableBtn = event.target.closest("[data-account-enable]");
      var passwordBtn = event.target.closest("[data-account-password]");
      try {
        if (disableBtn) {
          var okD = window.RD_ADMIN_UI ? await window.RD_ADMIN_UI.askConfirm({ title: "Disable this account?", okLabel: "Disable", danger: true, html: "<p>The account will be signed out immediately and unable to log in again until re-enabled.</p>" }) : "ok";
          if (okD !== "ok") return;
          await Auth.request("api/admin/accounts/" + disableBtn.dataset.accountDisable + "/disable", {});
          if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast("Account disabled.");
          renderAccounts();
        } else if (enableBtn) {
          await Auth.request("api/admin/accounts/" + enableBtn.dataset.accountEnable + "/enable", {});
          if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showToast("Account enabled.");
          renderAccounts();
        } else if (passwordBtn) {
          $("#setPasswordForm").reset();
          $("#setPasswordAccountId").value = passwordBtn.dataset.accountPassword;
          $("#setPasswordDialog").showModal();
        }
      } catch (error) { if (window.RD_ADMIN_UI) window.RD_ADMIN_UI.showError(error); }
    });
  }

  window.RD_ACCOUNTS = { wireEvents: wireEvents, render: renderAccounts, isAvailable: function () { return available; } };
})();
