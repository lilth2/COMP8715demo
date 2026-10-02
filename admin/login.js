(function () {
  "use strict";
  var form = document.getElementById("loginForm");
  var password = document.getElementById("password");
  var button = document.getElementById("loginButton");
  var errorBox = document.getElementById("loginError");
  var pendingSetup = /\.github\.io$/.test(window.location.hostname) && !(window.RD_SITE_CONFIG || {}).apiBaseUrl && !window.RD_ADMIN_AUTH.isDemo();
  if (window.RD_ADMIN_AUTH.isDemo()) {
    var demoBox = document.getElementById("loginStatus");
    demoBox.textContent = "Sprint demo access: sign in with our initial administrator account. This mode uses synthetic data and browser-local storage; it does not provide secure access control for real data.";
    demoBox.hidden = false;
  }
  if (pendingSetup) {
    var statusBox = document.getElementById("loginStatus");
    statusBox.textContent = "Administrator sign-in is being configured. Access will be available once setup is complete.";
    statusBox.hidden = false;
    button.disabled = true;
    button.textContent = "Sign-in setup pending";
    document.getElementById("loginHelp").textContent = "Please contact our project team for the next access update.";
  }
  document.getElementById("togglePassword").addEventListener("click", function () {
    var visible = password.type === "password";
    password.type = visible ? "text" : "password";
    this.textContent = visible ? "Hide" : "Show";
    this.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    this.setAttribute("aria-pressed", String(visible));
  });
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (pendingSetup) return;
    errorBox.hidden = true;
    button.disabled = true;
    button.textContent = "Signing in…";
    var openingConsole = false;
    try {
      await window.RD_ADMIN_AUTH.login(document.getElementById("username").value.trim(), password.value);
      var session = await window.RD_ADMIN_AUTH.session();
      if (!session.authenticated) throw new Error("Unable to retain your login session. Please allow browser storage and try again.");
      password.value = "";
      button.textContent = "Opening admin console…";
      openingConsole = true;
      window.location.replace("index.html");
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      password.value = "";
      password.focus();
    } finally {
      if (!openingConsole) {
        button.disabled = false;
        button.textContent = "Sign in";
      }
    }
  });
  if (!pendingSetup) window.RD_ADMIN_AUTH.session().then(function (session) {
    if (session.authenticated) window.location.replace("index.html");
  }).catch(function () { /* The form reports service errors on submit. */ });
})();
