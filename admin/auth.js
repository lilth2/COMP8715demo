(function () {
  "use strict";
  var KEY = "rd-admin-session-v1";
  var base = ((window.RD_SITE_CONFIG || {}).apiBaseUrl || "").replace(/\/$/, "");
  var demo = (window.RD_SITE_CONFIG || {}).demoAccount || {};
  var DEMO_KEY = "rd-admin-demo-session-v1";
  function isDemo() { return !base && /\.github\.io$/.test(window.location.hostname) && demo.enabled === true; }
  function demoSession() {
    try {
      var value = JSON.parse(sessionStorage.getItem(DEMO_KEY) || "null");
      if (value && value.username === demo.username && value.expiresAt > Date.now()) return Object.assign({ authenticated: true }, value);
    } catch (error) { /* A missing or expired demo session returns to login. */ }
    return { authenticated: false };
  }
  async function demoLogin(username, password) {
    var key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    var bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(demo.salt), iterations: demo.iterations }, key, 256);
    var hash = Array.from(new Uint8Array(bits)).map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    if (username !== demo.username || hash !== demo.passwordHash) throw new Error("Incorrect username or password.");
    var session = { username: username, expiresAt: Date.now() + 8 * 60 * 60 * 1000 };
    sessionStorage.setItem(DEMO_KEY, JSON.stringify(session));
    return Object.assign({ authenticated: true }, session);
  }
  function readToken() { try { return sessionStorage.getItem(KEY) || ""; } catch (error) { return ""; } }
  function clearToken() { try { sessionStorage.removeItem(KEY); } catch (error) { /* Session will still be revoked on the server. */ } }
  async function request(url, value) {
    if (!base && /\.github\.io$/.test(window.location.hostname)) throw new Error("Administrator login is awaiting backend configuration. Please contact our project team.");
    var headers = {};
    var token = readToken();
    if (token) headers.Authorization = "Bearer " + token;
    if (value !== undefined) headers["Content-Type"] = "application/json";
    var response;
    try {
      response = await fetch(base + "/" + url.replace(/^\//, ""), {
        method: value === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", headers: headers,
        body: value === undefined ? undefined : JSON.stringify(value)
      });
    } catch (error) { throw new Error("Unable to reach the login service. Please try again later."); }
    var result;
    try { result = await response.json(); } catch (error) { throw new Error("The login service is unavailable. Please contact our project team."); }
    if (!response.ok) {
      if (response.status === 401) clearToken();
      throw new Error(result.message || "Unable to complete the request.");
    }
    return result;
  }
  window.RD_ADMIN_AUTH = {
    isDemo: isDemo,
    session: function () { return isDemo() ? Promise.resolve(demoSession()) : request("api/session"); },
    login: async function (username, password) {
      if (isDemo()) return demoLogin(username, password);
      var result = await request("api/login", { username: username, password: password });
      sessionStorage.setItem(KEY, result.token);
      return result;
    },
    logout: async function () {
      if (isDemo()) { sessionStorage.removeItem(DEMO_KEY); return { authenticated: false }; }
      var result = await request("api/logout", {}); clearToken(); return result;
    },
    request: request
  };
})();
