(function () {
  "use strict";
  var form = document.getElementById("loginForm");
  var password = document.getElementById("password");
  var button = document.getElementById("loginButton");
  var errorBox = document.getElementById("loginError");
  document.getElementById("togglePassword").addEventListener("click", function () {
    var visible = password.type === "password";
    password.type = visible ? "text" : "password";
    this.textContent = visible ? "Hide" : "Show";
    this.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    this.setAttribute("aria-pressed", String(visible));
  });
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    errorBox.hidden = true;
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      await window.RD_ADMIN_AUTH.login(document.getElementById("username").value.trim(), password.value);
      password.value = "";
      window.location.replace("admin.html");
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      password.value = "";
      password.focus();
    } finally {
      button.disabled = false;
      button.textContent = "Sign in";
    }
  });
  window.RD_ADMIN_AUTH.session().then(function (session) {
    if (session.authenticated) window.location.replace("admin.html");
  }).catch(function () { /* The form reports service errors on submit. */ });
})();
